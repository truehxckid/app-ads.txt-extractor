/**
 * API Routes for App-Ads.txt Extractor
 */

'use strict';

const express = require('express');
const { getDeveloperInfo } = require('../core/store-extractor');
const { checkAppAdsTxt } = require('../core/app-ads-checker'); 
const { analyzeDomainRelationships, analyzeSearchTerms } = require('../core/domain-analyzer');
const { validateBundleIds, validateSearchTerms } = require('../utils/validation');
const { apiLimiter, createRateLimiter } = require('../middleware/rate-limiter');
const cache = require('../services/cache');
const config = require('../config');
const { BadRequestError, ValidationError } = require('../middleware/error-handler');
const { getLogger } = require('../utils/logger');

const logger = getLogger('api-routes');
const router = express.Router();

// Apply rate limiting to all API routes
router.use(apiLimiter);

// More restrictive rate limiter for extraction endpoints
const extractionLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // 20 requests per 5 minutes
  message: 'Too many extraction requests, please try again later.'
});

/**
 * @api {post} /api/extract Extract developer domain from a single bundle ID
 * @apiName ExtractSingle
 * @apiGroup Extraction
 * 
 * @apiParam {String} bundleId App bundle ID
 * @apiParam {String|String[]} [searchTerms] Optional search terms for app-ads.txt
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Object} result Extraction result
 */
router.post('/extract', extractionLimiter, async (req, res, next) => {
  try {
    const { bundleId, searchTerms } = req.body;
    
    if (!bundleId) {
      throw new BadRequestError('Bundle ID is required');
    }
    
    logger.info({ bundleId, hasSearchTerms: !!searchTerms }, 'Single extraction request');
    
    // Validate search terms
    const validatedTerms = validateSearchTerms(searchTerms);
    
    // Process bundle ID
    const result = await getDeveloperInfo(bundleId, validatedTerms);
    
    res.json({
      success: true,
      result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @api {post} /api/extract-multiple Extract developer domains from multiple bundle IDs
 * @apiName ExtractMultiple
 * @apiGroup Extraction
 * 
 * @apiParam {String[]} bundleIds Array of app bundle IDs
 * @apiParam {String|String[]} [searchTerms] Optional search terms for app-ads.txt
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Object[]} results Extraction results
 * @apiSuccess {Number} errorCount Number of errors
 * @apiSuccess {Number} successCount Number of successful extractions
 * @apiSuccess {Number} totalProcessed Total number of processed bundle IDs
 * @apiSuccess {Object} domainAnalysis Domain relationship analysis
 */
router.post('/extract-multiple', extractionLimiter, async (req, res, next) => {
  const startTime = Date.now();
  
  try {
    const { bundleIds, searchTerms } = req.body;
    
    if (!bundleIds || !Array.isArray(bundleIds) || bundleIds.length === 0) {
      throw new BadRequestError('Missing or invalid bundle IDs. Please provide an array of bundle IDs.');
    }
    
    // Validate and filter bundle IDs
    const validation = validateBundleIds(bundleIds, config.api.maxBundleIds);
    
    if (validation.valid === 0) {
      throw new ValidationError('No valid bundle IDs provided after filtering.', {
        totalProvided: validation.total,
        invalidCount: validation.invalid,
        validCount: validation.valid
      });
    }
    
    // Validate search terms
    const validatedTerms = validateSearchTerms(searchTerms);
    
    logger.info({
      bundleIdsCount: validation.validIds.length,
      searchTermsCount: validatedTerms?.length || 0,
      clientIp: req.ip
    }, 'Multi extraction request');
    
    // Limit concurrency to avoid overloading
    const MAX_CONCURRENT = Math.min(5, validation.validIds.length);
    const results = [];
    const errors = [];
    let completed = 0;
    let skipped = 0;
    
    // Process in batches
    for (let i = 0; i < validation.validIds.length; i += MAX_CONCURRENT) {
      const batch = validation.validIds.slice(i, Math.min(i + MAX_CONCURRENT, validation.validIds.length));
      
      const batchPromises = batch.map(bundleId => (async () => {
        try {
          const result = await getDeveloperInfo(bundleId, validatedTerms);
          completed++;
          return result;
        } catch (err) {
          completed++;
          errors.push({ bundleId, error: err.message });
          return { 
            bundleId, 
            success: false, 
            error: err.message,
            timestamp: Date.now()
          };
        }
      })());
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Log progress for large batches
      if (validation.validIds.length > 20) {
        logger.info({
          progress: `${Math.min((i + MAX_CONCURRENT), validation.validIds.length)}/${validation.validIds.length}`,
          timeElapsed: `${Math.round((Date.now() - startTime) / 1000)}s`
        }, 'Batch processing progress');
      }
    }
    
    // Calculate statistics
    const successResults = results.filter(r => r.success);
    const appsWithAppAdsTxt = successResults.filter(r => r.appAdsTxt?.exists).length;
    
    // Search statistics if applicable
    let searchStats = null;
    if (validatedTerms?.length > 0) {
      searchStats = analyzeSearchTerms(results, validatedTerms);
    }
    
    // Domain relationship analysis
    const domainAnalysis = analyzeDomainRelationships(results);
    const processingTime = Date.now() - startTime;
    
    logger.info({
      completed,
      skipped,
      processingTime,
      errorCount: errors.length,
      successCount: successResults.length
    }, 'Completed multi extraction');
    
    // Return the results
    res.json({
      results,
      errorCount: errors.length,
      successCount: successResults.length,
      skippedCount: skipped,
      totalProcessed: validation.validIds.length,
      appsWithAppAdsTxt,
      searchStats,
      domainAnalysis,
      cacheStats: cache.getStats(),
      success: true,
      processingTime: `${processingTime}ms`
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @api {get} /api/check-app-ads Check app-ads.txt for a domain
 * @apiName CheckAppAds
 * @apiGroup AppAds
 * 
 * @apiParam {String} domain Domain to check
 * @apiParam {String|String[]} [searchTerms] Optional search terms
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Object} result Check result
 */
router.get('/check-app-ads', async (req, res, next) => {
  try {
    const { domain, searchTerms } = req.query;
    
    if (!domain) {
      throw new BadRequestError('Domain is required');
    }
    
    logger.info({ domain, hasSearchTerms: !!searchTerms }, 'App-ads.txt check request');
    
    // Validate search terms
    const validatedTerms = validateSearchTerms(searchTerms);
    
    // Check app-ads.txt
    const result = await checkAppAdsTxt(domain, validatedTerms);
    
    res.json({
      success: true,
      result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @api {get} /api/stats Get application statistics
 * @apiName GetStats
 * @apiGroup Stats
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Object} stats Statistics
 */
router.get('/stats', async (req, res, next) => {
  try {
    // Collect statistics
    const stats = {
      cache: cache.getStats(),
      // Add other stats as needed
    };
    
    res.json({
      success: true,
      stats
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;