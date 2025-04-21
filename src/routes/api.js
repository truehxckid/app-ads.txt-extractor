/**
 * API Routes for App-Ads.txt Extractor
 * Enhanced with pagination and memory optimizations
 */

'use strict';

const express = require('express');
const crypto = require('crypto');
const { getDeveloperInfo } = require('../core/store-extractor');
const { checkAppAdsTxt } = require('../core/app-ads-checker'); 
const { analyzeDomainRelationships, analyzeSearchTerms } = require('../core/domain-analyzer');
const { validateBundleIds, validateSearchTerms } = require('../utils/validation');
const { apiLimiter, createRateLimiter } = require('../middleware/rate-limiter');
const cache = require('../services/cache');
const config = require('../config');
const { BadRequestError, ValidationError } = require('../middleware/error-handler');
const { getLogger } = require('../utils/logger');
const memoryManager = require('../services/memory-manager');

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
 * @apiParam {Number} [page=1] Page number for pagination
 * @apiParam {Number} [pageSize=20] Number of results per page
 * @apiParam {Boolean} [fullAnalysis=true] Whether to include full analysis in response
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Object[]} results Extraction results
 * @apiSuccess {Number} errorCount Number of errors
 * @apiSuccess {Number} successCount Number of successful extractions
 * @apiSuccess {Number} totalProcessed Total number of processed bundle IDs
 * @apiSuccess {Object} domainAnalysis Domain relationship analysis
 * @apiSuccess {Object} pagination Pagination information
 */
