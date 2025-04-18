/**
 * Worker Pool service for App-Ads.txt Extractor with enhanced reliability
 * Manages worker threads for CPU-intensive tasks with memory optimizations
 */

'use strict';

const path = require('path');
const { Worker } = require('worker_threads');
const config = require('../config');
const { getLogger } = require('../utils/logger');
const memoryManager = require('./memory-manager');

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
 * Enhanced Worker Pool with task prioritization, health monitoring, and memory management
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
    
    // Default timeout values with careful validation
    const defaultTaskTimeout = 300000; // 5 minutes
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
    
    // Memory limits for worker threads 
    this.memoryLimits = {
      maxRssMb: options.maxRssMb || config.workers.maxRssMb || 512,
      maxHeapMb: options.maxHeapMb || config.workers.maxHeapMb || 384,
      warningThresholdPercent: options.warningThresholdPercent || 80
    };
      
    this.debugMode = options.debug || false;
    this.workers = new Map(); // Map of worker objects by ID
    this.queue = [];
    this.activeWorkers = 0;
    this.workerStats = new Map();
    this.totalProcessed = 0;
    this.errors = 0;
    this.lastTaskTime = 0;
    
    // Add logging to debug memory limits
    logger.info({
      taskTimeout: this.taskTimeout,
      idleTimeout: this.idleTimeout,
      memoryLimits: this.memoryLimits,
      debugMode: this.debugMode
    }, 'Worker pool initialized with memory limits');
    
    // Initialize minimum workers
    this._ensureMinimumWorkers();
    
    // Set up health monitoring
    this.monitorInterval = setInterval(() => this._monitorWorkerHealth(), 30000);
    
    logger.info({
      script: this.filename,
      minWorkers: this.minWorkers,
      maxWorkers: this.maxWorkers,
      taskTimeout: this.taskTimeout,
      idleTimeout: this.idleTimeout,
      memoryLimits: this.memoryLimits
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
        timestamp: Date.now(),
        debug: [] // Store debug messages from worker
      };
      
      // Log data size to help troubleshoot memory issues
      let dataSizeEstimate = 0;
      if (workerData.content) {
        dataSizeEstimate = workerData.content.length;
      }
      
      // Estimate memory requirement for this task
      const estimatedMemoryMb = memoryManager.estimateMemoryRequirement(
        dataSizeEstimate, 
        'string-processing'
      );
      
      // Check if we have enough memory for this task
      if (estimatedMemoryMb > this.memoryLimits.maxHeapMb * 0.9) {
        logger.warn({
          taskId: task.id,
          dataSizeKB: Math.round(dataSizeEstimate / 1024),
          estimatedMemoryMb,
          maxHeapMb: this.memoryLimits.maxHeapMb
        }, 'Task exceeds worker memory limits');
        
        reject(new Error('Task data size exceeds worker memory limits'));
        return;
      }
      
      logger.debug({
        taskId: task.id,
        queueLength: this.queue.length,
        priority,
        dataSizeKB: Math.round(dataSizeEstimate / 1024),
        estimatedMemoryMb
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
      // Prepare worker environment variables and resource limits
      const workerOptions = {
        workerData: task.workerData,
        // Resource limits (Node.js v14+ feature)
        resourceLimits: {
          maxOldGenerationSizeMb: this.memoryLimits.maxHeapMb,
          maxYoungGenerationSizeMb: Math.floor(this.memoryLimits.maxHeapMb * 0.25),
          codeRangeSizeMb: Math.floor(this.memoryLimits.maxHeapMb * 0.1)
        }
      };
      
      // Create a new worker thread
      const worker = new Worker(this.filename, workerOptions);
      
      const workerId = `worker-${worker.threadId}`;
      let timeoutId;
      let progressInterval;
      let exitHandled = false; // Flag to prevent double handling of worker exit
      
      // Store worker reference
      this.workers.set(workerId, worker);
      
      // Track worker stats
      this.workerStats.set(workerId, {
        threadId: worker.threadId,
        startTime: Date.now(),
        taskId: task.id,
        lastProgressTime: Date.now(),
        worker // Keep reference to worker
      });
      
      logger.debug({
        workerId, 
        taskId: task.id
      }, 'Worker started task');
      
      // Cleanup function to handle worker termination
      const cleanup = (shouldProcessQueue = true) => {
        // Only run cleanup once
        if (exitHandled) return;
        exitHandled = true;
        
        clearTimeout(timeoutId);
        clearInterval(progressInterval);
        this.activeWorkers--;
        this.workerStats.delete(workerId);
        this.workers.delete(workerId);
        
        // Process next task in queue if requested
        if (shouldProcessQueue) {
          setImmediate(() => this._processQueue());
        }
      };

      // Set up timeout to terminate stuck workers
      // With better timeout handling
      timeoutId = setTimeout(() => {
        logger.warn({
          workerId,
          taskId: task.id,
          timeout: this.taskTimeout,
          debugLogs: task.debug.length > 0 ? task.debug.slice(-5) : 'No debug logs',
          memoryUsage: process.memoryUsage()
        }, 'Worker timeout, terminating');
        
        try {
          // Send a signal to the worker that it's about to be terminated
          if (worker.postMessage) {
            try {
              worker.postMessage({ type: 'terminate', reason: 'timeout' });
            } catch (msgErr) {
              // Ignore messaging errors
            }
          }
          
          // Give it a short grace period before force termination
          setTimeout(() => {
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
            cleanup(true);
          }, 200);
        } catch (err) {
          logger.error({
            workerId,
            taskId: task.id,
            error: err.message
          }, 'Error in timeout handler');
          
          task.reject(new Error(`Worker timeout error: ${err.message}`));
          this.errors++;
          cleanup(true);
        }
      }, this.taskTimeout);
      
      // Handle worker messages with improved reliability
      worker.on('message', (result) => {
        try {
          // Update progress timestamp
          const stats = this.workerStats.get(workerId);
          if (stats) {
            stats.lastProgressTime = Date.now();
            
            // Check for memory warnings
            if (result.memoryWarning) {
              logger.warn({
                workerId,
                taskId: task.id,
                memoryUsage: result.memoryUsage,
                warningLevel: result.warningLevel,
                memoryLimits: this.memoryLimits
              }, 'Worker memory warning');
              
              // If critical memory level, terminate worker
              if (result.warningLevel === 'critical') {
                logger.error({
                  workerId,
                  taskId: task.id,
                  memoryUsage: result.memoryUsage,
                  memoryLimits: this.memoryLimits
                }, 'Worker exceeded critical memory limit, terminating');
                
                try {
                  worker.terminate();
                } catch (termErr) {
                  // Ignore termination errors
                }
                
                task.reject(new Error('Worker exceeded memory limits'));
                cleanup();
                return;
              }
            }
          }
          
          // Save debug messages
          if (result.debug === true) {
            task.debug.push({
              timestamp: new Date().toISOString(),
              ...result
            });
            
            if (this.debugMode) {
              logger.debug({
                workerId,
                taskId: task.id,
                debugMessage: result.message,
                timestamp: result.timestamp
              }, 'Worker debug message');
            }
            
            return; // Don't process debug messages as results
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
              errorDetails: result.errorDetails || 'No details provided',
              debugLogs: task.debug.length > 0 ? task.debug.slice(-5) : 'No debug logs'
            }, 'Worker reported error');
            
            this.errors++;
            
            // The worker sent an error but may still be running, so terminate it safely
            try {
              worker.terminate();
            } catch (termErr) {
              // Ignore termination errors here
            }
            
            task.reject(new Error(result.error));
            cleanup();
            return;
          }
          
          // Log performance metrics for successful tasks
          if (result.processingTime) {
            logger.debug({
              workerId,
              taskId: task.id,
              processingTime: `${result.processingTime}ms`,
              contentLength: result.contentLength || 'unknown',
              lineCount: result.lineCount || 'unknown'
            }, 'Worker processing metrics');
          }
          
          // Handle successful result - this is a final result
          this.totalProcessed++;
          
          // Clear timeout since we've received a successful result
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          
          // Resolve the task promise
          task.resolve(result);
          
          // Allow a short delay before terminating to ensure message queue is flushed
          setTimeout(() => {
            try {
              worker.terminate();
            } catch (termErr) {
              // Ignore termination errors for successful completions
            }
            
            // Only clean up after we're sure the worker is done
            cleanup();
            
            logger.debug({
              workerId,
              taskId: task.id,
              duration: Date.now() - this.workerStats.get(workerId)?.startTime
            }, 'Worker completed task successfully');
          }, 100);
        } catch (handlerErr) {
          logger.error({
            workerId,
            taskId: task.id,
            error: handlerErr.message,
            stack: handlerErr.stack
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
          stack: err.stack,
          debugLogs: task.debug.length > 0 ? task.debug.slice(-5) : 'No debug logs'
        }, 'Worker thread error event');
        
        task.reject(err);
        
        try {
          worker.terminate();
        } catch (termErr) {
          // Already handled
        }
        
        cleanup();
      });
      
      // Handle worker exit with improved reliability
      worker.on('exit', (code) => {
        // Clear timeout since worker has exited
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        
        // Check if the worker exited with a non-zero code
        if (code !== 0) {
          // Only count as error if we haven't already handled it and result wasn't already sent
          const workerSuccessfullyCompleted = task.debug.some(d => 
            d.message === 'Worker completed successfully' || 
            d.message === 'Completed app-ads.txt analysis'
          );
          
          // If worker completed its task successfully before exiting with error, don't count as error
          if (!exitHandled && !workerSuccessfullyCompleted) {
            this.errors++;
            
            // Get the most recent debug messages to include in the error
            const recentDebug = task.debug.length > 0 ? task.debug.slice(-10) : [];
            
            logger.error({
              workerId,
              taskId: task.id,
              exitCode: code,
              recentDebugMessages: recentDebug,
              totalDebugCount: task.debug.length
            }, 'Worker exited with non-zero code');
            
            // Only reject if not already handled
            task.reject(new Error(`Worker stopped with exit code ${code}. Check logs for details.`));
            cleanup(true);
          } else if (workerSuccessfullyCompleted && !exitHandled) {
            // Worker did complete successfully despite the exit code
            logger.warn({
              workerId,
              taskId: task.id,
              exitCode: code,
              message: 'Worker exited with non-zero code but had completed its task successfully'
            });
            
            // Look for any final result in debug messages
            const resultMsg = task.debug.find(d => !d.debug && d.success === true);
            
            if (resultMsg) {
              // We have a successful result despite the exit code
              task.resolve(resultMsg);
            } else {
              // Create minimal result based on debug logs
              const result = {
                success: true,
                analyzed: { note: 'Reconstructed from logs after worker success' },
                searchResults: null
              };
              task.resolve(result);
            }
            
            cleanup(true);
          }
        } else {
          // Normal exit case (success)
          logger.debug({
            workerId,
            taskId: task.id,
            exitCode: code
          }, 'Worker exited normally');
          
          // If we haven't already handled this exit (via message), do it now
          if (!exitHandled) {
            // Assume this was a successful exit, but we missed the message
            logger.debug({
              workerId,
              taskId: task.id,
            }, 'Worker exited successfully before sending final result');
            
            // If we have logs indicating successful processing, create a minimal result
            if (task.debug.some(d => d.message === 'Completed app-ads.txt analysis')) {
              const result = {
                success: true,
                analyzed: { note: 'Reconstructed from logs after worker success' },
                searchResults: null
              };
              task.resolve(result);
            } else {
              // Otherwise we can't be sure what happened
              task.reject(new Error('Worker exited without sending complete results'));
            }
            
            cleanup(true);
          }
        }
      });
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
   * Monitor worker health with enhanced memory monitoring
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
        
        // Try to send a message to the worker to check if it's responsive
        try {
          if (stats.worker && typeof stats.worker.postMessage === 'function') {
            // Request memory stats as part of health check
            stats.worker.postMessage({ 
              type: 'health_check',
              requestMemoryStats: true 
            });
          }
        } catch (err) {
          logger.debug({
            workerId,
            error: err.message
          }, 'Failed to send health check to worker');
        }
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
    
    // Enhanced system memory monitoring
    try {
      const memUsage = process.memoryUsage();
      const memoryCheck = {
        rss: Math.round(memUsage.rss / (1024 * 1024)),
        heapTotal: Math.round(memUsage.heapTotal / (1024 * 1024)),
        heapUsed: Math.round(memUsage.heapUsed / (1024 * 1024)),
        external: Math.round(memUsage.external / (1024 * 1024))
      };
      
      // Log memory if it's approaching limits
      const warningThreshold = this.memoryLimits.maxRssMb * (this.memoryLimits.warningThresholdPercent / 100);
      
      if (memoryCheck.rss > warningThreshold) {
        logger.warn({
          memoryUsage: memoryCheck,
          memoryLimits: this.memoryLimits,
          activeWorkers: this.activeWorkers,
          queueLength: this.queue.length
        }, 'Main process approaching memory limits');
        
        // If we're getting close to the limit, try to free up memory
        if (memoryCheck.rss > this.memoryLimits.maxRssMb * 0.9) {
          global.gc && global.gc(); // Trigger garbage collection if available
          
          // Reduce worker count if we're critically low on memory
          if (this.activeWorkers > 1) {
            logger.warn({
              memoryUsage: memoryCheck,
              activeWorkers: this.activeWorkers
            }, 'Reducing worker count due to memory pressure');
            
            // Find the youngest worker to terminate
            let youngestWorker = null;
            let youngestTime = 0;
            
            for (const [workerId, stats] of this.workerStats.entries()) {
              if (stats.startTime > youngestTime) {
                youngestTime = stats.startTime;
                youngestWorker = { id: workerId, worker: stats.worker };
              }
            }
            
            // Terminate the youngest worker
            if (youngestWorker && youngestWorker.worker) {
              try {
                youngestWorker.worker.terminate();
                logger.info({
                  workerId: youngestWorker.id,
                  reason: 'memory pressure'
                }, 'Terminated worker to free memory');
              } catch (err) {
                logger.error({
                  workerId: youngestWorker.id,
                  error: err.message
                }, 'Failed to terminate worker');
              }
            }
          }
        }
      } else {
        // Regular memory logging at debug level
        logger.debug({
          memoryUsage: memoryCheck,
          activeWorkers: this.activeWorkers,
          queueLength: this.queue.length
        }, 'Worker pool memory usage');
      }
    } catch (memErr) {
      // Ignore memory monitoring errors
      logger.debug({
        error: memErr.message
      }, 'Error checking memory usage');
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
      idleTimeout: this.idleTimeout,
      memoryLimits: this.memoryLimits
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
      
      try {
        if (stats.worker) {
          // Give workers a chance to clean up
          try {
            if (typeof stats.worker.postMessage === 'function') {
              stats.worker.postMessage({ type: 'shutdown' });
            }
          } catch (msgErr) {
            // Ignore messaging errors during shutdown
          }
          
          // Force terminate after a short delay
          setTimeout(() => {
            try {
              stats.worker.terminate();
            } catch (err) {
              // Ignore errors during forced termination
            }
          }, 100);
        }
      } catch (err) {
        logger.debug({
          workerId,
          error: err.message
        }, 'Error terminating worker during shutdown');
      }
    }
    
    // Clean up worker maps
    this.workerStats.clear();
    this.workers.clear();
    
    // Reject all queued tasks
    this.queue.forEach(task => {
      task.reject(new Error('Worker pool shutdown'));
    });
    this.queue = [];
    
    logger.info('Worker pool shutdown');
  }
}

module.exports = {
  WorkerPool,
  Priority
};