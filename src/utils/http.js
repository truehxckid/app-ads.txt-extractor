/**
 * HTTP utilities for App-Ads.txt Extractor
 * Provides axios configuration, user agent management, and request helpers
 */

'use strict';

const http = require('http');
const https = require('https');
const axios = require('axios');
const config = require('../config');
const { getLogger } = require('./logger');

const logger = getLogger('http');

/**
 * Create HTTP and HTTPS agents with keepAlive
 */
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: config.http.maxSockets
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: config.http.maxSockets
});

/**
 * User agent list for rotation
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
];

/**
 * Get a random user agent from the list
 * @returns {string} - Random user agent string
 */
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Create and configure Axios instance
 */
const axiosInstance = axios.create({
  timeout: config.http.timeout,
  httpAgent,
  httpsAgent,
  headers: {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'no-cache'
  }
});

/**
 * Manual implementation of retry functionality to replace axios-retry
 * @param {object} axiosInstance - Axios instance
 * @param {object} config - Retry configuration
 */
function configureRetry(axiosInstance) {
  // Create request interceptor to handle retries
  axiosInstance.interceptors.response.use(undefined, async (error) => {
    const { config } = error;
    
    // Skip if request was already retried or no config
    if (!config || config.__retryCount >= config.http.retries) {
      return Promise.reject(error);
    }
    
    // Initialize retry count if not set
    config.__retryCount = config.__retryCount || 0;
    
    // Check if error should be retried
    const shouldRetry = isRetryableError(error);
    
    if (!shouldRetry) {
      return Promise.reject(error);
    }
    
    // Increment retry count
    config.__retryCount += 1;
    
    // Calculate delay
    const delay = config.__retryCount * config.http.retryDelay;
    logger.debug({ retryCount: config.__retryCount, delay }, 'Retrying request');
    
    // Wait for delay
    await new Promise(resolve => setTimeout(resolve, delay));
    
    // Retry request
    return axiosInstance(config);
  });
}

/**
 * Determine if error is retryable
 * @param {Error} error - Axios error
 * @returns {boolean} - Whether error is retryable
 */
function isRetryableError(error) {
  // Network errors are retryable
  if (!error.response) {
    return true;
  }
  
  // 5xx and some 4xx errors are retryable
  const status = error.response.status;
  return (
    (status >= 500 && status <= 599) ||
    status === 429 ||
    status === 408
  );
}

// Configure retry functionality
configureRetry(axiosInstance);

/**
 * Add response and error interceptors for logging
 */
axiosInstance.interceptors.response.use(
  (response) => {
    logger.debug({
      url: response.config.url,
      status: response.status,
      contentType: response.headers['content-type'],
      contentLength: response.headers['content-length']
    }, 'Request successful');
    return response;
  },
  (error) => {
    logger.debug({
      url: error.config?.url,
      status: error.response?.status,
      message: error.message
    }, 'Request failed');
    return Promise.reject(error);
  }
);

/**
 * Add request interceptor for user agent rotation
 */
axiosInstance.interceptors.request.use(
  (config) => {
    // Add retry configuration to each request
    config.http = config.http || {};
    config.http.retries = config.http?.retries || config.http.retries;
    config.http.retryDelay = config.http?.retryDelay || config.http.retryDelay;
    
    if (config.headers && config.http?.userAgentRotation !== false) {
      config.headers['User-Agent'] = getRandomUserAgent();
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Fetch a URL with proper error handling
 * @param {string} url - URL to fetch
 * @param {object} options - Axios request options
 * @returns {Promise<object>} - Response data
 */
async function fetchUrl(url, options = {}) {
  try {
    const response = await axiosInstance({
      url,
      method: 'GET',
      ...options
    });
    
    return response;
  } catch (error) {
    // Enhance error with additional details
    const enhancedError = new Error(`Failed to fetch ${url}: ${error.message}`);
    enhancedError.originalError = error;
    enhancedError.status = error.response?.status;
    enhancedError.url = url;
    throw enhancedError;
  }
}

/**
 * Fetch text content from a URL
 * @param {string} url - URL to fetch
 * @param {object} options - Axios request options
 * @returns {Promise<string>} - Text content
 */
async function fetchText(url, options = {}) {
  const response = await fetchUrl(url, {
    ...options,
    responseType: 'text',
    headers: {
      ...options.headers,
      'Accept': 'text/plain,text/html;q=0.9'
    }
  });
  
  return response.data;
}

/**
 * Fetch HTML content from a URL
 * @param {string} url - URL to fetch
 * @param {object} options - Axios request options
 * @returns {Promise<string>} - HTML content
 */
async function fetchHtml(url, options = {}) {
  const response = await fetchUrl(url, {
    ...options,
    responseType: 'text',
    headers: {
      ...options.headers,
      'Accept': 'text/html,application/xhtml+xml'
    }
  });
  
  return response.data;
}

module.exports = {
  axiosInstance,
  getRandomUserAgent,
  fetchUrl,
  fetchText,
  fetchHtml,
  httpAgent,
  httpsAgent
};