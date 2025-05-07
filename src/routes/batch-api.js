/**
 * Batch API Routes for App-Ads.txt Extractor
 * Handles efficient parallel processing of multiple domains
 */

'use strict';

const express = require('express');
const { checkAppAdsTxt } = require('../core/app-ads-checker');
const { validateDomains, validateSearchTerms } = require('../utils/validation');
const { createRateLimiter } = require('../middleware/rate-limiter');
const config = require('../config');
const { BadRequestError, ValidationError } = require('../middleware/error-handler');
const { getLogger } = require('../utils/logger');
const memoryManager = require('../services/memory-manager');

const logger = getLogger('batch-api-routes');
const router = express.Router();

// Apply rate limiting to batch endpoints
const batchLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // Limit to 5 batch requests per 10 minutes
  message: 'Too many batch requests, please try again later.'
});

/**
 * @api {post} /api/batch/check-domains Check app-ads.txt files for multiple domains in parallel
 * @apiName BatchCheckDomains
 * @apiGroup Batch
 * 
 * @apiParam {String[]} domains Array of domains to check
 * @apiParam {String|String[]} [searchTerms] Optional search terms for app-ads.txt files
 * @apiParam {Object} [options] Additional processing options
 * @apiParam {Number} [options.concurrency=5] Maximum concurrent requests (1-10)
 * @apiParam {Boolean} [options.skipCache=false] Bypass cache for fresh results
 * 
 * @apiSuccess {Boolean} success Operation success status
 * @apiSuccess {Object[]} results Results for each domain
 */
router.post('/check-domains', batchLimiter, async (req, res, next) => {
  const startTime = Date.now();
  let processedCount = 0;
  let successCount = 0;
  let errorCount = 0;
  let withAppAdsTxtCount = 0;
  
  try {
    const { domains, searchTerms, options = {} } = req.body;
    
    if (!domains || !Array.isArray(domains) || domains.length === 0) {
      throw new BadRequestError('Missing or invalid domains. Please provide an array of domains.');
    }
    
    // Validate and filter domains
    const MAX_DOMAINS = config.api.maxBatchDomains || 50;
    const validation = validateDomains(domains, MAX_DOMAINS);
    
    if (validation.valid === 0) {
      throw new ValidationError('No valid domains provided after filtering.', {
        totalProvided: validation.total,
        invalidCount: validation.invalid,
        validCount: validation.valid
      });
    }
    
    // Validate search terms
    const validatedTerms = validateSearchTerms(searchTerms);
    
    // Determine concurrency limit (between 1 and 10)
    const concurrencyLimit = Math.min(
      Math.max(parseInt(options.concurrency, 10) || 5, 1),
      10
    );
    
    // Get cache option
    const skipCache = options.skipCache === true;
    
    logger.info({
      domainsCount: validation.validDomains.length,
      searchTermsCount: validatedTerms?.length || 0,
      concurrency: concurrencyLimit,
      skipCache,
      clientIp: req.ip,
      endpoint: 'batch/check-domains'
    }, 'Batch domain check request');
    
    // Process domains in parallel batches for memory efficiency
    const BATCH_SIZE = 20;
    const totalBatches = Math.ceil(validation.validDomains.length / BATCH_SIZE);
    let allResults = [];
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      // Check memory usage between batches
      if (batchIndex > 0) {
        memoryManager.checkMemoryUsage();
      }
      
      const batchStart = batchIndex * BATCH_SIZE;
      const batchEnd = Math.min((batchIndex + 1) * BATCH_SIZE, validation.validDomains.length);
      const batch = validation.validDomains.slice(batchStart, batchEnd);
      
      // Process batch with controlled concurrency
      const results = await processDomainBatch(
        batch, 
        validatedTerms, 
        concurrencyLimit,
        skipCache
      );
      
      // Update counters
      processedCount += results.length;
      
      results.forEach(result => {
        if (result.exists) {
          successCount++;
          withAppAdsTxtCount++;
        } else if (result.error) {
          errorCount++;
        }
      });
      
      // Accumulate results
      allResults = allResults.concat(results);
      
      // Log progress for large batches
      if (validation.validDomains.length > 50 && (batchIndex + 1) % 2 === 0) {
        const progress = Math.min(batchEnd, validation.validDomains.length);
        const percent = Math.round((progress / validation.validDomains.length) * 100);
        
        logger.info({
          progress: `${progress}/${validation.validDomains.length} (${percent}%)`,
          timeElapsed: `${Math.round((Date.now() - startTime) / 1000)}s`,
          successCount,
          errorCount
        }, 'Batch processing progress');
      }
    }
    
    // Create combined results response
    const processingTime = Date.now() - startTime;
    const response = {
      success: true,
      request: {
        domainsCount: validation.validDomains.length,
        hasSearchTerms: !!validatedTerms?.length,
        concurrency: concurrencyLimit,
        skipCache
      },
      summary: {
        totalProcessed: processedCount,
        successCount: successCount,
        errorCount: errorCount,
        withAppAdsTxt: withAppAdsTxtCount,
        processingTime: processingTime,
        avgTimePerDomain: Math.round(processingTime / processedCount)
      },
      results: createResultsMapping(validation.validDomains, allResults)
    };
    
    logger.info({
      domainsCount: validation.validDomains.length,
      processedCount,
      successCount,
      errorCount,
      processingTime: `${processingTime}ms`,
      avgTimePerDomain: `${Math.round(processingTime / processedCount)}ms`
    }, 'Batch domain check completed');
    
    res.json(response);
    
  } catch (err) {
    next(err);
  }
});

/**
 * Process a batch of domains with controlled concurrency
 * @param {string[]} domains - Domains to process
 * @param {Array} searchTerms - Search terms for app-ads.txt
 * @param {number} concurrency - Maximum concurrent requests
 * @param {boolean} skipCache - Whether to bypass cache
 * @returns {Promise<Array>} - Results for all domains
 */
async function processDomainBatch(domains, searchTerms, concurrency, skipCache) {
  const results = [];
  const queue = [...domains];
  
  // Process in smaller chunks based on concurrency
  while (queue.length > 0) {
    const chunk = queue.splice(0, concurrency);
    
    // Process this chunk concurrently
    const chunkPromises = chunk.map(domain => (async () => {
      try {
        // Add cache context to each request if needed
        const contextOptions = skipCache ? { skipCache: true } : undefined;
        
        const result = await checkAppAdsTxt(domain, searchTerms, contextOptions);
        return {
          domain,
          ...result
        };
      } catch (err) {
        return { 
          domain, 
          exists: false, 
          error: err.message
        };
      }
    })());
    
    // Wait for current chunk to complete
    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
  }
  
  return results;
}

/**
 * Create a domain->result mapping for the response
 * @param {string[]} domains - Original domain list
 * @param {Array} results - Results from processing
 * @returns {Object} - Domain->result mapping
 */
function createResultsMapping(domains, results) {
  const mapping = {};
  
  // Create initial mapping with placeholders
  domains.forEach(domain => {
    mapping[domain] = { domain, exists: false, processed: false };
  });
  
  // Update with actual results
  results.forEach(result => {
    if (result.domain) {
      mapping[result.domain] = {
        ...result,
        processed: true
      };
    }
  });
  
  return mapping;
}

module.exports = router;