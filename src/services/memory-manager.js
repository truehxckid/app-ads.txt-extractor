// src/services/memory-manager.js

'use strict';

const config = require('../config');
const { getLogger } = require('../utils/logger');

const logger = getLogger('memory-manager');

/**
 * Memory Manager Service
 * Provides utilities for monitoring and optimizing memory usage
 */
class MemoryManager {
  constructor() {
    this.isEnabled = true;
    this.config = config.memory;
    this.canForceGc = typeof global.gc === 'function';
    this.stats = {
      gcCalls: 0,
      lastGcTime: 0,
      memoryChecks: 0,
      highWatermarkRss: 0,
      highWatermarkHeap: 0
    };
    
    // Track memory usage over time
    this.memoryHistory = [];
    this.MAX_HISTORY_ITEMS = 100;
    
    // Initialize periodic garbage collection if enabled
    if (this.config.enableForcedGc && this.canForceGc) {
      this.gcInterval = setInterval(() => {
        this.checkMemoryUsage();
      }, this.config.gcIntervalMs);
      
      // Prevent the interval from keeping Node.js running
      this.gcInterval.unref();
      
      logger.info({
        enableForcedGc: this.config.enableForcedGc,
        heapUsageThreshold: this.config.heapUsageThreshold,
        gcIntervalMs: this.config.gcIntervalMs
      }, 'Memory manager initialized with forced GC');
    } else {
      logger.info('Memory manager initialized without forced GC');
    }
  }
  
  /**
   * Check current memory usage and force GC if needed
   * @returns {Object} Memory usage information
   */
  checkMemoryUsage() {
    try {
      this.stats.memoryChecks++;
      
      // Get current memory usage
      const memUsage = process.memoryUsage();
      const memoryData = {
        rss: Math.round(memUsage.rss / (1024 * 1024)),
        heapTotal: Math.round(memUsage.heapTotal / (1024 * 1024)),
        heapUsed: Math.round(memUsage.heapUsed / (1024 * 1024)),
        external: Math.round(memUsage.external / (1024 * 1024)),
        arrayBuffers: memUsage.arrayBuffers ? Math.round(memUsage.arrayBuffers / (1024 * 1024)) : undefined,
        timestamp: Date.now()
      };
      
      // Update high watermarks
      if (memoryData.rss > this.stats.highWatermarkRss) {
        this.stats.highWatermarkRss = memoryData.rss;
      }
      
      if (memoryData.heapUsed > this.stats.highWatermarkHeap) {
        this.stats.highWatermarkHeap = memoryData.heapUsed;
      }
      
      // Add to history
      this.memoryHistory.push(memoryData);
      if (this.memoryHistory.length > this.MAX_HISTORY_ITEMS) {
        this.memoryHistory.shift(); // Remove oldest
      }
      
      // Calculate heap usage ratio
      const heapUsageRatio = memUsage.heapUsed / memUsage.heapTotal;
      
      // Force garbage collection if heap usage is above threshold
      if (
        this.config.enableForcedGc && 
        this.canForceGc && 
        heapUsageRatio > this.config.heapUsageThreshold
      ) {
        const timeSinceLastGc = Date.now() - this.stats.lastGcTime;
        
        // Only force GC if it's been at least 5 seconds since last forced GC
        if (timeSinceLastGc > 5000) {
          this.forceGarbageCollection();
          
          // Log memory usage after GC
          const afterGc = process.memoryUsage();
          const memoryFreed = memUsage.heapUsed - afterGc.heapUsed;
          
          logger.info({
            memoryBefore: {
              heapUsed: `${Math.round(memUsage.heapUsed / (1024 * 1024))}MB`,
              heapTotal: `${Math.round(memUsage.heapTotal / (1024 * 1024))}MB`
            },
            memoryAfter: {
              heapUsed: `${Math.round(afterGc.heapUsed / (1024 * 1024))}MB`,
              heapTotal: `${Math.round(afterGc.heapTotal / (1024 * 1024))}MB`
            },
            memoryFreed: `${Math.round(memoryFreed / (1024 * 1024))}MB`,
            heapUsageRatio: heapUsageRatio.toFixed(2)
          }, 'Forced garbage collection complete');
        }
      }
      
      return memoryData;
    } catch (err) {
      logger.error({ error: err.message }, 'Error checking memory usage');
      return null;
    }
  }
  
