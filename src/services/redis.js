/**
 * Redis service for App-Ads.txt Extractor
 * Handles Redis connection, retries, and provides a consistent interface
 */

'use strict';

const config = require('../config');
const { getLogger } = require('../utils/logger');

const logger = getLogger('redis');

/**
 * Redis service class
 */
class RedisService {
  constructor() {
    this.client = null;
    this.connected = false;
    this.connecting = false;
    this.retryCount = 0;
    this.maxRetries = 5;
    this.retryTimeout = null;
    
    // Initialize Redis if URL is provided
    if (config.redis.url) {
      this.initialize();
    } else {
      logger.info('Redis URL not provided, Redis functionality disabled');
    }
  }
  
  /**
   * Initialize Redis connection
   */
  async initialize() {
    if (this.connecting) return;
    this.connecting = true;
    
    try {
      logger.info('Initializing Redis connection');
      
      // Import Redis dynamically to avoid requiring it when not used
      const Redis = require('ioredis');
      
      this.client = new Redis(config.redis.url, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          const delay = Math.min(times * 200, 3000);
          logger.debug({ retryCount: times, delay }, 'Redis connection retry');
          return delay;
        },
        connectTimeout: 10000,
        keyPrefix: config.redis.prefix,
        lazyConnect: false
      });
      
      // Setup event handlers
      this.client.on('connect', () => {
        this.connected = true;
        this.connecting = false;
        this.retryCount = 0;
        logger.info('Redis connected');
      });
      
      this.client.on('error', (err) => {
        logger.error({ error: err.message }, 'Redis error');
        if (this.connected) {
          this.connected = false;
        }
      });
      
      this.client.on('close', () => {
        if (this.connected) {
          this.connected = false;
          logger.warn('Redis connection closed');
          this._scheduleReconnect();
        }
      });
      
      // Test the connection
      await this.client.ping();
      this.connected = true;
      this.connecting = false;
      this.retryCount = 0;
      logger.info('Redis connection successful');
      
    } catch (err) {
      this.connected = false;
      this.connecting = false;
      logger.error({ error: err.message }, 'Redis initialization failed');
      this._scheduleReconnect();
    }
  }
  
  /**
   * Schedule a reconnection attempt
   * @private
   */
  _scheduleReconnect() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
    
    if (this.retryCount < this.maxRetries) {
      const delay = Math.min(Math.pow(2, this.retryCount) * 1000, 30000);
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
      logger.error({ maxRetries: this.maxRetries }, 'Max Redis reconnection attempts reached');
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