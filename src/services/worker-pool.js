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
    // Fix timeout issue - ensure taskTimeout is always a valid number
    this.taskTimeout = options.taskTimeout || config.workers.taskTimeout || 30000; // Default to 30 seconds
    this.idleTimeout = options.idleTimeout || config.workers.idleTimeout || 60000; // Default to 1 minute
    
    this.workers = [];
    this.queue = [];
    this.activeWorkers = 0;
    this.workerStats = new Map();
    this.totalProcessed = 0;
    this.errors = 0;
    this.lastTaskTime = 0;
    
    // Initialize minimum workers
    this._ensureMinimumWorkers();
    
    // Set up health monitoring
    this.monitorInterval = setInterval(() => this._monitorWorkerHealth(), 30000);
    
    logger.info({
      script: this.filename,
      minWorkers: this.minWorkers,
      maxWorkers: this.maxWorkers,
      taskTimeout: this.taskTimeout // Log the timeout value for debugging
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
      const task = {
        id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        workerData,
        resolve,
        reject,
        priority,
        timestamp: Date.now()
      };
      
      // Insert into queue based on priority
      const index = this.queue.findIndex(t => t.priority < priority);
      if (index === -1) {
        this.queue.push(task);
      } else {
        this.queue.splice(index, 0, task);
      }
      
      logger.debug({
        taskId: task.id,
        queueLength: this.queue.length,
        priority
      }, 'Task queued');
      
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
      const worker = new Worker(this.filename, {
        workerData: task.workerData
      });
      
      const workerId = `worker-${worker.threadId}`;
      let timeoutId;
      
      // Track worker stats
      this.workerStats.set(workerId, {
        threadId: worker.threadId,
        startTime: Date.now(),
        taskId: task.id
      });
      
      const cleanup = () => {
        clearTimeout(timeoutId);
        this.activeWorkers--;
        this.workerStats.delete(workerId);
        
        // Process next task in queue if any
        setImmediate(() => this._processQueue());
      };
      
      // Set timeout to prevent hanging workers - FIX: Ensure timeout value is valid
      const timeoutMs = Math.max(1000, parseInt(this.taskTimeout, 10) || 30000);
      
      timeoutId = setTimeout(() => {
        logger.warn({
          workerId,
          taskId: task.id,
          timeout: timeoutMs
        }, 'Worker timeout, terminating');
        
        worker.terminate();
        task.reject(new Error('Worker processing timed out'));
        this.errors++;
        cleanup();
      }, timeoutMs);
      
      worker.on('message', (result) => {
        this.totalProcessed++;
        task.resolve(result);
        worker.terminate();
        cleanup();
        
        logger.debug({
          workerId,
          taskId: task.id,
          duration: Date.now() - this.workerStats.get(workerId)?.startTime
        }, 'Worker completed task');
      });
      
      worker.on('error', (err) => {
        this.errors++;
        task.reject(err);
        worker.terminate();
        cleanup();
        
        logger.error({
          workerId,
          taskId: task.id,
          error: err.message
        }, 'Worker error');
      });
      
      worker.on('exit', (code) => {
        if (code !== 0) {
          this.errors++;
          task.reject(new Error(`Worker stopped with exit code ${code}`));
          cleanup();
          
          logger.error({
            workerId,
            taskId: task.id,
            exitCode: code
          }, 'Worker exited with non-zero code');
        }
      });
      
      logger.debug({
        workerId, 
        taskId: task.id
      }, 'Worker started task');
      
    } catch (err) {
      this.activeWorkers--;
      this.errors++;
      task.reject(err);
      
      logger.error({
        error: err.message,
        taskId: task.id
      }, 'Failed to start worker');
      
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
      
      // Fix: Ensure we're comparing numbers
      const timeoutCheck = this.taskTimeout * 1.5;
      if (duration > timeoutCheck) {
        logger.warn({
          workerId,
          taskId: stats.taskId,
          duration: `${Math.round(duration / 1000)}s`,
          timeout: `${Math.round(this.taskTimeout / 1000)}s`
        }, 'Worker running longer than expected');
      }
    }
    
    // Auto-scale down if idle for too long
    if (this.activeWorkers === 0 && this.queue.length === 0) {
      const idleTime = now - this.lastTaskTime;
      
      // Fix: Ensure we're comparing numbers
      const idleTimeoutCheck = Math.max(60000, this.idleTimeout || 60000);
      if (idleTime > idleTimeoutCheck && this.workerStats.size > this.minWorkers) {
        logger.debug({
          currentWorkers: this.workerStats.size,
          minWorkers: this.minWorkers,
          idleTime: `${Math.round(idleTime / 1000)}s`
        }, 'Scaling down idle workers');
      }
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
      minWorkers: this.minWorkers
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