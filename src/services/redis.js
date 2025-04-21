// Enhanced Redis service with improved connection handling and error detection

'use strict';

const config = require('../config');
const { getLogger } = require('../utils/logger');

const logger = getLogger('redis');

/**
 * Redis service class with improved connection stability
 */
class RedisService {
  constructor() {
    this.client = null;
    this.connected = false;
    this.connecting = false;
    this.retryCount = 0;
    this.maxRetries = 5;
    this.retryTimeout = null;
    this.consecutiveErrorCount = 0;
    this.maxConsecutiveErrors = 3;
    this.lastErrorTime = 0;
    this.disableRedisUntil = 0;
    this.autoDisableThreshold = 60000; // 60 seconds - disable Redis after too many rapid failures
    
    // Initialize Redis if URL is provided
    if (config.redis.url) {
      this.initialize();
    } else {
      logger.info('Redis URL not provided, Redis functionality disabled');
    }
  }
  
  /**
   * Initialize Redis connection with enhanced error detection
   */
  async initialize() {
    if (this.connecting) return;
    
    // Check if Redis is temporarily disabled due to too many connection failures
    if (Date.now() < this.disableRedisUntil) {
      logger.warn({ 
        disabledUntil: new Date(this.disableRedisUntil).toISOString(),
        remainingMs: this.disableRedisUntil - Date.now()
      }, 'Redis temporarily disabled due to connection issues');
      return;
    }
    
    this.connecting = true;
    
    try {
      logger.info({
        url: config.redis.url ? config.redis.url.replace(/:.+@/, ':***@') : null,
        retryCount: this.retryCount
      }, 'Initializing Redis connection');
      
      // Import Redis dynamically to avoid requiring it when not used
      const Redis = require('ioredis');
      
      // Enhanced connection options with better defaults for stability
      this.client = new Redis(config.redis.url, {
        maxRetriesPerRequest: 2,
        connectTimeout: 5000,
        commandTimeout: 3000,
        enableOfflineQueue: false, // Don't queue commands when disconnected
        enableReadyCheck: true,
        autoResubscribe: false, // Disable auto-resubscribe which can cause issues
        reconnectOnError: (err) => {
          // Only reconnect on specific errors
          const targetError = 'READONLY';
          if (err.message.includes(targetError)) {
            return 1; // Reconnect for READONLY errors (often occurs with Redis Cluster)
          }
          return false; // Don't reconnect for other errors
        },
        retryStrategy: (times) => {
          // More sophisticated retry strategy
          if (times > 5) {
            // After 5 retries, increase delay more aggressively
            return Math.min(times * 500, 10000);
          }
          
          // Normal delay for first few retries
          return Math.min(times * 200, 2000);
        },
        lazyConnect: false,
        keyPrefix: config.redis.prefix || '',
      });
      
      // More comprehensive event handling
      this.client.on('connect', () => {
        logger.info('Redis connection established');
      });
      
      this.client.on('ready', () => {
        this.connected = true;
        this.connecting = false;
        this.retryCount = 0;
        this.consecutiveErrorCount = 0;
        logger.info('Redis client ready');
        
        // Perform a PING to verify connection is fully functional
        this.client.ping().then(result => {
          if (result === 'PONG') {
            logger.info('Redis ping successful');
          } else {
            logger.warn({ result }, 'Unexpected Redis ping response');
          }
        }).catch(err => {
          logger.error({ error: err.message }, 'Redis ping error after connection');
        });
      });
      
      this.client.on('error', (err) => {
        const now = Date.now();
        this.consecutiveErrorCount++;
        this.lastErrorTime = now;
        
        logger.error({ 
          error: err.message,
          consecutiveErrors: this.consecutiveErrorCount
        }, 'Redis error');
        
        // Auto-disable Redis temporarily if we're seeing rapid connection failures
        // This prevents the reconnection loop from consuming resources
        if (this.consecutiveErrorCount >= this.maxConsecutiveErrors) {
          const disableTime = now + this.autoDisableThreshold;
          this.disableRedisUntil = disableTime;
          
          logger.warn({
            disabledUntil: new Date(disableTime).toISOString(),
            consecutiveErrors: this.consecutiveErrorCount
          }, 'Temporarily disabling Redis due to excessive connection errors');
          
          // Reset error counter
          this.consecutiveErrorCount = 0;
          
          if (this.client) {
            try {
              // Force disconnect to clean up resources
              this.client.disconnect();
            } catch (err) {
              // Ignore disconnect errors
            }
          }
          
          this.connected = false;
          this.connecting = false;
          this.client = null;
        }
      });
      
      this.client.on('close', () => {
        if (this.connected) {
          this.connected = false;
          logger.warn('Redis connection closed');
          this._scheduleReconnect();
        }
      });
      
      this.client.on('reconnecting', (delay) => {
        logger.info({ reconnectDelay: delay }, 'Redis reconnecting');
      });
      
      this.client.on('end', () => {
        this.connected = false;
        logger.info('Redis connection ended');
      });
      
      // Check if connection timeout is needed
      const connectionTimeout = setTimeout(() => {
        if (this.connecting && !this.connected) {
          logger.error('Redis connection timeout');
          this.connecting = false;
          
          try {
            this.client.disconnect();
          } catch (err) {
            // Ignore disconnect errors
          }
          
          this._scheduleReconnect();
        }
      }, 8000); // 8 second connection timeout
      
      // Test the connection
      const pingResult = await this.client.ping();
      
      // Clear timeout since connection succeeded
      clearTimeout(connectionTimeout);
      
      if (pingResult === 'PONG') {
        this.connected = true;
        this.connecting = false;
        this.retryCount = 0;
        this.consecutiveErrorCount = 0;
        logger.info('Redis connection successful');
      } else {
        throw new Error(`Unexpected Redis ping response: ${pingResult}`);
      }
      
    } catch (err) {
      this.connected = false;
      this.connecting = false;
      logger.error({ 
        error: err.message,
        stack: err.stack
      }, 'Redis initialization failed');
      
      this._scheduleReconnect();
    }
  }
  
