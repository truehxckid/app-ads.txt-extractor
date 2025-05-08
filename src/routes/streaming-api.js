/**
 * Streaming API Routes for App-Ads.txt Extractor
 * Provides streaming endpoints for handling large datasets
 */

'use strict';

const express = require('express');
const crypto = require('crypto');
const { getDeveloperInfo } = require('../core/store-extractor');
const { checkAppAdsTxt, streamAppAdsTxt } = require('../core/app-ads-checker'); 
const { validateBundleIds, validateSearchTerms } = require('../utils/validation');
const { apiLimiter, createRateLimiter } = require('../middleware/rate-limiter');
const config = require('../config');
const { BadRequestError, ValidationError } = require('../middleware/error-handler');
const { getLogger } = require('../utils/logger');
const memoryManager = require('../services/memory-manager');
const { getStoreDisplayName } = require('../utils/formatting');

const logger = getLogger('streaming-api-routes');
const router = express.Router();

// Apply rate limiting to streaming endpoints
const streamingLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Limit to 10 streaming requests per 5 minutes
  message: 'Too many streaming requests, please try again later.'
});

/**
 * @api {post} /api/stream/extract-multiple Stream extraction results for multiple bundle IDs
 * @apiName StreamExtractMultiple
 * @apiGroup Streaming
 * 
 * @apiParam {String[]} bundleIds Array of app bundle IDs
 * @apiParam {String|String[]} [searchTerms] Optional search terms for app-ads.txt
 * 
 * @apiSuccess {Stream} response JSON stream of results
 */
