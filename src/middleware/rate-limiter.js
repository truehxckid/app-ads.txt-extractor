/**
 * Rate Limiter middleware for App-Ads.txt Extractor
 * Configures API rate limiting
 */

'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');
const redis = require('../services/redis');
const { getLogger } = require('../utils/logger');

const logger = getLogger('rate-limiter-middleware');

/**
 * Redis store implementation for express-rate-limit
 */
class RedisStore {
  constructor({ client, prefix }) {
    this.client = client;
    this.prefix = prefix || 'rate-limit:';
    
    logger.info('Using Redis store for rate limiting');
  }

  /**
   * Increment the counter for a key
   * @param {string} key - Rate limiting key (usually IP)
   * @returns {Promise<number>} - The incremented count
   */
  async increment(key) {
    const redisKey = `${this.prefix}${key}`;
    
    try {
      const multi = this.client.multi();
      multi.incr(redisKey);
      multi.expire(redisKey, 60 * 15); // 15 minutes in seconds
      
      const results = await multi.exec();
      
      // Extract the incremented value from multi results
      return results[0][1]; // Access the value from the INCR operation
    } catch (err) {
      logger.error({ err, key: redisKey }, 'Redis increment error');
      return 1; // Allow request on error
    }
  }
  
  /**
   * Decrement the counter for a key
   * @param {string} key - Rate limiting key
   * @returns {Promise<number>} - The decremented count
   */
  async decrement(key) {
    const redisKey = `${this.prefix}${key}`;
    try {
      return await this.client.decr(redisKey);
    } catch (err) {
      logger.error({ err, key: redisKey }, 'Redis decrement error');
      return 0;
    }
  }
  
  /**
   * Reset the counter for a key
   * @param {string} key - Rate limiting key
   * @returns {Promise<number>} - 1 if successful, 0 otherwise
   */
  async resetKey(key) {
    const redisKey = `${this.prefix}${key}`;
    try {
      return await this.client.del(redisKey);
    } catch (err) {
      logger.error({ err, key: redisKey }, 'Redis resetKey error');
      return 0;
    }
  }
  
  /**
   * Reset all counters
   * @returns {Promise<number>} - Number of keys reset
   */
  async resetAll() {
    try {
      // This is a simplified version - in production, you might want a more targeted approach
      const keys = await this.client.keys(`${this.prefix}*`);
      if (keys.length) {
        return await this.client.del(keys);
      }
      return 0;
    } catch (err) {
      logger.error({ err }, 'Redis resetAll error');
      return 0;
    }
  }
}

/**
 * Create a store for rate limiting
 * @returns {object|undefined} - Store for rate limiting
 */
function createStore() {
  if (redis.isConnected()) {
    return new RedisStore({
      client: redis.client,
      prefix: 'rate-limit:'
    });
  }
  
  logger.info('Using memory store for rate limiting');
  return undefined; // Default memory store
}

/**
 * Standard API limiter
 */
const apiLimiter = rateLimit({
  windowMs: config.api.rateLimitWindow,
  max: config.api.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore(),
  handler: (req, res) => {
    logger.warn({ 
      ip: req.ip, 
      path: req.path 
    }, 'Rate limit exceeded');
    
    res.status(429).json({
      error: 'Too many requests from this IP, please try again later.',
      success: false,
      retryAfter: Math.ceil(config.api.rateLimitWindow / 1000)
    });
  },
  keyGenerator: (req) => {
    return req.ip;
  },
  skip: (req, res) => {
    // Skip rate limiting for health check
    return req.path === '/health';
  }
});

/**
 * Create a custom rate limiter with specific configuration
 * @param {object} options - Rate limiter options
 * @returns {function} - Express middleware
 */
function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || config.api.rateLimitWindow;
  const max = options.max || config.api.rateLimitMax;
  
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store: createStore(),
    handler: (req, res) => {
      logger.warn({ 
        ip: req.ip, 
        path: req.path 
      }, 'Custom rate limit exceeded');
      
      res.status(429).json({
        error: options.message || 'Too many requests, please try again later.',
        success: false,
        retryAfter: Math.ceil(windowMs / 1000)
      });
    },
    keyGenerator: options.keyGenerator || ((req) => req.ip),
    skip: options.skip || (() => false)
  });
}

module.exports = {
  apiLimiter,
  createRateLimiter
};