  /**
   * Schedule a reconnection attempt with exponential backoff
   * @private
   */
  _scheduleReconnect() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
    
    if (this.retryCount < this.maxRetries) {
      // Exponential backoff with some jitter
      const baseDelay = Math.min(Math.pow(2, this.retryCount) * 1000, 30000);
      const jitter = Math.floor(Math.random() * 500); // Add up to 500ms of jitter
      const delay = baseDelay + jitter;
      
      this.retryCount++;
      
      logger.info({ 
        retryCount: this.retryCount, 
        maxRetries: this.maxRetries,
        delay: `${delay}ms` 
      }, 'Scheduling Redis reconnection');
      
      this.retryTimeout = setTimeout(() => {
        this.initialize();
      }, delay);
    } else {
      logger.error({ 
        maxRetries: this.maxRetries
      }, 'Max Redis reconnection attempts reached');
      
      // Disable Redis for a longer period after max retries
      this.disableRedisUntil = Date.now() + (5 * 60 * 1000); // 5 minutes
      
      logger.warn({
        disabledUntil: new Date(this.disableRedisUntil).toISOString(),
      }, 'Disabling Redis for extended period after max retries');
      
      // Reset retry count after cool-down period
      setTimeout(() => {
        this.retryCount = 0;
        logger.info('Redis retry count reset after cool-down period');
      }, 5 * 60 * 1000);
    }
  }
  
  /**
   * Check if Redis is connected and available
   * @returns {boolean} - Whether Redis is connected
   */
  isConnected() {
    return this.connected && this.client !== null;
  }
  
  /**
   * Get value from Redis
   * @param {string} key - Redis key
   * @returns {Promise<string|null>} - Value or null if not found/error
   */
  async get(key) {
    if (!this.isConnected()) return null;
    
    try {
      // First check if we have a compressed version
      const compressedKey = `${key}:compressed`;
      const compressed = await this.client.getBuffer(compressedKey);
      
      if (compressed) {
        const fs = require('../utils/fs');
        const decompressed = await fs.gunzip(compressed);
        return decompressed.toString('utf8');
      }
      
      // Otherwise get the regular value
      return await this.client.get(key);
    } catch (err) {
      logger.error({ error: err.message, key }, 'Redis get error');
      return null;
    }
  }
  
  /**
   * Set value in Redis
   * @param {string} key - Redis key
   * @param {string|Buffer} value - Value to set
   * @param {string} [expireMode='EX'] - Expiration mode (EX, PX)
   * @param {number} [ttl] - Time to live
   * @returns {Promise<boolean>} - Success status
   */
  async set(key, value, expireMode = 'EX', ttl) {
    if (!this.isConnected()) return false;
    
    try {
      if (ttl) {
        return await this.client.set(key, value, expireMode, ttl);
      } else {
        return await this.client.set(key, value);
      }
    } catch (err) {
      logger.error({ error: err.message, key }, 'Redis set error');
      return false;
    }
  }
  
  /**
   * Delete key(s) from Redis
   * @param {string|string[]} keys - Key or keys to delete
   * @returns {Promise<number>} - Number of keys deleted
   */
  async del(keys) {
    if (!this.isConnected()) return 0;
    
    try {
      return await this.client.del(keys);
    } catch (err) {
      logger.error({ error: err.message, keys }, 'Redis del error');
      return 0;
    }
  }
  
  /**
   * Get all keys matching a pattern
   * @param {string} pattern - Pattern to match
   * @returns {Promise<string[]>} - Array of matching keys
   */
  async keys(pattern) {
    if (!this.isConnected()) return [];
    
    try {
      return await this.client.keys(pattern);
    } catch (err) {
      logger.error({ error: err.message, pattern }, 'Redis keys error');
      return [];
    }
  }
  
  /**
   * Increment a key
   * @param {string} key - Key to increment
   * @returns {Promise<number>} - New value
   */
  async incr(key) {
    if (!this.isConnected()) return 0;
    
    try {
      return await this.client.incr(key);
    } catch (err) {
      logger.error({ error: err.message, key }, 'Redis incr error');
      return 0;
    }
  }
  
  /**
   * Decrement a key
   * @param {string} key - Key to decrement
   * @returns {Promise<number>} - New value
   */
  async decr(key) {
    if (!this.isConnected()) return 0;
    
    try {
      return await this.client.decr(key);
    } catch (err) {
      logger.error({ error: err.message, key }, 'Redis decr error');
      return 0;
    }
  }
  
  /**
   * Set expiration on a key
   * @param {string} key - Key to set expiration on
   * @param {number} seconds - TTL in seconds
   * @returns {Promise<number>} - 1 if successful, 0 otherwise
   */
  async expire(key, seconds) {
    if (!this.isConnected()) return 0;
    
    try {
      return await this.client.expire(key, seconds);
    } catch (err) {
      logger.error({ error: err.message, key }, 'Redis expire error');
      return 0;
    }
  }
  
  /**
   * Get TTL of a key
   * @param {string} key - Key to get TTL for
   * @returns {Promise<number>} - TTL in seconds
   */
  async ttl(key) {
    if (!this.isConnected()) return -2;
    
    try {
      return await this.client.ttl(key);
    } catch (err) {
      logger.error({ error: err.message, key }, 'Redis ttl error');
      return -2;
    }
  }
  
  /**
   * Run a health check on the Redis connection
   * @returns {Promise<boolean>} - Whether Redis is healthy
   */
  async healthCheck() {
    if (!this.isConnected()) return false;
    
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (err) {
      logger.error({ error: err.message }, 'Redis health check failed');
      return false;
    }
  }
  
  /**
   * Create a Redis pipeline
   * @returns {object|null} - Redis pipeline object or null if not connected
   */
  pipeline() {
    if (!this.isConnected()) return null;
    return this.client.pipeline();
  }
  
  /**
   * Create a Redis multi (transaction)
   * @returns {object|null} - Redis multi object or null if not connected
   */
  multi() {
    if (!this.isConnected()) return null;
    return this.client.multi();
  }
  
  /**
   * Quit Redis connection (for graceful shutdown)
   * @returns {Promise<string>} - OK if successful
   */
  async quit() {
    if (!this.isConnected()) return 'OK';
    
    try {
      this.connected = false;
      return await this.client.quit();
    } catch (err) {
      logger.error({ error: err.message }, 'Redis quit error');
      return 'ERROR';
    }
  }
}

// Create and export the Redis service singleton
const redisService = new RedisService();
module.exports = redisService;