router.post('/extract-multiple', streamingLimiter, async (req, res, next) => {
  // Track processing stats
  const startTime = Date.now();
  let processedCount = 0;
  let successCount = 0;
  let errorCount = 0;
  let withAppAdsTxtCount = 0;
  
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
      clientIp: req.ip,
      endpoint: 'stream/extract-multiple'
    }, 'Streaming extraction request');
    
    // Set appropriate headers for streaming
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    // Check if client requested debug mode
    const debugMode = req.headers['x-debug-mode'] === 'true';
    if (debugMode) {
      res.setHeader('X-Debug-Enabled', 'true');
    }
    
    // Start the response with opening metadata and include timestamp for debugging
    res.write(`{"success":true,"timestamp":${Date.now()},"debugMode":${debugMode},"results":[`);
    
    // Send initial heartbeat to confirm connection is working
    res.write(`\n/* Initial connection heartbeat: ${Date.now()} */\n`);
    if (typeof res.flush === 'function') {
      res.flush();
    }
    
    // Process bundle IDs in small batches
    const BATCH_SIZE = 10;
    const totalBatches = Math.ceil(validation.validIds.length / BATCH_SIZE);
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      // Check memory usage between batches
      if (batchIndex > 0 && batchIndex % 5 === 0) {
        memoryManager.checkMemoryUsage();
      }
      
      const batchStart = batchIndex * BATCH_SIZE;
      const batchEnd = Math.min((batchIndex + 1) * BATCH_SIZE, validation.validIds.length);
      const batch = validation.validIds.slice(batchStart, batchEnd);
      
      // Send batch progress message as comment to keep connection alive
      if (batchIndex > 0 || batch.length > 0) {
        res.write(`\n/* Processing batch ${batchIndex + 1}/${totalBatches} at ${Date.now()} */\n`);
        if (typeof res.flush === 'function') {
          res.flush();
        }
      }
      
      // Process just a few items concurrently to avoid overloading
      const MAX_CONCURRENT = Math.min(3, batch.length);
      const results = [];
      
      // Process in smaller groups to maintain responsiveness
      for (let i = 0; i < batch.length; i += MAX_CONCURRENT) {
        const currentBatch = batch.slice(i, Math.min(i + MAX_CONCURRENT, batch.length));
        
        // Process this smaller batch
        const batchPromises = currentBatch.map(bundleId => (async () => {
          try {
            const result = await getDeveloperInfo(bundleId, validatedTerms);
            processedCount++;
            
            if (result.success) {
              successCount++;
              if (result.appAdsTxt?.exists) {
                withAppAdsTxtCount++;
              }
            } else {
              errorCount++;
            }
            
            return result;
          } catch (err) {
            processedCount++;
            errorCount++;
            
            return { 
              bundleId, 
              success: false, 
              error: err.message,
              timestamp: Date.now()
            };
          }
        })());
        
        // Wait for current batch to complete
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // Send progress heartbeat after each small batch
        res.write(`\n/* Progress: ${processedCount}/${validation.validIds.length} at ${Date.now()} */\n`);
        if (typeof res.flush === 'function') {
          res.flush();
        }
      }
      
      // Use the results from our processed batches
      const batchResults = results;
      
      // Stream each result immediately
      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i];
        
        // Add comma if not the first batch and first result
        if (batchIndex > 0 || i > 0) {
          res.write(',');
        }
        
        // Stream the result
        res.write(JSON.stringify(result));
        
        // Flush after each result to ensure immediate transmission
        if (typeof res.flush === 'function') {
          res.flush();
        }
        
        // Add small delay between items to avoid overwhelming clients and prevent timeouts
        if (i % 3 === 0) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      
      // Send a heartbeat message every few batches to keep connection alive
      if (batchIndex % 2 === 0) {
        // Send a comment in the JSON stream to act as a heartbeat
        res.write(`\n/* heartbeat: ${Date.now()} */\n`);
        
        if (typeof res.flush === 'function') {
          res.flush();
        }
      }
      
      // Log progress for large batches
      if (validation.validIds.length > 50 && (batchIndex + 1) % 5 === 0) {
        const progress = Math.min(batchEnd, validation.validIds.length);
        const percent = Math.round((progress / validation.validIds.length) * 100);
        
        logger.info({
          progress: `${progress}/${validation.validIds.length} (${percent}%)`,
          timeElapsed: `${Math.round((Date.now() - startTime) / 1000)}s`,
          successCount,
          errorCount
        }, 'Streaming progress');
      }
    }
    
    // Send final heartbeat before closing
    res.write(`\n/* Final heartbeat before closing: ${Date.now()} */\n`);
    if (typeof res.flush === 'function') {
      res.flush();
    }
    
    // Complete the response with closing metadata
    const processingTime = Date.now() - startTime;
    
    res.write(`],"totalProcessed":${processedCount},"successCount":${successCount},"errorCount":${errorCount},"appsWithAppAdsTxt":${withAppAdsTxtCount},"processingTime":"${processingTime}ms","endTimestamp":${Date.now()}}`);
    res.end();
    
    logger.info({
      bundleIdsCount: validation.validIds.length,
      processedCount,
      successCount,
      errorCount,
      processingTime: `${processingTime}ms`
    }, 'Streaming extraction completed');
    
  } catch (err) {
    // If we haven't started streaming results yet, pass to error handler
    if (!res.headersSent) {
      next(err);
      return;
    }
    
    // If headers already sent, we need to end the response properly
    try {
      // Try to complete JSON with error
      res.write(`],"error":"${err.message}","success":false,"processingTime":"${Date.now() - startTime}ms"}`);
      res.end();
      
      logger.error({
        error: err.message,
        stack: err.stack,
        processedCount
      }, 'Error during streaming extraction');
    } catch (endError) {
      // If we can't even end properly, just destroy the connection
      logger.error({
        error: endError.message
      }, 'Error ending stream after error');
      
      res.destroy();
    }
  }
});

/**
 * @api {post} /api/stream/export-csv Stream CSV export for multiple bundle IDs
 * @apiName StreamExportCsv
 * @apiGroup Streaming
 * 
 * @apiParam {String[]} bundleIds Array of app bundle IDs
 * @apiParam {String|String[]} [searchTerms] Optional search terms for app-ads.txt
 * 
 * @apiSuccess {Stream} response CSV stream
 */
