/**
 * Rate Limiter service for App-Ads.txt Extractor
 * Provides adaptive rate limiting for external API calls
 */

'use strict';

const config = require('../config');
const redis = require('./redis');
const { getLogger } = require('../utils/logger');

const logger = getLogger('rate-limiter');

/**
 * Adaptive Rate Limiter with support for multiple strategies
 */
class AdaptiveRateLimiter {
  /**
   * Create a new rate limiter
   * @param {object} options - Rate limiter options
   */
  constructor(options = {}) {
    this.initialRate = options.initialRate || 10; // requests per second
    this.maxRate = options.maxRate || 20;
    this.minRate = options.minRate || 1;
    this.successRateIncrease = options.successRateIncrease || 0.1;
    this.errorRateDecrease = options.errorRateDecrease || 0.5;
    this.useRedis = options.useRedis !== false && redis.isConnected();
    
    // Store configuration for different services
    this.stores = {};
    
    // In-memory state for rate limiting
    this.memoryState = new Map();
    
    logger.info({
      initialRate: this.initialRate,
      maxRate: this.maxRate,
      minRate: this.minRate,
      useRedis: this.useRedis
    }, 'Rate limiter initialized');
  }
  
  /**
   * Apply rate limiting for a specific store or service
   * @param {string} storeType - Store type or service identifier
   * @param {object} [options] - Rate limiting options
   * @returns {Promise<void>}
   */
  async limit(storeType, options = {}) {
    const storeConfig = this.stores[storeType] || this._initializeStore(storeType);
    const now = Date.now();
    
    // Calculate how much time has passed since last request
    const elapsed = now - storeConfig.lastRequest;
    
    // Calculate delay based on current rate
    const delayMs = Math.max(0, Math.floor(1000 / storeConfig.currentRate) - elapsed);
    
    if (delayMs > 0) {
      logger.debug({
        storeType,
        delay: delayMs,
        rate: storeConfig.currentRate
      }, 'Rate limiting applied');
      
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    
    // Update last request time
    storeConfig.lastRequest = Date.now();
    
    // If using Redis, we need to update the Redis store too
    if (this.useRedis) {
      try {
        const key = `rate-limit:${storeType}`;
        await redis.set(key, JSON.stringify(storeConfig), 'EX', 3600); // 1 hour TTL
      } catch (err) {
        logger.error({
          error: err.message,
          storeType
        }, 'Redis rate limiter error');
      }
    }
    
    return storeConfig.currentRate;
  }
  
  /**
   * Report successful request to adjust rate limits
   * @param {string} storeType - Store type or service identifier
   */
  reportSuccess(storeType) {
    const storeConfig = this.stores[storeType];
    if (!storeConfig) return;
    
    storeConfig.consecutiveErrors = 0;
    storeConfig.consecutiveSuccesses++;
    
    // Increase rate after several consecutive successes
    if (storeConfig.consecutiveSuccesses >= 5) {
      const newRate = Math.min(
        this.maxRate,
        storeConfig.currentRate + this.successRateIncrease
      );
      
      if (newRate > storeConfig.currentRate) {
        storeConfig.currentRate = newRate;
        storeConfig.consecutiveSuccesses = 0;
        
        logger.debug({
          storeType,
          newRate,
          action: 'increase'
        }, 'Rate limit increased after consecutive successes');
      }
    }
    
    // Update Redis if enabled
    if (this.useRedis) {
      const key = `rate-limit:${storeType}`;
      redis.set(key, JSON.stringify(storeConfig), 'EX', 3600).catch(err => {
        logger.error({
          error: err.message,
          storeType
        }, 'Redis rate limiter update error');
      });
    }
  }
  
  /**
   * Report error to adjust rate limits
   * @param {string} storeType - Store type or service identifier
   * @param {number} [statusCode=0] - HTTP status code if available
   */
  reportError(storeType, statusCode = 0) {
    const storeConfig = this.stores[storeType];
    if (!storeConfig) return;
    
    storeConfig.consecutiveSuccesses = 0;
    storeConfig.consecutiveErrors++;
    
    // Implement exponential backoff for consecutive errors
    let decreaseFactor = this.errorRateDecrease;
    
    // More aggressive rate limiting for certain status codes
    if (statusCode === 429 || statusCode === 403) {
      decreaseFactor = 0.8; // More aggressive decrease for rate limiting errors
    } else if (statusCode >= 500) {
      decreaseFactor = 0.5; // Moderate decrease for server errors
    }
    
    // Apply exponential backoff based on consecutive errors
    const backoffFactor = Math.min(5, Math.pow(2, storeConfig.consecutiveErrors - 1));
    const newRate = Math.max(
      this.minRate,
      storeConfig.currentRate * (1 - (decreaseFactor * backoffFactor))
    );
    
    if (newRate < storeConfig.currentRate) {
      storeConfig.currentRate = newRate;
      
      logger.info({
        storeType,
        statusCode,
        newRate,
        consecutiveErrors: storeConfig.consecutiveErrors,
        action: 'decrease'
      }, 'Rate limit decreased after error');
    }
    
    // Update Redis if enabled
    if (this.useRedis) {
      const key = `rate-limit:${storeType}`;
      redis.set(key, JSON.stringify(storeConfig), 'EX', 3600).catch(err => {
        logger.error({
          error: err.message,
          storeType
        }, 'Redis rate limiter update error');
      });
    }
  }
  
  /**
   * Initialize store configuration
   * @param {string} storeType - Store type or service identifier
   * @returns {object} - Store configuration
   * @private
   */
  _initializeStore(storeType) {
    // Try to get from Redis first
    if (this.useRedis) {
      const key = `rate-limit:${storeType}`;
      
      redis.get(key).then(data => {
        if (data) {
          try {
            const parsed = JSON.parse(data);
            this.stores[storeType] = parsed;
            
            logger.debug({
              storeType,
              rate: parsed.currentRate
            }, 'Loaded rate limits from Redis');
            
            return;
          } catch (err) {
            logger.error({
              error: err.message,
              storeType
            }, 'Error parsing Redis rate limit data');
          }
        }
      }).catch(() => {});
    }
    
    // Load store-specific initial config from stores config if available
    const storesConfig = require('../config/stores').stores;
    const storeRateLimit = storesConfig[storeType]?.rateLimit;
    
    // Default configuration
    this.stores[storeType] = {
      currentRate: this.initialRate,
      lastRequest: 0,
      consecutiveErrors: 0,
      consecutiveSuccesses: 0
    };
    
    // Apply store-specific configuration if available
    if (storeRateLimit) {
      // Convert requests per window to requests per second
      const ratePerSecond = storeRateLimit.requests / (storeRateLimit.windowMs / 1000);
      this.stores[storeType].currentRate = ratePerSecond;
      
      logger.debug({
        storeType,
        initialRate: ratePerSecond
      }, 'Applied store-specific rate limit');
    }
    
    return this.stores[storeType];
  }
  
  /**
   * Get current rate limits for all stores
   * @returns {object} - Rate limits by store
   */
  getRateLimits() {
    const limits = {};
    
    for (const [storeType, config] of Object.entries(this.stores)) {
      limits[storeType] = {
        currentRate: config.currentRate,
        lastRequest: config.lastRequest,
        consecutiveErrors: config.consecutiveErrors,
        consecutiveSuccesses: config.consecutiveSuccesses
      };
    }
    
    return limits;
  }
}

// Create singleton instance
const rateLimiter = new AdaptiveRateLimiter();
module.exports = rateLimiter;