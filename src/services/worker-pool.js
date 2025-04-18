/**
 * Worker Pool service for App-Ads.txt Extractor
 * Manages worker threads for CPU-intensive tasks
 */

'use strict';

const path = require('path');
const { Worker } = require('worker_threads');
const config = require('../config');
const { getLogger } = require('../utils/logger');

const logger = getLogger('worker-pool');

/**
 * Task priority levels
 */
const Priority = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  CRITICAL: 3
};

/**
 * Enhanced Worker Pool with task prioritization and health monitoring
 */
class WorkerPool {
  /**
   * Create a new worker pool
   * @param {string} filename - Worker script filename
   * @param {object} options - Pool options
   */
  constructor(filename, options = {}) {
    this.filename = filename;
    this.maxWorkers = options.maxWorkers || config.workers.maxWorkers;
    this.minWorkers = options.minWorkers || config.workers.minWorkers;
    
    // Default timeout values
    const defaultTaskTimeout = 30000; // 30 seconds
    const defaultIdleTimeout = 60000; // 60 seconds
    
    // Properly validate and set timeout values
    this.taskTimeout = typeof options.taskTimeout === 'number' && !isNaN(options.taskTimeout) && options.taskTimeout > 0
      ? options.taskTimeout 
      : (typeof config.workers.taskTimeout === 'number' && !isNaN(config.workers.taskTimeout) && config.workers.taskTimeout > 0
         ? config.workers.taskTimeout 
         : defaultTaskTimeout);
         
    this.idleTimeout = typeof options.idleTimeout === 'number' && !isNaN(options.idleTimeout) && options.idleTimeout > 0
      ? options.idleTimeout
      : (typeof config.workers.idleTimeout === 'number' && !isNaN(config.workers.idleTimeout) && config.workers.idleTimeout > 0
         ? config.workers.idleTimeout
         : defaultIdleTimeout);
    
    this.workers = [];
    this.queue = [];
    this.activeWorkers = 0;
    this.workerStats = new Map();
    this.totalProcessed = 0;
    this.errors = 0;
    this.lastTaskTime = 0;
    
    // Add logging to debug timeout values
    logger.info({
      taskTimeout: this.taskTimeout,
      idleTimeout: this.idleTimeout
    }, 'Worker pool timeouts initialized');
    
    // Initialize minimum workers
    this._ensureMinimumWorkers();
    
    // Set up health monitoring
    this.monitorInterval = setInterval(() => this._monitorWorkerHealth(), 30000);
    
    logger.info({
      script: this.filename,
      minWorkers: this.minWorkers,
      maxWorkers: this.maxWorkers,
      taskTimeout: this.taskTimeout,
      idleTimeout: this.idleTimeout
    }, 'Worker pool initialized');
  }
  
  /**
   * Run a task with the worker pool
   * @param {any} workerData - Data to pass to the worker
   * @param {number} [priority=1] - Task priority (0-3)
   * @returns {Promise<any>} - Worker results
   */
  async runTask(workerData, priority = Priority.NORMAL) {
    this.lastTaskTime = Date.now();
    
    return new Promise((resolve, reject) => {
      // Validate worker data
      if (!workerData) {
        reject(new Error('Worker data is required'));
        return;
      }
      
      // Generate unique task ID
      const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const task = {
        id: taskId,
        workerData,
        resolve,
        reject,
        priority,
        timestamp: Date.now()
      };
      
      // Log data size to help troubleshoot memory issues
      let dataSizeEstimate = 0;
      if (workerData.content) {
        dataSizeEstimate = workerData.content.length;
      }
      
      logger.debug({
        taskId: task.id,
        queueLength: this.queue.length,
        priority,
        dataSizeKB: Math.round(dataSizeEstimate / 1024)
      }, 'Task queued');
      
      // Insert into queue based on priority
      const index = this.queue.findIndex(t => t.priority < priority);
      if (index === -1) {
        this.queue.push(task);
      } else {
        this.queue.splice(index, 0, task);
      }
      
      // Process queue
      this._processQueue();
    });
  }
  
  /**
   * Process the task queue
   * @private
   */
  _processQueue() {
    // Ensure we have minimum workers
    this._ensureMinimumWorkers();
    
    // Process as many tasks as we have workers available
    while (this.queue.length > 0 && this.activeWorkers < this.maxWorkers) {
      const task = this.queue.shift();
      this._runWorker(task);
    }
    
    if (this.queue.length > 0) {
      logger.debug({
        queueLength: this.queue.length,
        activeWorkers: this.activeWorkers
      }, 'Tasks waiting in queue');
    }
  }
  