router.post('/export-csv', streamingLimiter, async (req, res, next) => {
  const startTime = Date.now();
  let processedCount = 0;
  
  try {
    const { bundleIds, searchTerms, structuredParams } = req.body;
    
    if (!bundleIds || !Array.isArray(bundleIds) || bundleIds.length === 0) {
      throw new BadRequestError('Missing or invalid bundle IDs. Please provide an array of bundle IDs.');
    }
    
    // Validate and filter bundle IDs
    // Allow more bundle IDs for CSV export
    const validation = validateBundleIds(bundleIds, config.api.maxBundleIds * 2);
    
    if (validation.valid === 0) {
      throw new ValidationError('No valid bundle IDs provided after filtering.', {
        totalProvided: validation.total,
        invalidCount: validation.invalid,
        validCount: validation.valid
      });
    }
    
    // Determine if we have advanced search parameters
    const isAdvancedSearch = structuredParams && (
      Array.isArray(structuredParams) ? structuredParams.length > 0 : Object.keys(structuredParams).length > 0
    );
    
    // Validate search terms
    const validatedTerms = validateSearchTerms(searchTerms);
    // Also validate structured params if provided (pass through as is)
    const validatedStructuredParams = isAdvancedSearch ? structuredParams : null;
    
    logger.info({
      bundleIdsCount: validation.validIds.length,
      searchTermsCount: validatedTerms?.length || 0,
      hasStructuredParams: !!validatedStructuredParams,
      isAdvancedSearch,
      clientIp: req.ip,
      endpoint: 'stream/export-csv'
    }, 'Streaming CSV export request');
    
    // Set appropriate headers for CSV download
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="developer_domains_${new Date().toISOString().slice(0, 10)}.csv"`);
    
    // Create CSV header
    let csvHeader = "Bundle ID,Store,Domain,Has App-Ads.txt,App-Ads.txt URL";
    
    // Decide on search columns based on whether we have advanced search or simple search
    if (isAdvancedSearch && validatedStructuredParams) {
      // For advanced search, use simplified headers
      csvHeader += ",Advanced Search Results,Match Count,Matching Lines";
    } else if (validatedTerms && validatedTerms.length > 0) {
      // Create separate column for each search term if multiple terms exist
      if (validatedTerms.length > 1) {
        // Add a column for each search term
        validatedTerms.forEach((term, index) => {
          const termStr = typeof term === 'object' ? 
            (term.exactMatch || Object.values(term).join('+')) : term;
          csvHeader += `,Term ${index+1}: ${termStr},Matches ${index+1}`;
        });
        // Add a total matches column
        csvHeader += `,Total Matches,Matching Lines`;
      } else {
        // Single search term - use simpler header
        csvHeader += `,Search Term,Search Matches,Matching Lines`;
      }
    }
    
    // Complete the header
    csvHeader += ",Success,Error\n";
    
    // Write header
    res.write(csvHeader);
    
    // Process bundle IDs in small batches
    const BATCH_SIZE = 10;
    const totalBatches = Math.ceil(validation.validIds.length / BATCH_SIZE);
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      // Check memory usage between batches
      if (batchIndex > 0 && batchIndex % 5 === 0) {
        memoryManager.checkMemoryUsage();
      }
      
      const batchStart = batchIndex * BATCH_SIZE;
      const batchEnd = Math.min((batchIndex + 1) * BATCH_SIZE, validation.validIds.length);
      const batch = validation.validIds.slice(batchStart, batchEnd);
      
      // Process batch concurrently
      const batchPromises = batch.map(bundleId => (async () => {
        try {
          // If we have advanced search, use structured params instead of search terms
          if (isAdvancedSearch && validatedStructuredParams) {
            return await getDeveloperInfo(bundleId, [], validatedStructuredParams);
          } else {
            return await getDeveloperInfo(bundleId, validatedTerms);
          }
        } catch (err) {
          return { 
            bundleId, 
            success: false, 
            error: err.message,
            timestamp: Date.now()
          };
        }
      })());
      
      // Wait for all bundle IDs in batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Stream each result as CSV
      for (const result of batchResults) {
        const csvLine = generateCsvLine(result, validatedTerms);
        res.write(csvLine);
        processedCount++;
        
        // Flush after each result to ensure immediate transmission
        if (typeof res.flush === 'function') {
          res.flush();
        }
      }
      
      // Log progress for large batches
      if (validation.validIds.length > 50 && (batchIndex + 1) % 5 === 0) {
        const progress = Math.min(batchEnd, validation.validIds.length);
        const percent = Math.round((progress / validation.validIds.length) * 100);
        
        logger.info({
          progress: `${progress}/${validation.validIds.length} (${percent}%)`,
          timeElapsed: `${Math.round((Date.now() - startTime) / 1000)}s`
        }, 'CSV export progress');
      }
    }
    
    // End the response
    res.end();
    
    const processingTime = Date.now() - startTime;
    logger.info({
      bundleIdsCount: validation.validIds.length,
      processedCount,
      processingTime: `${processingTime}ms`
    }, 'Streaming CSV export completed');
    
  } catch (err) {
    // If we haven't started streaming yet, pass to error handler
    if (!res.headersSent) {
      next(err);
      return;
    }
    
    // If headers already sent, we need to end the response
    try {
      // For CSV we can add an error comment at the end
      res.write(`\n# Error occurred after processing ${processedCount} items: ${err.message}\n`);
      res.end();
      
      logger.error({
        error: err.message,
        stack: err.stack,
        processedCount
      }, 'Error during streaming CSV export');
    } catch (endError) {
      // If we can't even end properly, just destroy the connection
      logger.error({
        error: endError.message
      }, 'Error ending CSV stream after error');
      
      res.destroy();
    }
  }
});

