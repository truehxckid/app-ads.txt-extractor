/**
 * Logger utility for App-Ads.txt Extractor
 * Provides consistent logging across the application
 */

'use strict';

const pino = require('pino');
const config = require('../config');

/**
 * Create a configured logger instance
 */
const logger = pino({
  level: config.logging.level,
  transport: config.logging.prettyPrint ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  } : undefined,
  base: {
    env: config.server.env
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  formatters: {
    level: (label) => {
      return { level: label };
    }
  }
});

/**
 * Create child logger with component context
 * @param {string} component - Component name to add to logs
 * @return {object} - Child logger instance
 */
function getLogger(component) {
  return logger.child({ component });
}

// Export the base logger and the getLogger function
module.exports = {
  logger,
  getLogger
};