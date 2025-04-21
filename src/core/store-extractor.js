/**
 * Store Extractor for App-Ads.txt Extractor
 * Handles extraction of developer information from app stores
 */

'use strict';

const cheerio = require('cheerio');
const psl = require('psl');
const cache = require('../services/cache');
const { fetchHtml } = require('../utils/http');
const rateLimiter = require('../services/rate-limiter');
const { stores, detectStoreType } = require('../config/stores');
const { validateBundleId, validateSearchTerms } = require('../utils/validation');
const { checkAppAdsTxt } = require('./app-ads-checker');
const { keys } = require('../config/cache');
const { getLogger } = require('../utils/logger');

const logger = getLogger('store-extractor');

/**
 * Extract domain from URL
 * @param {string} url - URL to extract domain from
 * @returns {string} - Extracted domain
 */
function extractDomain(url) {
  try {
    if (!url || typeof url !== 'string') return '';
    
    // Remove protocol and path
    const match = url.match(/^(?:https?:\/\/)?([^\/]+)/i);
    if (!match) return '';
    
    const hostname = match[1];
    const parsed = psl.parse(hostname);
    
    if (parsed.domain) {
      return parsed.domain;
    }
    
    // Fallback to hostname if parsing fails
    return hostname;
  } catch (err) {
    logger.error({ url, error: err.message }, 'Error extracting domain');
    return '';
  }
}

/**
 * Extract developer information from app store
 * @param {string} bundleId - App bundle ID
 * @param {string} storeType - Store type
 * @param {string[]|null} searchTerms - Search terms for app-ads.txt
 * @returns {Promise<object>} - Extraction results
 */
async function extractFromStore(bundleId, storeType, searchTerms = null) {
  try {
    const store = stores[storeType];
    if (!store) {
      throw new Error(`Unsupported store type: ${storeType}`);
    }
    
    const validId = validateBundleId(bundleId);
    const url = store.urlTemplate(validId);
    const cacheKey = keys.store(storeType, validId);
    
    // Check cache first
    const cached = await cache.get(cacheKey);
    if (cached) {
      if (cached.success && cached.domain && searchTerms) {
        const cachedTerms = cached.searchTerms || [];
        const newTerms = Array.isArray(searchTerms) ? searchTerms : [searchTerms];
        
        // If search terms are different, recheck app-ads.txt with new terms
        if (JSON.stringify(cachedTerms.sort()) !== JSON.stringify(newTerms.sort())) {
          try {
            logger.debug({ 
              bundleId, 
              domain: cached.domain,
              cachedTerms,
              newTerms
            }, 'Different search terms, rechecking app-ads.txt');
            
            const validatedTerms = validateSearchTerms(newTerms);
            const appAdsTxt = await checkAppAdsTxt(cached.domain, validatedTerms);
            return {...cached, appAdsTxt, searchTerms: validatedTerms};
          } catch (appAdsErr) {
            logger.error({ 
              error: appAdsErr.message, 
              domain: cached.domain 
            }, 'Error checking app-ads.txt with new search terms');
            
            return cached; // Return cached result without new search terms
          }
        }
      }
      
      logger.debug({ bundleId, storeType, cached: true }, 'Using cached store extraction');
      return cached;
    }
    
    logger.info({ bundleId, storeType, url }, 'Extracting from store');
    
    // Apply rate limiting
    await rateLimiter.limit(storeType);
    
    try {
      // Fetch store page
      const html = await fetchHtml(url);
      
      if (!html) {
        throw new Error(`Empty response from ${storeType}`);
      }
      
      let developerUrl = null;
      
      // Try pattern-based extractors first
      for (const extractor of store.extractors) {
        try {
          developerUrl = extractor(html);
          if (developerUrl) {
            logger.debug({ 
              bundleId, 
              storeType, 
              developerUrl,
              method: 'pattern'
            }, 'Developer URL extracted');
            break;
          }
        } catch (extractErr) {
          logger.debug({ 
            error: extractErr.message,
            bundleId,
            storeType
          }, 'Extractor error');
        }
      }
      
      // If pattern-based extraction failed, try using Cheerio
      if (!developerUrl) {
        try {
          const $ = cheerio.load(html);
          const selectors = [
            'meta[name="appstore:developer_url"]',
            'a[href*="/developer/"]',
            'a.link.icon.icon-after.icon-external',
            'a:contains("Visit the")',
            'a:contains("More by")'
          ];
          
          for (const selector of selectors) {
            const el = $(selector);
            if (el.length > 0) {
              developerUrl = el.attr('content') || el.attr('href');
              if (developerUrl) {
                logger.debug({ 
                  bundleId, 
                  storeType, 
                  developerUrl,
                  method: 'cheerio',
                  selector
                }, 'Developer URL extracted');
                break;
              }
            }
          }
        } catch (cheerioErr) {
          logger.error({ 
            error: cheerioErr.message, 
            bundleId,
            storeType 
          }, 'Error using Cheerio for extraction');
        }
      }
      
      // Report successful extraction to rate limiter
      rateLimiter.reportSuccess(storeType);
      
      if (!developerUrl) {
        throw new Error(`Could not find developer URL for ${bundleId} in ${storeType}`);
      }
      
      // Extract domain from developer URL
      const domain = extractDomain(developerUrl);
      if (!domain) {
        throw new Error(`Could not extract valid domain from developer URL: ${developerUrl}`);
      }
      
      logger.info({ 
        bundleId, 
        storeType, 
        domain, 
        developerUrl 
      }, 'Successfully extracted domain');
      
      // Check for app-ads.txt
      const validatedTerms = validateSearchTerms(searchTerms);
      const appAdsTxt = await checkAppAdsTxt(domain, validatedTerms);
      
      // Prepare result
      const result = {
        bundleId: validId,
        developerUrl,
        domain,
        storeType,
        appAdsTxt,
        searchTerms: validatedTerms,
        success: true,
        timestamp: Date.now()
      };
      
      // Cache result
      await cache.set(cacheKey, result, 'storeSuccess');
      return result;
    } catch (requestErr) {
      // Report error to rate limiter
      rateLimiter.reportError(storeType, requestErr.response?.status);
      
      throw requestErr;
    }
  } catch (err) {
    const errorMessage = err.response?.status 
      ? `HTTP ${err.response.status}: ${err.response.statusText || err.message}`
      : err.message;
    
    logger.error({ 
      error: errorMessage, 
      bundleId, 
      storeType,
      url: err.config?.url,
      status: err.response?.status
    }, 'Error extracting from store');
    
    const errorResult = { 
      bundleId: validateBundleId(bundleId), 
      storeType, 
      success: false, 
      error: errorMessage,
      timestamp: Date.now()
    };
    
    // Cache errors for a shorter period
    await cache.set(keys.store(storeType, bundleId), errorResult, 'storeError');
    return errorResult;
  }
}