  /**
   * Run a task with a worker
   * @param {object} task - Task object
   * @private
   */
  _runWorker(task) {
    this.activeWorkers++;
    
    try {
      const workerOptions = {
        workerData: task.workerData
      };
      
      // Create a new worker thread
      const worker = new Worker(this.filename, workerOptions);
      
      const workerId = `worker-${worker.threadId}`;
      let timeoutId;
      let progressInterval;
      
      // Track worker stats
      this.workerStats.set(workerId, {
        threadId: worker.threadId,
        startTime: Date.now(),
        taskId: task.id,
        lastProgressTime: Date.now()
      });
      
      // Cleanup function to handle worker termination
      const cleanup = () => {
        clearTimeout(timeoutId);
        clearInterval(progressInterval);
        this.activeWorkers--;
        this.workerStats.delete(workerId);
        
        // Process next task in queue if any
        setImmediate(() => this._processQueue());
      };
      
      // Set up a progress check interval for long-running tasks
      progressInterval = setInterval(() => {
        const stats = this.workerStats.get(workerId);
        if (stats) {
          const runningTime = Date.now() - stats.startTime;
          const sinceLastProgress = Date.now() - (stats.lastProgressTime || stats.startTime);
          
          // Log progress for long-running tasks
          if (runningTime > 5000 && sinceLastProgress > 5000) {
            logger.debug({
              workerId,
              taskId: task.id,
              runningTime: `${Math.round(runningTime / 1000)}s`,
              sinceLastProgress: `${Math.round(sinceLastProgress / 1000)}s`
            }, 'Worker still running');
          }
        }
      }, 5000);
      
      // Explicitly log the timeout value for debugging
      logger.debug({
        workerId,
        taskId: task.id,
        taskTimeout: this.taskTimeout
      }, 'Setting worker timeout');
      
      // Set up timeout to terminate stuck workers
      timeoutId = setTimeout(() => {
        logger.warn({
          workerId,
          taskId: task.id,
          timeout: this.taskTimeout,
          memoryUsage: process.memoryUsage()
        }, 'Worker timeout, terminating');
        
        try {
          worker.terminate();
        } catch (termErr) {
          logger.error({
            workerId,
            taskId: task.id,
            error: termErr.message
          }, 'Error terminating worker');
        }
        
        task.reject(new Error(`Worker processing timed out after ${this.taskTimeout}ms`));
        this.errors++;
        cleanup();
      }, this.taskTimeout);
      
      // Handle worker messages
      worker.on('message', (result) => {
        try {
          // Update progress timestamp
          const stats = this.workerStats.get(workerId);
          if (stats) {
            stats.lastProgressTime = Date.now();
          }
          
          // Handle progress messages without completing the task
          if (result.progress && result.success === true) {
            logger.debug({
              workerId,
              taskId: task.id,
              progress: result.progress
            }, 'Worker progress update');
            return;
          }
          
          // Handle warning messages
          if (result.warning) {
            logger.warn({
              workerId,
              taskId: task.id,
              warning: result.warning,
              lineError: result.lineError
            }, 'Worker warning');
            return;
          }
          
          // Handle worker errors that don't cause termination
          if (result.error && result.success === false) {
            logger.error({
              workerId,
              taskId: task.id,
              error: result.error,
              errorDetails: result.errorDetails || 'No details provided'
            }, 'Worker reported error');
            
            this.errors++;
            task.reject(new Error(result.error));
            worker.terminate();
            cleanup();
            return;
          }
          
          // Log performance metrics for successful tasks
          if (result.processingTime) {
            logger.debug({
              workerId,
              taskId: task.id,
              processingTime: `${result.processingTime}ms`,
              contentLength: result.contentLength || 'unknown'
            }, 'Worker processing metrics');
          }
          
          // Handle successful result
          this.totalProcessed++;
          task.resolve(result);
          worker.terminate();
          cleanup();
          
          logger.debug({
            workerId,
            taskId: task.id,
            duration: Date.now() - this.workerStats.get(workerId)?.startTime
          }, 'Worker completed task successfully');
        } catch (handlerErr) {
          logger.error({
            workerId,
            taskId: task.id,
            error: handlerErr.message
          }, 'Error handling worker message');
          
          task.reject(handlerErr);
          try {
            worker.terminate();
          } catch (termErr) {
            // Already handled
          }
          cleanup();
        }
      });
      
      // Handle worker errors
      worker.on('error', (err) => {
        this.errors++;
        
        logger.error({
          workerId,
          taskId: task.id,
          error: err.message,
          stack: err.stack
        }, 'Worker thread error event');
        
        task.reject(err);
        
        try {
          worker.terminate();
        } catch (termErr) {
          // Already handled
        }
        
        cleanup();
      });
      
      // Handle worker exit
      worker.on('exit', (code) => {
        if (code !== 0) {
          this.errors++;
          
          // Only reject if not already handled
          if (timeoutId) {
            logger.error({
              workerId,
              taskId: task.id,
              exitCode: code
            }, 'Worker exited with non-zero code');
            
            task.reject(new Error(`Worker stopped with exit code ${code}`));
          }
          
          cleanup();
        } else {
          // Normal exit case - may have already been handled
          cleanup();
        }
      });
      
      logger.debug({
        workerId, 
        taskId: task.id
      }, 'Worker started task');
      
    } catch (err) {
      this.activeWorkers--;
      this.errors++;
      
      logger.error({
        error: err.message,
        stack: err.stack,
        taskId: task.id
      }, 'Failed to start worker');
      
      task.reject(err);
      
      // Try next task
      setImmediate(() => this._processQueue());
    }
  }
  
