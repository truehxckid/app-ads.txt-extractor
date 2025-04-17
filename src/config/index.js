/**
 * Main configuration file for App-Ads.txt Extractor
 * Centralizes all application settings and environment variables
 */

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
    maxBundleIds: 100 // Maximum number of bundle IDs per request
  },
  
  // Worker threads settings
  workers: {
    maxWorkers: Math.max(1, Math.floor(os.cpus().length / 2)),
    minWorkers: 1,
    taskTimeout: 30000, // 30 seconds
    idleTimeout: 60000 // 1 minute
  },
  
  // HTTP client settings
  http: {
    timeout: 15000, // 15 seconds
    retries: 3,
    retryDelay: 1000, // 1 second
    userAgentRotation: true,
    maxSockets: 50
  },
  
  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    prettyPrint: process.env.NODE_ENV !== 'production'
  }
};

module.exports = config;