router.post('/extract-multiple', extractionLimiter, async (req, res, next) => {
  const startTime = Date.now();
  
  try {
    const { 
      bundleIds, 
      searchTerms,
      page = 1,
      pageSize = config.api.defaultPageSize,
      fullAnalysis = true 
    } = req.body;
    
    // Validate page and pageSize parameters
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSizeNum = Math.max(5, Math.min(config.api.maxPageSize, parseInt(pageSize, 10) || config.api.defaultPageSize));
    
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
      clientIp: req.ip,
      page: pageNum,
      pageSize: pageSizeNum
    }, 'Multi extraction request');
    
    // Generate a unique request ID for caching paginated results
    const requestId = crypto.createHash('md5')
      .update(JSON.stringify({
        ids: validation.validIds.sort(),
        terms: validatedTerms || []
      }))
      .digest('hex');
    
    // Try to get cached results first
    const cacheKey = `request-results:${requestId}`;
    const cachedResults = await cache.get(cacheKey);
    
    if (cachedResults) {
      logger.info({
        requestId,
        cached: true
      }, 'Using cached results');
      
      // Apply pagination to the cached results
      const paginatedData = paginateResults(cachedResults, pageNum, pageSizeNum);
      
      // Return the paginated cached results
      return res.json({
        ...paginatedData,
        cacheStats: cache.getStats(),
        success: true,
        cached: true,
        processingTime: `${Date.now() - startTime}ms`
      });
    }
    
    // Check if we have enough memory for this operation
    const estimatedMemoryMb = memoryManager.estimateMemoryRequirement(
      validation.validIds.length * 10000, // Rough size estimate
      'json-parsing'
    );
    
    if (!memoryManager.hasEnoughMemory(estimatedMemoryMb)) {
      logger.warn({
        bundleIdsCount: validation.validIds.length,
        estimatedMemoryMb
      }, 'Potentially insufficient memory for operation');
      
      // Force garbage collection to free memory
      memoryManager.forceGarbageCollection();
    }
    
    // Limit concurrency to avoid overloading
    const MAX_CONCURRENT = Math.min(4, validation.validIds.length);
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
      
      // Check memory usage between batches
      if (i > 0 && i % (MAX_CONCURRENT * 5) === 0) {
        memoryManager.checkMemoryUsage();
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
    
    // Domain relationship analysis if requested
    let domainAnalysis = null;
    if (fullAnalysis) {
      domainAnalysis = analyzeDomainRelationships(results);
    }
    
    const processingTime = Date.now() - startTime;
    
    logger.info({
      completed,
      skipped,
      processingTime,
      errorCount: errors.length,
      successCount: successResults.length
    }, 'Completed multi extraction');
    
    // Prepare complete response data for caching
    const completeResponseData = {
      results,
      errorCount: errors.length,
      successCount: successResults.length,
      skippedCount: skipped,
      totalProcessed: validation.validIds.length,
      appsWithAppAdsTxt,
      searchStats,
      domainAnalysis,
      totalPages: Math.ceil(results.length / pageSizeNum),
      totalItems: results.length
    };
    
    // Cache the complete results for future pagination requests
    // Short TTL for these results (5 minutes)
    await cache.set(cacheKey, completeResponseData, 0.083); // 5 minutes in hours
    
    // Apply pagination to the results
    const paginatedData = paginateResults(completeResponseData, pageNum, pageSizeNum);
    
    // Return the paginated response
    res.json({
      ...paginatedData,
      cacheStats: cache.getStats(),
      success: true,
      processingTime: `${processingTime}ms`
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @api {post} /api/export-csv Export results to CSV without pagination
 * @apiName ExportCsv
 * @apiGroup Extraction
 * 
 * @apiParam {String[]} bundleIds Array of app bundle IDs
 * @apiParam {String|String[]} [searchTerms] Optional search terms for app-ads.txt
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Object[]} results Full extraction results
 */
router.post('/export-csv', extractionLimiter, async (req, res, next) => {
  const startTime = Date.now();
  
  try {
    const { bundleIds, searchTerms } = req.body;
    
    if (!bundleIds || !Array.isArray(bundleIds) || bundleIds.length === 0) {
      throw new BadRequestError('Missing or invalid bundle IDs. Please provide an array of bundle IDs.');
    }
    
    // Validate and filter bundle IDs - with higher limit for exports
    const csvExportLimit = config.api.maxBundleIds * 2; // Double the normal limit for CSV exports
    const validation = validateBundleIds(bundleIds, csvExportLimit);
    
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
      clientIp: req.ip,
      endpoint: 'export-csv'
    }, 'CSV export request');
    
    // Check if we have enough memory for this operation
    const estimatedMemoryMb = memoryManager.estimateMemoryRequirement(
      validation.validIds.length * 10000, // Rough size estimate
      'json-parsing'
    );
    
    if (!memoryManager.hasEnoughMemory(estimatedMemoryMb)) {
      logger.warn({
        bundleIdsCount: validation.validIds.length,
        estimatedMemoryMb
      }, 'Potentially insufficient memory for export operation');
      
      // Force garbage collection to free memory
      memoryManager.forceGarbageCollection();
    }
    
    // Process in larger batches for export - with higher concurrency
    const MAX_CONCURRENT = Math.min(6, validation.validIds.length);
    const results = [];
    const errors = [];
    let completed = 0;
    
    // Process in batches with progress tracking
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
      
      // Log progress for large exports
      if (validation.validIds.length > 20 && (i + MAX_CONCURRENT) % 20 === 0) {
        logger.info({
          progress: `${Math.min((i + MAX_CONCURRENT), validation.validIds.length)}/${validation.validIds.length}`,
          timeElapsed: `${Math.round((Date.now() - startTime) / 1000)}s`,
          endpoint: 'export-csv'
        }, 'CSV export batch processing progress');
      }
      
      // Check memory usage between larger batches
      if (i > 0 && i % (MAX_CONCURRENT * 5) === 0) {
        memoryManager.checkMemoryUsage();
      }
    }
    
    // Calculate statistics for the response
    const successResults = results.filter(r => r.success);
    const appsWithAppAdsTxt = successResults.filter(r => r.appAdsTxt?.exists).length;
    
    // Search statistics if applicable
    let searchStats = null;
    if (validatedTerms?.length > 0) {
      searchStats = analyzeSearchTerms(results, validatedTerms);
    }
    
    const processingTime = Date.now() - startTime;
    
    logger.info({
      completed,
      processingTime,
      errorCount: errors.length,
      successCount: successResults.length,
      endpoint: 'export-csv'
    }, 'Completed CSV export processing');
    
    // Return full dataset without pagination
    res.json({
      results,
      errorCount: errors.length,
      successCount: successResults.length,
      totalProcessed: validation.validIds.length,
      appsWithAppAdsTxt,
      searchStats,
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
      memory: memoryManager.getStats(),
      uptime: process.uptime(),
      nodeVersion: process.version,
      environment: config.server.env,
      workers: {
        maxWorkers: config.workers.maxWorkers,
        maxRssMb: config.workers.maxRssMb,
        maxHeapMb: config.workers.maxHeapMb
      }
    };
    
    res.json({
      success: true,
      stats
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @api {get} /api/memory Get memory usage statistics
 * @apiName GetMemory
 * @apiGroup Stats
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Object} memory Memory usage statistics
 */
router.get('/memory', async (req, res, next) => {
  try {
    // Force a memory check to get latest data
    memoryManager.checkMemoryUsage();
    
    const memoryStats = memoryManager.getStats();
    
    res.json({
      success: true,
      memory: memoryStats
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @api {post} /api/performance-test Run a performance test
 * @apiName PerformanceTest
 * @apiGroup Testing
 * 
 * @apiParam {Number} [iterations=10] Number of iterations to run
 * @apiParam {Number} [concurrency=2] Number of concurrent operations
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Object} results Test results
 */
router.post('/performance-test', extractionLimiter, async (req, res, next) => {
  try {
    const { iterations = 10, concurrency = 2 } = req.body;
    
    // Limit test parameters to reasonable values
    const actualIterations = Math.min(50, Math.max(1, parseInt(iterations, 10) || 10));
    const actualConcurrency = Math.min(5, Math.max(1, parseInt(concurrency, 10) || 2));
    
    logger.info({
      iterations: actualIterations,
      concurrency: actualConcurrency
    }, 'Starting performance test');
    
    const startTime = Date.now();
    const results = [];
    
    // Run test iterations in batches based on concurrency
    for (let i = 0; i < actualIterations; i += actualConcurrency) {
      const batch = new Array(Math.min(actualConcurrency, actualIterations - i))
        .fill(0)
        .map((_, index) => runTestIteration(i + index));
        
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
      
      // Check memory between batches
      memoryManager.checkMemoryUsage();
    }
    
    // Calculate statistics
    const totalDuration = Date.now() - startTime;
    const avgIterationTime = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    const maxMemoryUsed = Math.max(...results.map(r => r.memoryUsage.heapUsed || 0));
    
    res.json({
      success: true,
      testResults: {
        iterations: actualIterations,
        concurrency: actualConcurrency,
        totalDuration: `${totalDuration}ms`,
        avgIterationTime: `${Math.round(avgIterationTime)}ms`,
        maxHeapUsedMb: `${Math.round(maxMemoryUsed / (1024 * 1024))}MB`,
        results
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Run a single test iteration
 * @param {Number} iteration - Iteration number
 * @returns {Promise<Object>} - Test results
 */
async function runTestIteration(iteration) {
  const iterStart = Date.now();
  const memBefore = process.memoryUsage();
  
  try {
    // Perform some standard operations
    const domain = 'example.com';
    const result = await checkAppAdsTxt(domain);
    
    const memAfter = process.memoryUsage();
    const memDiff = {
      heapUsed: memAfter.heapUsed - memBefore.heapUsed,
      rss: memAfter.rss - memBefore.rss
    };
    
    return {
      iteration,
      duration: Date.now() - iterStart,
      success: true,
      memoryUsage: memDiff,
      result: { domainChecked: domain, found: result.exists }
    };
  } catch (err) {
    return {
      iteration,
      duration: Date.now() - iterStart,
      success: false,
      error: err.message
    };
  }
}

/**
 * Paginate the results data
 * @param {Object} data - Complete response data
 * @param {Number} page - Page number
 * @param {Number} pageSize - Page size
 * @returns {Object} - Paginated data
 */
function paginateResults(data, page, pageSize) {
  // Calculate pagination values
  const totalItems = data.results.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const currentPage = Math.max(1, Math.min(page, totalPages || 1));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  
  // Extract the items for the current page
  const paginatedResults = data.results.slice(startIndex, endIndex);
  
  // Create pagination metadata
  const pagination = {
    currentPage,
    pageSize,
    totalPages,
    totalItems,
    hasNextPage: currentPage < totalPages,
    hasPrevPage: currentPage > 1
  };
  
  // Return paginated response
  return {
    results: paginatedResults,
    pagination,
    errorCount: data.errorCount,
    successCount: data.successCount,
    skippedCount: data.skippedCount,
    totalProcessed: data.totalProcessed,
    appsWithAppAdsTxt: data.appsWithAppAdsTxt,
    searchStats: data.searchStats,
    domainAnalysis: data.domainAnalysis,
  };
}

module.exports = router;