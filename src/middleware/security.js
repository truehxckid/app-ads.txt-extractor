/**
 * Security middleware for App-Ads.txt Extractor
 * Configures security headers and CORS
 */

'use strict';

const config = require('../config');
const { getLogger } = require('../utils/logger');

const logger = getLogger('security-middleware');

/**
 * Helmet configuration for Content Security Policy and other security headers
 */
const helmetConfig = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  xssFilter: true,
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: {
    maxAge: 15552000, // 180 days in seconds
    includeSubDomains: true
  }
};

/**
 * CORS configuration
 */
const corsConfig = {
  origin: config.server.isDev ? '*' : [/\.yourdomain\.com$/],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
  maxAge: 86400 // 24 hours in seconds
};

/**
 * Custom security middleware
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
function securityMiddleware(req, res, next) {
  // Set X-Frame-Options header
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Set X-Content-Type-Options header
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Set Permissions-Policy header
  res.setHeader('Permissions-Policy', 
    'camera=(), microphone=(), geolocation=(), interest-cohort=()'
  );
  
  next();
}

module.exports = {
  helmetConfig,
  corsConfig,
  securityMiddleware
};