/**
 * Express app configuration for App-Ads.txt Extractor
 */

'use strict';

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fs = require('./utils/fs');
const routes = require('./routes');
const { errorHandler } = require('./middleware/error-handler');
const { securityMiddleware, helmetConfig, corsConfig } = require('./middleware/security');
const { createCsrfMiddleware } = require('./middleware/csrf');
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
  
  // Increase server timeout for streaming responses
  app.set('keepAliveTimeout', 65000); // 65 seconds
  app.set('headersTimeout', 66000); // 66 seconds (slightly more than keepAliveTimeout)
  
  // Apply middleware
  app.use(helmet(helmetConfig));
  app.use(cors(corsConfig));
  app.use(compression());
  app.use(express.json({ limit: config.api.bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: config.api.bodyLimit }));
  app.use(cookieParser(config.security?.cookieSecret || 'secure-cookie-secret'));
  app.use(securityMiddleware);
  
  // Add CSRF protection after cookie parser (if enabled in config)
  if (config.security?.csrf?.enabled !== false) {
    app.use(createCsrfMiddleware({
      // Configure CSRF options from config
      cookieName: config.security?.csrf?.cookieName || 'XSRF-TOKEN',
      headerName: config.security?.csrf?.headerName || 'X-CSRF-Token',
      cookieOptions: {
        httpOnly: false, // Must be accessible from JS
        secure: config.server.env === 'production',
        sameSite: 'strict',
        path: '/'
      },
      // Use ignore paths from config or default values
      ignorePaths: config.security?.csrf?.ignorePaths || ['/health']
    }));
    logger.info('CSRF protection enabled');
  }
  
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