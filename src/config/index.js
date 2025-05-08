// src/config/index.js - Modified with Redis configuration fixes

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
  
  // IMPROVED REDIS CONFIGURATION
  redis: {
    url: process.env.REDIS_URL || null,
    prefix: 'app-ads-extractor:',
    // Only enable Redis if URL is provided and feature is not disabled
    enabled: !!process.env.REDIS_URL && process.env.DISABLE_REDIS !== 'true',
    // Add multiple configuration options
    options: {
      // Timeouts and connection limits
      connectTimeout: 5000,
      commandTimeout: 3000,
      maxRetriesPerRequest: 2,
      // Additional options for stability
      enableOfflineQueue: false,
      enableAutoPipelining: false,
      autoResubscribe: false,
      // Set these to false to use file-based storage as fallback
      cacheRequired: false,
      rateLimitingRequired: false
    },
    // Fallback mechanisms
    fallback: {
      // After how many consecutive failures to temporarily disable Redis (in ms)
      disableThreshold: 60000, // 1 minute
      // How long to disable Redis after reaching threshold (in ms)
      disableDuration: 300000, // 5 minutes
    }
  },
  
  // API settings
  api: {
    rateLimitWindow: 15 * 60 * 1000, // 15 minutes in ms
    rateLimitMax: 100, // Maximum requests per IP in window
    bodyLimit: '1mb',
    maxBundleIds: process.env.MAX_BUNDLE_IDS || 200, // Maximum number of bundle IDs per request
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
    maxRssMb: parseInt(process.env.WORKER_MAX_RSS_MB, 10) || 768, // 512MB RSS limit
    maxHeapMb: parseInt(process.env.WORKER_MAX_HEAP_MB, 10) || 512, // 384MB heap limit
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
    gcIntervalMs: 120000, // 2 minute between GC attempts
    heapUsageThreshold: 0.80, // 80% heap usage threshold for forced GC
    enableForcedGc: process.env.ENABLE_FORCED_GC === 'true' || false // Whether to enable forced GC
  },
  
  // Performance monitoring
  monitoring: {
    enabled: true,
    sampleRate: 0.1, // Sample 10% of requests for detailed performance monitoring
    memorySnapshotIntervalMs: 300000 // 5 minutes between memory snapshots
  },
  
  // Security settings
  security: {
    // Cookie secret for signed cookies (should be set from environment variable in production)
    cookieSecret: process.env.COOKIE_SECRET || 'appad5-t3xt-extr@ct0r-s3cur1ty-k3y',
    // CSRF settings
    csrf: {
      // Whether to enable CSRF protection
      enabled: true,
      // Cookie name for CSRF token
      cookieName: 'XSRF-TOKEN',
      // Header name for CSRF token
      headerName: 'X-CSRF-Token',
      // Routes to exclude from CSRF protection
      ignorePaths: ['/health', '/api/stream']
    }
  }
};

module.exports = config;