/**
 * Try extraction from all stores
 * @param {string} bundleId - App bundle ID
 * @param {string[]|null} searchTerms - Search terms for app-ads.txt
 * @returns {Promise<object>} - Results from the first successful store
 */
async function tryAllStores(bundleId, searchTerms = null) {
  const validId = validateBundleId(bundleId);
  const results = [];
  const errors = [];
  
  logger.info({ bundleId: validId }, 'Trying all stores');
  
  for (const storeType of Object.keys(stores)) {
    try {
      const result = await extractFromStore(validId, storeType, searchTerms);
      
      if (result.success) {
        logger.info({ 
          bundleId: validId, 
          storeType, 
          domain: result.domain 
        }, 'Successfully extracted from store');
        
        return result;
      }
      
      results.push(result);
    } catch (err) {
      logger.error({ 
        error: err.message, 
        bundleId: validId, 
        storeType 
      }, 'Error trying store');
      
      errors.push({
        storeType,
        error: err.message,
        statusCode: err.response?.status
      });
      
      results.push({ 
        bundleId: validId, 
        storeType, 
        error: err.message, 
        success: false,
        timestamp: Date.now()
      });
    }
  }
  
  // If we get here, all stores failed - return an error result instead of throwing
  const errorResult = {
    bundleId: validId,
    success: false,
    error: 'Failed to extract from any store',
    attemptedStores: Object.keys(stores),
    storeErrors: errors,
    timestamp: Date.now()
  };
  
  // Cache the combined error result
  await cache.set(`all-stores-${validId}`, errorResult, 'storeError');
  
  // Return the error result instead of throwing
  return errorResult;
}

/**
 * Get developer information for a bundle ID
 * @param {string} bundleId - App bundle ID
 * @param {string[]|null} searchTerms - Search terms for app-ads.txt
 * @returns {Promise<object>} - Developer information
 */
async function getDeveloperInfo(bundleId, searchTerms = null) {
  try {
    const validId = validateBundleId(bundleId);
    const storeType = detectStoreType(validId);
    
    logger.debug({ 
      bundleId: validId, 
      storeType, 
      hasSearchTerms: !!searchTerms 
    }, 'Getting developer info');
    
    // If store type is unknown, return error immediately without trying all stores
    if (storeType === 'unknown') {
      logger.info({ 
        bundleId: validId,
        storeType: 'unknown'
      }, 'Unknown store type, skipping bundle ID');
      
      return {
        bundleId: validId,
        success: false,
        storeType: 'unknown',
        error: 'Could not determine store type from bundle ID format',
        timestamp: Date.now()
      };
    }
    
    // Try the detected store type
    try {
      return await extractFromStore(validId, storeType, searchTerms);
    } catch (err) {
      logger.info({ 
        error: err.message, 
        bundleId: validId, 
        detectedStoreType: storeType 
      }, 'Failed with detected store type, trying all stores');
      
      // If the detected store failed, try all stores
      try {
        return await tryAllStores(validId, searchTerms);
      } catch (allStoresErr) {
        // If all stores fail, return a more detailed error
        logger.error({ 
          error: allStoresErr.message, 
          bundleId: validId 
        }, 'All stores failed for bundle ID');
        
        return {
          bundleId: validId,
          success: false,
          storeType: storeType,
          error: `Failed to extract from any store: ${allStoresErr.message}`,
          attemptedStores: Object.keys(stores),
          timestamp: Date.now()
        };
      }
    }
  } catch (err) {
    logger.error({ error: err.message, bundleId }, 'Error validating bundle ID');
    
    // Return error object instead of throwing
    return {
      bundleId,
      success: false,
      error: `Invalid bundle ID: ${err.message}`,
      timestamp: Date.now()
    };
  }
}

module.exports = {
  extractFromStore,
  tryAllStores,
  getDeveloperInfo,
  extractDomain
};