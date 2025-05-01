/**
 * App-Ads.txt Extractor Server
 * Entry point for the application
 */

'use strict';

const app = require('./src/app');
const config = require('./src/config');
const { getLogger } = require('./src/utils/logger');
const redis = require('./src/services/redis');
const { shutdown: shutdownAppAdsChecker } = require('./src/core/app-ads-checker');

const logger = getLogger('server');

// Configure server with longer timeouts for streaming
const server = require('http').createServer(app);

// Set longer timeouts for HTTP server
server.timeout = 300000; // 5 minutes
server.keepAliveTimeout = 65000; // 65 seconds
server.headersTimeout = 66000; // Slightly longer than keepAliveTimeout

// Start the server
server.listen(config.server.port, config.server.host, () => {
  logger.info({ 
    port: config.server.port, 
    host: config.server.host,
    environment: config.server.env,
    nodeVersion: process.version,
    timeout: server.timeout,
    keepAliveTimeout: server.keepAliveTimeout
  }, 'Server started with increased timeouts');
});

// Graceful shutdown
function gracefulShutdown() {
  logger.info('Received shutdown signal, closing server gracefully');
  
  server.close(() => {
    logger.info('HTTP server closed');
    
    // Shutdown app-ads checker
    shutdownAppAdsChecker();
    
    // Close Redis connection if available
    if (redis.isConnected()) {
      redis.quit().then(() => {
        logger.info('Redis connection closed');
        process.exit(0);
      }).catch(err => {
        logger.error({ error: err.message }, 'Error closing Redis connection');
        process.exit(1);
      });
    } else {
      process.exit(0);
    }
  });
  
  // Force shutdown after 10 seconds if server hasn't closed
  setTimeout(() => {
    logger.error('Server did not close in time, forcing shutdown');
    process.exit(1);
  }, 10000);
}

// Register signal handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error({ error: err.message, stack: err.stack }, 'Uncaught exception');
  
  // Exit process on uncaught exceptions for safety
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ 
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined
  }, 'Unhandled promise rejection');
});

module.exports = server; // For testing