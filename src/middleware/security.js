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
  },
  // Allow frames to avoid X-Frame-Options error
  frameguard: false
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
  // Set X-Content-Type-Options header
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Set Permissions-Policy header
  res.setHeader('Permissions-Policy', 
    'camera=(), microphone=(), geolocation=(), interest-cohort=()'
  );
  
  // Allow long connections for streaming
  if (req.path.includes('/stream/')) {
    // Set timeout to 5 minutes for streaming endpoints
    req.setTimeout(300000); // 5 minutes
    
    // Add CORS headers for streaming to avoid CORS errors
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  
  next();
}

module.exports = {
  helmetConfig,
  corsConfig,
  securityMiddleware
};