  /**
   * Force garbage collection
   * @returns {boolean} Whether GC was performed
   */
  forceGarbageCollection() {
    if (!this.canForceGc) {
      logger.debug('Force GC not available - run Node with --expose-gc');
      return false;
    }
    
    try {
      // Record stats
      this.stats.gcCalls++;
      this.stats.lastGcTime = Date.now();
      
      // Call garbage collector
      global.gc();
      
      return true;
    } catch (err) {
      logger.error({ error: err.message }, 'Error forcing garbage collection');
      return false;
    }
  }
  
  /**
   * Get memory usage statistics
   * @returns {Object} Memory statistics
   */
  getStats() {
    try {
      // Get current memory usage
      const memUsage = process.memoryUsage();
      
      return {
        current: {
          rss: Math.round(memUsage.rss / (1024 * 1024)),
          heapTotal: Math.round(memUsage.heapTotal / (1024 * 1024)),
          heapUsed: Math.round(memUsage.heapUsed / (1024 * 1024)),
          external: Math.round(memUsage.external / (1024 * 1024)),
          arrayBuffers: memUsage.arrayBuffers ? Math.round(memUsage.arrayBuffers / (1024 * 1024)) : undefined
        },
        highWatermark: {
          rss: this.stats.highWatermarkRss,
          heap: this.stats.highWatermarkHeap
        },
        history: this.memoryHistory.slice(-10), // Return last 10 entries
        gcStats: {
          gcCalls: this.stats.gcCalls,
          lastGcTime: this.stats.lastGcTime,
          memoryChecks: this.stats.memoryChecks,
          canForceGc: this.canForceGc
        },
        config: {
          enableForcedGc: this.config.enableForcedGc,
          heapUsageThreshold: this.config.heapUsageThreshold,
          gcIntervalMs: this.config.gcIntervalMs
        }
      };
    } catch (err) {
      logger.error({ error: err.message }, 'Error getting memory stats');
      return {
        error: 'Failed to get memory statistics',
        canForceGc: this.canForceGc
      };
    }
  }
  
  /**
   * Get estimated memory required for an operation
   * @param {number} inputSize - Size of input data in bytes
   * @param {string} operationType - Type of operation
   * @returns {number} Estimated memory requirement in MB
   */
  estimateMemoryRequirement(inputSize, operationType = 'generic') {
    // Default multiplication factor based on operation type
    const memoryFactors = {
      'string-processing': 2.5,  // String processing (like search)
      'json-parsing': 5,         // JSON parsing (object creation overhead)
      'dom-processing': 10,      // DOM processing (high overhead)
      'generic': 3               // Default factor
    };
    
    const factor = memoryFactors[operationType] || memoryFactors.generic;
    
    // Calculate estimated memory in MB with 20% buffer
    return Math.ceil((inputSize * factor * 1.2) / (1024 * 1024));
  }
  
  /**
   * Check if there's enough available memory for an operation
   * @param {number} requiredMb - Required memory in MB
   * @returns {boolean} Whether operation can proceed
   */
  hasEnoughMemory(requiredMb) {
    try {
      const memUsage = process.memoryUsage();
      
      // Calculate free heap memory (with 10% buffer)
      const heapTotalMb = memUsage.heapTotal / (1024 * 1024);
      const heapUsedMb = memUsage.heapUsed / (1024 * 1024);
      const freeHeapMb = (heapTotalMb - heapUsedMb) * 0.9;
      
      // Check if we have enough free memory
      const hasEnough = freeHeapMb >= requiredMb;
      
      if (!hasEnough) {
        logger.warn({
          requiredMb,
          freeHeapMb: Math.round(freeHeapMb),
          heapTotalMb: Math.round(heapTotalMb),
          heapUsedMb: Math.round(heapUsedMb)
        }, 'Insufficient memory for operation');
        
        // Try forced GC to free memory
        if (this.canForceGc) {
          this.forceGarbageCollection();
          
          // Check again after GC
          const afterGcUsage = process.memoryUsage();
          const afterHeapUsedMb = afterGcUsage.heapUsed / (1024 * 1024);
          const afterFreeHeapMb = (heapTotalMb - afterHeapUsedMb) * 0.9;
          
          return afterFreeHeapMb >= requiredMb;
        }
      }
      
      return hasEnough;
    } catch (err) {
      logger.error({ error: err.message }, 'Error checking memory availability');
      return false; // Conservative approach
    }
  }
  
  /**
   * Shutdown memory manager
   */
  shutdown() {
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
    }
    
    logger.info('Memory manager shutdown');
  }
}

// Create and export a singleton instance
const memoryManager = new MemoryManager();
module.exports = memoryManager;