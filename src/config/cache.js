/**
 * Cache configuration for App-Ads.txt Extractor
 * Defines cache storage settings, TTLs, and cleanup strategies
 */

'use strict';

/**
 * Cache configuration settings
 */
const cacheConfig = {
  // Memory cache settings
  memory: {
    maxItems: 1000, // Maximum items in memory cache
    priorityFields: ['domain', 'bundleId'], // Fields to prioritize for keeping in memory
  },
  
  // File cache settings
  file: {
    enabled: true,
    compression: true, // Whether to compress larger cached items
    compressionThreshold: 10000, // Minimum size in bytes for compression
  },
  
  // Redis cache settings (used if Redis is configured)
  redis: {
    enabled: false, // Will be set to true if Redis URL is available
    keyPrefix: 'cache:',
    compressionEnabled: true,
  },
  
  // TTL (Time-To-Live) settings in hours
  ttl: {
    // Store data TTLs
    storeSuccess: 24, // Successful store extractions
    storeError: 1,   // Failed store extractions
    
    // App-ads.txt TTLs
    appAdsTxtFound: 12,    // When app-ads.txt exists
    appAdsTxtMissing: 6,   // When app-ads.txt doesn't exist (404)
    appAdsTxtError: 1,     // When app-ads.txt check errors
    
    // Analysis results TTLs
    analysisResults: 48,   // Domain analysis results
    
    // Default TTL if not specified
    default: 24
  },
  
  // Cache cleanup settings
  cleanup: {
    interval: 60 * 60 * 1000, // Cleanup interval in ms (1 hour)
    batchSize: 100,           // Files to process per batch during cleanup
    maxAge: 7 * 24 * 60 * 60 * 1000, // Maximum age of any cache item (7 days)
  }
};

/**
 * Get TTL in milliseconds for specific cache type
 * @param {string} type - Cache type identifier
 * @returns {number} - TTL in milliseconds
 */
function getTtl(type) {
  const ttlHours = cacheConfig.ttl[type] || cacheConfig.ttl.default;
  return ttlHours * 60 * 60 * 1000; // Convert hours to milliseconds
}

/**
 * Generate cache key for different types of data
 * @param {string} type - The type of data being cached
 * @param {string|object} identifier - Unique identifier for the cached data
 * @param {Array<string>} [extras=[]] - Additional key components
 * @returns {string} - Cache key
 */
function generateKey(type, identifier, extras = []) {
  if (!type || !identifier) {
    throw new Error('Cache key requires both type and identifier');
  }
  
  // Normalize identifier to string
  const idStr = typeof identifier === 'object' 
    ? JSON.stringify(identifier)
    : String(identifier);
  
  // Build key with all components
  const keyParts = [type, idStr];
  
  // Add any extra components
  if (extras.length > 0) {
    keyParts.push(...extras.filter(Boolean).map(e => String(e)));
  }
  
  return keyParts.join(':');
}

/**
 * Cache key generators for common data types
 */
const keys = {
  store: (storeType, bundleId) => generateKey('store', `${storeType}-${bundleId}`),
  appAdsTxt: (domain, searchTerms) => {
    const extras = searchTerms 
      ? [Array.isArray(searchTerms) ? searchTerms.sort().join('-') : searchTerms]
      : [];
    return generateKey('app-ads-txt', domain, extras);
  },
  domainAnalysis: (domains) => generateKey('analysis', 'domains', [domains.length])
};

module.exports = {
  cacheConfig,
  getTtl,
  generateKey,
  keys
};