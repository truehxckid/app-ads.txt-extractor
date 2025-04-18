// src/config/index.js - Enhanced with memory limit configuration

'use strict';

const path = require('path');
const os = require('os');

// Base directory - adjust to ensure paths resolve correctly
const BASE_DIR = path.resolve(__dirname, '../../');

// Configuration object
const config = {
  // Server settings
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development',
    isDev: (process.env.NODE_ENV || 'development') !== 'production'
  },
  
  // Directory paths
  dirs: {
    logs: path.join(BASE_DIR, 'logs'),
    cache: path.join(BASE_DIR, 'cache'),
    public: path.join(BASE_DIR, 'public')
  },
  
  // Redis configuration
  redis: {
    url: process.env.REDIS_URL || null,
    prefix: 'app-ads-extractor:',
    enabled: !!process.env.REDIS_URL
  },
  
  // API settings
  api: {
    rateLimitWindow: 15 * 60 * 1000, // 15 minutes in ms
    rateLimitMax: 100, // Maximum requests per IP in window
    bodyLimit: '1mb',
    maxBundleIds: 100, // Maximum number of bundle IDs per request
    // New pagination defaults
    defaultPageSize: 20,
    maxPageSize: 100
  },
  
  // Worker threads settings with memory limits
  workers: {
    maxWorkers: Math.max(1, Math.floor(os.cpus().length / 2)),
    minWorkers: 1,
    taskTimeout: 30000, // 30 seconds
    idleTimeout: 60000, // 1 minute
    // New memory limits
    maxRssMb: parseInt(process.env.WORKER_MAX_RSS_MB, 10) || 512, // 512MB RSS limit
    maxHeapMb: parseInt(process.env.WORKER_MAX_HEAP_MB, 10) || 384, // 384MB heap limit
    warningThresholdPercent: 80, // Warn at 80% of limit
    // Stream processing settings
    streamThresholdBytes: 5000000, // 5MB file size threshold for streaming
    streamChunkSize: 65536 // 64KB chunk size for stream processing
  },
  
  // HTTP client settings
  http: {
    timeout: 15000, // 15 seconds
    retries: 3,
    retryDelay: 1000, // 1 second
    userAgentRotation: true,
    maxSockets: 50,
    // Streaming settings
    maxResponseSize: 20 * 1024 * 1024 // 20MB max response size
  },
  
  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    prettyPrint: process.env.NODE_ENV !== 'production'
  },
  
  // Memory management settings
  memory: {
    gcIntervalMs: 60000, // 1 minute between GC attempts
    heapUsageThreshold: 0.85, // 85% heap usage threshold for forced GC
    enableForcedGc: process.env.ENABLE_FORCED_GC === 'true' || false // Whether to enable forced GC
  },
  
  // Performance monitoring
  monitoring: {
    enabled: true,
    sampleRate: 0.1, // Sample 10% of requests for detailed performance monitoring
    memorySnapshotIntervalMs: 300000 // 5 minutes between memory snapshots
  }
};

module.exports = config;