/**
 * Helper function to generate CSV line for a result
 * @param {Object} result - Extraction result
 * @param {Array} searchTerms - Search terms if provided
 * @param {Object|Array} structuredParams - Structured search parameters (optional)
 * @returns {string} - CSV line
 */
function generateCsvLine(result, searchTerms) {
  const hasAppAds = result.success && result.appAdsTxt?.exists;
  
  // Basic columns
  const basicCols = [
    `"${(result.bundleId || '').replace(/"/g, '""')}"`,
    `"${(result.storeType ? getStoreDisplayName(result.storeType) : '').replace(/"/g, '""')}"`,
    `"${(result.domain || '').replace(/"/g, '""')}"`,
    hasAppAds ? "Yes" : "No",
    `"${(hasAppAds ? result.appAdsTxt.url : '').replace(/"/g, '""')}"`
  ];
  
  // Search columns
  let searchCols = [];
  
  // Detect if we're dealing with advanced search parameters
  const isAdvancedSearch = result && 
    result.appAdsTxt?.searchResults?.mode === 'advanced' &&
    result.appAdsTxt?.searchResults?.advancedParams;
    
  if (isAdvancedSearch) {
    // Handle advanced search format
    const hasMatches = hasAppAds && result.appAdsTxt.searchResults?.count > 0;
    const matchCount = hasMatches ? result.appAdsTxt.searchResults.count : 0;
    
    // Format advanced search results
    let advancedSearchInfo = '';
    if (hasMatches && result.appAdsTxt.searchResults?.advancedParams) {
      const params = result.appAdsTxt.searchResults.advancedParams;
      
      // Format each parameter as a readable string
      if (Array.isArray(params)) {
        const paramStrings = params.map(param => {
          const parts = [];
          if (param.domain) parts.push(`domain: ${param.domain}`);
          if (param.publisherId) parts.push(`publisherId: ${param.publisherId}`);
          if (param.relationship) parts.push(`relationship: ${param.relationship}`);
          if (param.tagId) parts.push(`tagId: ${param.tagId}`);
          return parts.join(', ');
        });
        advancedSearchInfo = paramStrings.join(' | ');
      } else {
        // Single parameter object
        const parts = [];
        if (params.domain) parts.push(`domain: ${params.domain}`);
        if (params.publisherId) parts.push(`publisherId: ${params.publisherId}`);
        if (params.relationship) parts.push(`relationship: ${params.relationship}`);
        if (params.tagId) parts.push(`tagId: ${params.tagId}`);
        advancedSearchInfo = parts.join(', ');
      }
    }
    
    // Limit matching lines for CSV
    const matchingLinesSummary = hasMatches ? 
      truncateMatchingLines(result.appAdsTxt.searchResults.matchingLines) : '';
    
    searchCols = [
      `"${advancedSearchInfo}"`,
      matchCount.toString(),
      `"${matchingLinesSummary.replace(/"/g, '""')}"`
    ];
  } else if (searchTerms && searchTerms.length > 0) {
    const hasMatches = hasAppAds && result.appAdsTxt.searchResults?.count > 0;
    const matchCount = hasMatches ? result.appAdsTxt.searchResults.count : 0;
    
    // Limit matching lines for CSV
    const matchingLinesSummary = hasMatches ? 
      truncateMatchingLines(result.appAdsTxt.searchResults.matchingLines) : '';
    
    // Handle multiple search terms with separate columns
    if (searchTerms.length > 1) {
      // Add individual term match columns
      searchTerms.forEach((term, index) => {
        // Properly format the term string (handle both string and object formats)
        const termStr = typeof term === 'object' ? 
          (term.exactMatch || Object.values(term).filter(Boolean).join('+')) : term;
          
        // Find term-specific matches
        let termMatchCount = 0;
        if (hasMatches && result.appAdsTxt.searchResults?.termResults) {
          const termResult = result.appAdsTxt.searchResults.termResults[index];
          if (termResult) {
            termMatchCount = termResult.count || 0;
          }
        }
        
        // Add term and its match count
        searchCols.push(
          `"${(termStr || '').replace(/"/g, '""')}"`,
          termMatchCount.toString()
        );
      });
      
      // Add total matches and matching lines columns
      searchCols.push(
        matchCount.toString(),
        `"${matchingLinesSummary.replace(/"/g, '""')}"`
      );
    } else {
      // Single search term - use simpler format
      const searchTermText = Array.isArray(searchTerms) && searchTerms.length > 0 ? 
        searchTerms[0] : (searchTerms || '');
      
      // Format the term properly
      const termStr = typeof searchTermText === 'object' ?
        (searchTermText.exactMatch || Object.values(searchTermText).filter(Boolean).join('+')) :
        searchTermText;
      
      searchCols = [
        `"${(termStr || '').replace(/"/g, '""')}"`,
        matchCount.toString(),
        `"${matchingLinesSummary.replace(/"/g, '""')}"`
      ];
    }
  }
  
  // Status columns
  const statusCols = [
    result.success ? "Yes" : "No",
    `"${(result.error || '').replace(/"/g, '""')}"`
  ];
  
  return basicCols.concat(searchCols, statusCols).join(',') + '\n';
}

