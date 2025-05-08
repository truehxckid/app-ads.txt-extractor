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
 * Improved with nonces and stricter protections
 */
const helmetConfig = {
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      // In development mode, use a more permissive CSP to simplify debugging
      ...(config.server.isDev ? {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdnjs.cloudflare.com"],
        scriptSrcElem: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      } : {
        // Production mode uses strict CSP with nonces
        defaultSrc: ["'self'"],
        // Remove unsafe-inline by using nonces
        scriptSrc: [
          "'self'", 
          "https://cdnjs.cloudflare.com",
          // Allow scripts with nonces - security improvement over unsafe-inline
          (req, res) => `'nonce-${res.locals.cspNonce}'`
        ]
      }),
      ...(config.server.isDev ? {} : {
        // Production-only styles
        styleSrc: [
          "'self'", 
          "https://fonts.googleapis.com",
          // Keeping unsafe-inline for styles since it's hard to nonce all styles
          "'unsafe-inline'"
        ]
      }),
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      // Allow connections only to self
      connectSrc: ["'self'"],
      // Explicitly prevent frames, object, and form submissions to other domains
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      formAction: ["'self'"],
      // Prevent eval and similar dynamic code execution in production
      ...(config.server.isDev ? {} : {
        scriptSrcAttr: ["'none'"],
        scriptSrcElem: [
          "'self'", 
          "https://cdnjs.cloudflare.com",
          (req, res) => `'nonce-${res.locals.cspNonce}'`
        ]
      }),
      // Add base-uri to prevent base tag hijacking
      baseUri: ["'self'"],
      // Enable upgradeInsecureRequests in production
      ...(!config.server.isDev ? { upgradeInsecureRequests: [] } : {})
    }
  },
  // Enable XSS protection
  xssFilter: true,
  // Prevent MIME type sniffing
  noSniff: true,
  // Set restrictive referrer policy
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // Set HSTS for HTTPS enforcement
  hsts: {
    maxAge: 15552000, // 180 days in seconds
    includeSubDomains: true,
    preload: true // Add to browser preload list
  },
  // Prevent framing of the application
  frameguard: { action: 'deny' },
  // Add DNS prefetch control
  dnsPrefetchControl: { allow: false }
};

/**
 * CORS configuration with enhanced security
 */
const corsConfig = {
  // In development, allow all origins. In production, restrict to specific domains
  origin: config.server.isDev ? '*' : [
    // List allowed domains explicitly
    'https://app-ads-extractor-ehkjv.ondigitalocean.app',
    'https://app-ads.adnct.com',
    // Allow secure local development
    'https://localhost:3000',
    'https://127.0.0.1:3000'
  ],
  // Only allow necessary HTTP methods
  methods: ['GET', 'POST', 'OPTIONS'],
  // Only allow necessary headers
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-CSRF-Token',
    'X-Requested-With'
  ],
  // Add security headers to expose to client
  exposedHeaders: [
    'X-CSRF-Token', 
    'X-RateLimit-Limit', 
    'X-RateLimit-Remaining'
  ],
  // Do not pass the preflight response to the next handler
  preflightContinue: false,
  // Success status code for preflight requests
  optionsSuccessStatus: 204,
  // Cache preflight results for 24 hours
  maxAge: 86400,
  // Disallow credentials for cross-origin requests (more secure)
  credentials: false
};

/**
 * Generate a random nonce for Content Security Policy
 * @returns {string} - Random nonce string
 */
function generateNonce() {
  // Create a cryptographically strong random value
  return require('crypto').randomBytes(16).toString('base64');
}

/**
 * Custom security middleware
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
function securityMiddleware(req, res, next) {
  // Generate and set CSP nonce
  const nonce = generateNonce();
  res.locals.cspNonce = nonce;
  
  // Log nonce generation for debugging
  console.log(`Generated CSP nonce: ${nonce} for request to ${req.path}`);
  
  // Set X-Content-Type-Options header
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Set Permissions-Policy header (modern version of Feature-Policy)
  // Use only widely supported features to avoid warnings
  res.setHeader('Permissions-Policy', 
    'camera=(), microphone=(), geolocation=(), interest-cohort=(), accelerometer=(), ' +
    'autoplay=(), display-capture=(), encrypted-media=(), fullscreen=(), ' +
    'gyroscope=(), payment=(), picture-in-picture=(), sync-xhr=(), ' +
    'usb=(), web-share=()'
  );
  
  // Allow long connections for streaming
  if (req.path.includes('/stream/')) {
    // Set timeout to 5 minutes for streaming endpoints
    req.setTimeout(300000); // 5 minutes
    
    // Add CORS headers for streaming endpoints with more restrictive settings
    if (config.server.isDev) {
      // In development, allow all origins
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
      // In production, only allow specific origins
      const origin = req.headers.origin;
      // Check if origin matches allowed domains
      if (origin && (
          origin === 'https://app-ads-extractor-ehkjv.ondigitalocean.app' ||
          origin === 'https://app-ads.adnct.com' ||
          origin === 'https://localhost:3000' ||
          origin === 'https://127.0.0.1:3000'
      )) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  }
  
  // Modify response to include nonce in rendered HTML
  const originalSend = res.send;
  res.send = function(body) {
    // Only process HTML responses
    if (typeof body === 'string' && 
        (res.get('Content-Type') || '').includes('html')) {
      // Add nonce to all script tags - make sure we don't duplicate nonce attributes
      const originalBody = body;
      body = body.replace(/<script(?![^>]*\snonce=)/gi, `<script nonce="${nonce}"`);
      
      // Log for debugging if nonce was applied
      if (body !== originalBody) {
        console.log(`Applied nonce to ${(body.match(/<script\s+nonce=/g) || []).length} script tags`);
      } else {
        console.log('Warning: No script tags were updated with nonces');
      }
    }
    return originalSend.call(this, body);
  };
  
  next();
}

module.exports = {
  helmetConfig,
  corsConfig,
  securityMiddleware
};