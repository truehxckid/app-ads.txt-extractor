/**
 * Express app configuration for App-Ads.txt Extractor
 */

'use strict';

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const fs = require('./utils/fs');
const routes = require('./routes');
const { errorHandler } = require('./middleware/error-handler');
const { securityMiddleware, helmetConfig, corsConfig } = require('./middleware/security');
const config = require('./config');
const { getLogger } = require('./utils/logger');

const logger = getLogger('app');

/**
 * Initialize Express application
 */
function initializeApp() {
  // Create necessary directories
  fs.createDirs(Object.values(config.dirs));
  
  // Initialize Express app
  const app = express();
  
  // Apply middleware
  app.use(helmet(helmetConfig));
  app.use(cors(corsConfig));
  app.use(compression());
  app.use(express.json({ limit: config.api.bodyLimit }));
  app.use(securityMiddleware);
  
  // Apply routes
  app.use('/', routes);
  
  // Apply error handler
  app.use(errorHandler);
  
  logger.info('Express app initialized');
  
  return app;
}

// Create and export the app
const app = initializeApp();
module.exports = app;