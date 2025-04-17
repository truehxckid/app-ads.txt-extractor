/**
 * Error handling middleware for App-Ads.txt Extractor
 */

'use strict';

const { getLogger } = require('../utils/logger');
const config = require('../config');

const logger = getLogger('error-handler');

/**
 * Not Found (404) middleware
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
function notFoundHandler(req, res, next) {
  logger.debug({ path: req.path, method: req.method }, 'Route not found');
  
  // API routes return JSON
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: 'Endpoint not found',
      path: req.path,
      success: false
    });
  }
  
  // Web routes return HTML
  res.status(404).send(`
    <html>
      <head>
        <title>404 - Page Not Found</title>
        <style>
          body {
            font-family: sans-serif;
            color: #333;
            text-align: center;
            padding: 50px;
          }
          h1 { color: #e74c3c; }
          a { color: #3498db; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <h1>404 - Page Not Found</h1>
        <p>The page you are looking for does not exist.</p>
        <p><a href="/">Return to Home</a></p>
      </body>
    </html>
  `);
}

/**
 * Global error handler middleware
 * @param {Error} err - Error object
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  
  // Determine if this is an API or web request
  const isApi = req.path.startsWith('/api/') || req.accepts('json');
  
  // Log error details
  const errorDetails = {
    message: err.message,
    statusCode,
    path: req.path,
    method: req.method,
    ip: req.ip,
    stack: config.server.isDev ? err.stack : undefined
  };
  
  if (statusCode >= 500) {
    logger.error(errorDetails, 'Server error');
  } else {
    logger.warn(errorDetails, 'Client error');
  }
  
  // Return appropriate response format
  if (isApi) {
    return res.status(statusCode).json({
      error: err.message,
      statusCode,
      success: false,
      ...(config.server.isDev && statusCode >= 500 ? { stack: err.stack } : {})
    });
  }
  
  // HTML response for web requests
  const devInfo = config.server.isDev && statusCode >= 500 
    ? `<div class="dev-info"><h3>Developer Info</h3><pre>${err.stack}</pre></div>` 
    : '';
  
  res.status(statusCode).send(`
    <html>
      <head>
        <title>${statusCode} - ${err.message}</title>
        <style>
          body {
            font-family: sans-serif;
            color: #333;
            text-align: center;
            padding: 50px;
          }
          h1 { color: #e74c3c; }
          .dev-info { 
            margin-top: 30px; 
            text-align: left;
            background: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            overflow: auto;
          }
          pre {
            white-space: pre-wrap;
            word-wrap: break-word;
          }
          a { color: #3498db; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <h1>${statusCode} - ${err.message}</h1>
        <p>Something went wrong. Please try again later.</p>
        <p><a href="/">Return to Home</a></p>
        ${devInfo}
      </body>
    </html>
  `);
}

/**
 * Custom error class for HTTP errors
 */
class HttpError extends Error {
  /**
   * Create a new HTTP error
   * @param {string} message - Error message
   * @param {number} statusCode - HTTP status code
   */
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Not Found error
 */
class NotFoundError extends HttpError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

/**
 * Bad Request error
 */
class BadRequestError extends HttpError {
  constructor(message = 'Bad request') {
    super(message, 400);
  }
}

/**
 * Unauthorized error
 */
class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

/**
 * Forbidden error
 */
class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

/**
 * Validation Error
 */
class ValidationError extends BadRequestError {
  constructor(message = 'Validation error', details = null) {
    super(message);
    this.details = details;
  }
}

/**
 * Too Many Requests error
 */
class TooManyRequestsError extends HttpError {
  constructor(message = 'Too many requests', retryAfter = 60) {
    super(message, 429);
    this.retryAfter = retryAfter;
  }
}

module.exports = {
  notFoundHandler,
  errorHandler,
  HttpError,
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  TooManyRequestsError
};