  /**
   * Ensure minimum number of idle workers
   * @private
   */
  _ensureMinimumWorkers() {
    const currentWorkers = this.workerStats.size;
    const neededWorkers = Math.max(0, this.minWorkers - currentWorkers);
    
    if (neededWorkers > 0) {
      logger.debug({
        currentWorkers,
        minWorkers: this.minWorkers,
        creating: neededWorkers
      }, 'Creating idle workers');
    }
  }
  
  /**
   * Monitor worker health
   * @private
   */
  _monitorWorkerHealth() {
    const now = Date.now();
    
    // Check for long-running workers
    for (const [workerId, stats] of this.workerStats.entries()) {
      const duration = now - stats.startTime;
      
      // Using taskTimeout directly since we've already validated it
      if (duration > this.taskTimeout * 0.8) {
        logger.warn({
          workerId,
          taskId: stats.taskId,
          duration: `${Math.round(duration / 1000)}s`,
          timeout: `${Math.round(this.taskTimeout / 1000)}s`,
          percentComplete: Math.round((duration / this.taskTimeout) * 100) + '%'
        }, 'Worker approaching timeout limit');
      }
    }
    
    // Auto-scale down if idle for too long
    if (this.activeWorkers === 0 && this.queue.length === 0) {
      const idleTime = now - this.lastTaskTime;
      
      // Using idleTimeout directly since we've already validated it
      if (idleTime > this.idleTimeout && this.workerStats.size > this.minWorkers) {
        logger.debug({
          currentWorkers: this.workerStats.size,
          minWorkers: this.minWorkers,
          idleTime: `${Math.round(idleTime / 1000)}s`
        }, 'Scaling down idle workers');
      }
    }
    
    // Log system memory stats periodically
    try {
      const memUsage = process.memoryUsage();
      logger.debug({
        rss: Math.round(memUsage.rss / (1024 * 1024)) + ' MB',
        heapTotal: Math.round(memUsage.heapTotal / (1024 * 1024)) + ' MB',
        heapUsed: Math.round(memUsage.heapUsed / (1024 * 1024)) + ' MB',
        external: Math.round(memUsage.external / (1024 * 1024)) + ' MB',
        activeWorkers: this.activeWorkers,
        queueLength: this.queue.length
      }, 'Worker pool memory usage');
    } catch (memErr) {
      // Ignore memory monitoring errors
    }
  }
  
  /**
   * Get statistics about the worker pool
   * @returns {object} - Statistics object
   */
  getStats() {
    return {
      activeWorkers: this.activeWorkers,
      queueLength: this.queue.length,
      totalProcessed: this.totalProcessed,
      errors: this.errors,
      maxWorkers: this.maxWorkers,
      minWorkers: this.minWorkers,
      taskTimeout: this.taskTimeout,
      idleTimeout: this.idleTimeout
    };
  }
  
  /**
   * Shutdown the worker pool
   */
  shutdown() {
    clearInterval(this.monitorInterval);
    
    // Terminate any existing workers
    for (const [workerId, stats] of this.workerStats.entries()) {
      logger.debug({
        workerId,
        taskId: stats.taskId
      }, 'Terminating worker on shutdown');
      
      // We would terminate the worker here if we had a reference to it
    }
    
    // Reject all queued tasks
    this.queue.forEach(task => {
      task.reject(new Error('Worker pool shutdown'));
    });
    this.queue = [];
    
    logger.info('Worker pool shutdown');
  }
}

// Export the WorkerPool class and priority constants
module.exports = {
  WorkerPool,
  Priority
};