/**
 * CSRF Protection Middleware for App-Ads.txt Extractor
 * Provides Double Submit Cookie pattern for CSRF protection
 */

'use strict';

const crypto = require('crypto');
const { getLogger } = require('../utils/logger');

const logger = getLogger('csrf-middleware');

// In-memory token store as a fallback if Redis is not available
const tokenCache = new Map();

/**
 * Generate a random CSRF token
 * @returns {string} - Random CSRF token
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create the CSRF protection middleware
 * @param {object} options - Configuration options
 * @returns {function} - CSRF middleware function
 */
function createCsrfMiddleware(options = {}) {
  const {
    cookieName = 'XSRF-TOKEN',
    headerName = 'X-CSRF-Token',
    cookieOptions = {
      httpOnly: false, // Must be accessible from JS
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/'
    },
    ignoreMethods = ['GET', 'HEAD', 'OPTIONS'],
    ignorePaths = ['/health'] // Only ignore health checks, all other endpoints need CSRF protection
  } = options;

  return function csrfMiddleware(req, res, next) {
    // Generate and set a new CSRF token
    const createToken = () => {
      const token = generateToken();
      
      // Set CSRF token cookie
      res.cookie(cookieName, token, cookieOptions);
      
      // Also store in request and response locals for template rendering
      req.csrfToken = token;
      res.locals.csrfToken = token;
      
      // Store token in memory cache with expiration
      const expiryTime = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
      tokenCache.set(token, { expiryTime });
      
      // Clean expired tokens periodically (10% chance on each request)
      if (Math.random() < 0.1) {
        const now = Date.now();
        for (const [key, value] of tokenCache.entries()) {
          if (value.expiryTime < now) {
            tokenCache.delete(key);
          }
        }
      }
      
      return token;
    };

    // Add csrfToken method to request object
    req.csrfToken = () => createToken();

    // Skip CSRF check for specified methods and paths
    const isIgnoredMethod = ignoreMethods.includes(req.method);
    const isIgnoredPath = ignorePaths.some(path => req.path.startsWith(path));
    
    // Special case for streaming API on GET requests only
    const isStreamingGetRequest = req.path.startsWith('/api/stream') && req.method === 'GET';
    
    // Only ignore CSRF for GET requests to streaming API and explicitly ignored paths
    const shouldIgnore = isIgnoredMethod || isIgnoredPath || isStreamingGetRequest;
    
    if (shouldIgnore) {
      // Generate token but don't require validation
      createToken();
      return next();
    }

    // For non-ignored routes, validate the CSRF token
    const cookieToken = req.cookies?.[cookieName];
    const headerToken = req.headers?.[headerName.toLowerCase()] || 
                        req.body?._csrf || 
                        req.query?._csrf;

    // If no token in cookie, this might be the first request
    if (!cookieToken) {
      createToken();
      return next();
    }

    // Validate that the tokens match
    if (!headerToken || headerToken !== cookieToken) {
      logger.warn({
        ip: req.ip,
        path: req.path,
        method: req.method,
        hasHeaderToken: !!headerToken,
        hasCookieToken: !!cookieToken,
        tokensMatch: headerToken === cookieToken
      }, 'CSRF token validation failed');
      
      return res.status(403).json({
        error: 'CSRF token validation failed',
        success: false
      });
    }

    // Verify the token exists in our store
    if (!tokenCache.has(cookieToken)) {
      logger.warn({
        ip: req.ip,
        path: req.path,
        tokenExists: false
      }, 'CSRF token not found in token store');
      
      // Generate a new token
      createToken();
      
      return res.status(403).json({
        error: 'CSRF token expired or invalid',
        success: false
      });
    }

    // Successful validation - continue
    logger.debug('CSRF validation successful');
    next();
  };
}

module.exports = {
  createCsrfMiddleware
};