/**
 * Helper to truncate matching lines for CSV
 * @param {Array} matchingLines - Array of matching lines
 * @param {number} limit - Maximum number of lines to include
 * @returns {string} - Truncated representation
 */
function truncateMatchingLines(matchingLines, limit = 10) {
  if (!matchingLines || !matchingLines.length) return '';
  
  const lines = matchingLines
    .slice(0, limit)
    .map(line => `Line ${line.lineNumber}: ${line.content.replace(/"/g, '""')}`)
    .join(' | ');
    
  return matchingLines.length > limit ? 
    `${lines} (+ ${matchingLines.length - limit} more)` : lines;
}

/**
 * @api {get} /api/stream/app-ads Stream app-ads.txt content for a domain
 * @apiName StreamAppAds
 * @apiGroup Streaming
 * 
 * @apiParam {String} domain Domain to check
 * @apiParam {String|String[]} [searchTerms] Optional search terms
 * 
 * @apiSuccess {Stream} response Streaming app-ads.txt content
 */
router.get('/app-ads', async (req, res, next) => {
  try {
    const { domain, searchTerms } = req.query;
    
    if (!domain) {
      throw new BadRequestError('Domain is required');
    }
    
    // Validate search terms
    const validatedTerms = validateSearchTerms(searchTerms);
    
    logger.info({ 
      domain, 
      hasSearchTerms: !!validatedTerms 
    }, 'Streaming app-ads.txt request');
    
    // Set headers for streaming
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    
    // Start the response
    res.write('{"success":true,"domain":"' + domain + '","streaming":true,"data":{');
    
    // Stream app-ads.txt content
    try {
      const contentStream = await streamAppAdsTxt(domain, validatedTerms, res);
      
      // End the response
      res.write('}}');
      res.end();
      
    } catch (streamErr) {
      // Handle streaming error
      if (!res.headersSent) {
        next(streamErr);
        return;
      }
      
      // If headers already sent, complete the response with error
      res.write(`"error":"${streamErr.message}","success":false}}`);
      res.end();
      
      logger.error({
        domain,
        error: streamErr.message,
        stack: streamErr.stack
      }, 'Error streaming app-ads.txt');
    }
    
  } catch (err) {
    next(err);
  }
});

module.exports = router;