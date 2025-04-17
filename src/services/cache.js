/**
 * Enhanced Cache Service for App-Ads.txt Extractor
 * Provides multi-level caching with memory, file, and optional Redis backends
 */

'use strict';

const path = require('path');
const fs = require('../utils/fs');
const config = require('../config');
const { cacheConfig, getTtl } = require('../config/cache');
const { getLogger } = require('../utils/logger');
const redis = require('./redis');

const logger = getLogger('cache');

/**
 * Enhanced Cache class with multi-backend support
 */
class EnhancedCache {
  constructor() {
    // Initialize memory cache
    this.memoryCache = new Map();
    
    // Statistics for cache operations
    this.stats = {
      memory: { hits: 0, misses: 0 },
      file: { hits: 0, misses: 0 },
      redis: { hits: 0, misses: 0 },
      operations: { get: 0, set: 0, delete: 0 }
    };
    
    // Setup cleanup interval
    this.cleanupInterval = setInterval(
      () => this.cleanup(),
      cacheConfig.cleanup.interval
    );
    
    // Log initialization
    logger.info({
      memoryEnabled: true,
      fileEnabled: cacheConfig.file.enabled,
      redisEnabled: !!redis.isConnected()
    }, 'Cache initialized');
  }
  
  /**
   * Get file path for a cache key
   * @param {string} key - Cache key
   * @returns {string} - File path
   */
  getFilePath(key) {
    return path.join(config.dirs.cache, fs.keyToFilename(key));
  }
  
  /**
   * Get item from cache
   * @param {string} key - Cache key
   * @returns {any|null} - Cached value or null if not found
   */
  async get(key) {
    if (!key) {
      return null;
    }
    
    this.stats.operations.get++;
    
    try {
      // First try memory cache
      if (this.memoryCache.has(key)) {
        const item = this.memoryCache.get(key);
        
        if (Date.now() < item.expiry) {
          this.stats.memory.hits++;
          logger.debug({ key, backend: 'memory' }, 'Cache hit');
          return item.value;
        }
        
        // Remove expired item
        this.memoryCache.delete(key);
      }
      
      // Then try Redis if available
      if (redis.isConnected()) {
        const redisItem = await redis.get(`cache:${key}`);
        
        if (redisItem) {
          try {
            const parsedItem = JSON.parse(redisItem);
            
            if (Date.now() < parsedItem.expiry) {
              // Store in memory cache for faster access next time
              this._storeInMemory(key, parsedItem.value, parsedItem.expiry);
              
              this.stats.redis.hits++;
              logger.debug({ key, backend: 'redis' }, 'Cache hit');
              return parsedItem.value;
            }
          } catch (parseErr) {
            logger.error({ key, error: parseErr.message }, 'Redis parse error');
            await redis.del(`cache:${key}`);
          }
        }
        
        this.stats.redis.misses++;
      }
      
      // Finally try file cache
      if (cacheConfig.file.enabled) {
        const filePath = this.getFilePath(key);
        const fileData = await fs.readFromFile(filePath);
        
        if (fileData && fileData.expiry && Date.now() < fileData.expiry) {
          // Store in memory cache for faster access next time
          this._storeInMemory(key, fileData.value, fileData.expiry);
          
          this.stats.file.hits++;
          logger.debug({ key, backend: 'file' }, 'Cache hit');
          return fileData.value;
        }
        
        // Remove expired file
        fs.deleteFile(filePath);
        this.stats.file.misses++;
      }
      
      // Not found in any cache
      logger.debug({ key }, 'Cache miss');
      return null;
    } catch (err) {
      logger.error({ key, error: err.message }, 'Cache get error');
      return null;
    }
  }
  
  /**
   * Set item in cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number|string} ttl - TTL in hours or as a string key from config.ttl
   * @returns {Promise<boolean>} - Success status
   */
  async set(key, value, ttl = 'default') {
    if (!key || value === undefined || value === null) {
      return false;
    }
    
    this.stats.operations.set++;
    
    try {
      // Calculate expiry time
      const ttlMs = typeof ttl === 'string'
        ? getTtl(ttl)
        : ttl * 60 * 60 * 1000; // Convert hours to ms
      
      const expiry = Date.now() + ttlMs;
      
      // Store in memory
      this._storeInMemory(key, value, expiry);
      
      // Store in Redis if available
      if (redis.isConnected()) {
        try {
          const ttlSeconds = Math.ceil(ttlMs / 1000);
          const item = JSON.stringify({ value, expiry });
          
          if (cacheConfig.redis.compressionEnabled && 
              typeof item === 'string' && 
              item.length > cacheConfig.file.compressionThreshold) {
            // Store with compression for large items
            const compressed = await fs.gzip(Buffer.from(item));
            await redis.set(`cache:${key}:compressed`, compressed, 'EX', ttlSeconds);
          } else {
            // Store normally for smaller items
            await redis.set(`cache:${key}`, item, 'EX', ttlSeconds);
          }
        } catch (redisErr) {
          logger.error({ key, error: redisErr.message }, 'Redis set error');
        }
      }
      
      // Store in file if enabled
      if (cacheConfig.file.enabled) {
        const filePath = this.getFilePath(key);
        const data = { value, expiry };
        await fs.saveToFile(filePath, data, cacheConfig.file.compression);
      }
      
      logger.debug({ key, ttl: ttlMs / 3600000 }, 'Item cached');
      return true;
    } catch (err) {
      logger.error({ key, error: err.message }, 'Cache set error');
      return false;
    }
  }
  
  /**
   * Delete item from cache
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} - Success status
   */
  async delete(key) {
    if (!key) {
      return false;
    }
    
    this.stats.operations.delete++;
    
    try {
      // Remove from memory
      this.memoryCache.delete(key);
      
      // Remove from Redis if connected
      if (redis.isConnected()) {
        await redis.del(`cache:${key}`);
        await redis.del(`cache:${key}:compressed`);
      }
      
      // Remove from file if enabled
      if (cacheConfig.file.enabled) {
        const filePath = this.getFilePath(key);
        fs.deleteFile(filePath);
      }
      
      logger.debug({ key }, 'Item removed from cache');
      return true;
    } catch (err) {
      logger.error({ key, error: err.message }, 'Cache delete error');
      return false;
    }
  }
  
  /**
   * Store item in memory cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} expiry - Expiry timestamp
   * @private
   */
  _storeInMemory(key, value, expiry) {
    // Prevent memory cache from growing too large
    if (this.memoryCache.size >= cacheConfig.memory.maxItems) {
      this._evictMemoryItems();
    }
    
    this.memoryCache.set(key, { value, expiry });
  }
  
  /**
   * Evict items from memory cache when it's full
   * @private
   */
  _evictMemoryItems() {
    // Remove expired items first
    const now = Date.now();
    let removedCount = 0;
    
    for (const [key, item] of this.memoryCache.entries()) {
      if (now >= item.expiry) {
        this.memoryCache.delete(key);
        removedCount++;
      }
    }
    
    // If still too many items, remove oldest
    if (this.memoryCache.size >= cacheConfig.memory.maxItems) {
      // Convert to array, sort by expiry, keep newest ones
      const cacheItems = Array.from(this.memoryCache.entries());
      cacheItems.sort((a, b) => a[1].expiry - b[1].expiry);
      
      // Remove oldest 20% of items
      const removeCount = Math.ceil(cacheConfig.memory.maxItems * 0.2);
      cacheItems.slice(0, removeCount).forEach(([key]) => {
        this.memoryCache.delete(key);
        removedCount++;
      });
    }
    
    if (removedCount > 0) {
      logger.debug({ removedCount }, 'Evicted items from memory cache');
    }
  }
  
  /**
   * Perform cache cleanup
   */
  async cleanup() {
    const startTime = Date.now();
    
    try {
      // Cleanup memory cache
      const now = Date.now();
      let memoryItemsRemoved = 0;
      
      for (const [key, item] of this.memoryCache.entries()) {
        if (now >= item.expiry) {
          this.memoryCache.delete(key);
          memoryItemsRemoved++;
        }
      }
      
      // Cleanup file cache if enabled
      if (cacheConfig.file.enabled) {
        await this._cleanupFileCache();
      }
      
      // Cleanup Redis items is handled by Redis TTL
      
      const duration = Date.now() - startTime;
      logger.info({ 
        memoryItemsRemoved, 
        duration: `${duration}ms` 
      }, 'Cache cleanup completed');
    } catch (err) {
      logger.error({ error: err.message }, 'Cache cleanup error');
    }
  }
  
  /**
   * Clean up file cache
   * @private
   */
  async _cleanupFileCache() {
    const cacheDir = config.dirs.cache;
    const files = fs.scanDirectory(cacheDir);
    let filesRemoved = 0;
    
    // Process files in batches
    const batches = [];
    for (let i = 0; i < files.length; i += cacheConfig.cleanup.batchSize) {
      batches.push(files.slice(i, i + cacheConfig.cleanup.batchSize));
    }
    
    for (const batch of batches) {
      await Promise.all(batch.map(async (filePath) => {
        try {
          const data = await fs.readFromFile(filePath);
          
          if (data && data.expiry && Date.now() >= data.expiry) {
            await fs.deleteFile(filePath);
            filesRemoved++;
          }
        } catch (err) {
          // If file is corrupted, delete it
          logger.error({ filePath, error: err.message }, 'Error processing cache file');
          await fs.deleteFile(filePath);
          filesRemoved++;
        }
      }));
    }
    
    if (filesRemoved > 0) {
      logger.debug({ filesRemoved }, 'Cleaned up file cache');
    }
  }
  
  /**
   * Get cache statistics
   * @returns {object} - Statistics object
   */
  getStats() {
    const totalHits = this.stats.memory.hits + this.stats.file.hits + this.stats.redis.hits;
    const totalMisses = this.stats.memory.misses + this.stats.file.misses + this.stats.redis.misses;
    const total = totalHits + totalMisses;
    
    return {
      hits: totalHits,
      misses: totalMisses,
      hitRate: total > 0 ? Math.round((totalHits / total) * 100) + '%' : '0%',
      memory: {
        ...this.stats.memory,
        size: this.memoryCache.size,
        maxSize: cacheConfig.memory.maxItems
      },
      file: this.stats.file,
      redis: this.stats.redis,
      operations: this.stats.operations
    };
  }
  
  /**
   * Clear cache when needed (e.g., for testing)
   */
  async clear() {
    // Clear memory cache
    this.memoryCache.clear();
    
    // Clear file cache
    if (cacheConfig.file.enabled) {
      const cacheDir = config.dirs.cache;
      const files = fs.scanDirectory(cacheDir);
      
      for (const file of files) {
        await fs.deleteFile(file);
      }
    }
    
    // Clear Redis cache keys with our prefix
    if (redis.isConnected()) {
      try {
        const keys = await redis.keys('cache:*');
        if (keys.length > 0) {
          await redis.del(keys);
        }
      } catch (err) {
        logger.error({ error: err.message }, 'Error clearing Redis cache');
      }
    }
    
    // Reset stats
    this.stats = {
      memory: { hits: 0, misses: 0 },
      file: { hits: 0, misses: 0 },
      redis: { hits: 0, misses: 0 },
      operations: { get: 0, set: 0, delete: 0 }
    };
    
    logger.info('Cache cleared');
  }
}

// Create and export a singleton instance
const cache = new EnhancedCache();
module.exports = cache;