/**
 * App-Ads.txt Checker for App-Ads.txt Extractor
 * Handles all functionality related to fetching and analyzing app-ads.txt files
 */

'use strict';

const { WorkerPool, Priority } = require('../services/worker-pool');
const path = require('path');
const cache = require('../services/cache');
const { fetchText } = require('../utils/http');
const rateLimiter = require('../services/rate-limiter');
const { validateSearchTerms, isValidDomain } = require('../utils/validation');
const { keys, getTtl } = require('../config/cache');
const { getLogger } = require('../utils/logger');
const config = require('../config');

const logger = getLogger('app-ads-checker');

// Initialize worker pool for app-ads.txt processing - Fix worker file path to include ".worker"
const appAdsWorkerPool = new WorkerPool(
  path.join(__dirname, '../workers/app-ads-parser.worker.js'),
  {
    maxWorkers: config.workers.maxWorkers,
    minWorkers: 1
  }
);

/**
 * Check for app-ads.txt file on a domain and analyze its content
 * @param {string} domain - Domain to check
 * @param {string|string[]|null} searchTerms - Search terms to look for in the file
 * @returns {Promise<object>} - Results of the check
 */
async function checkAppAdsTxt(domain, searchTerms = null) {
  const startTime = Date.now();
  let fileSize = 0;
  let processingMethod = 'none';
  
  if (!domain) {
    return { exists: false };
  }
  
  // Validate domain format to avoid potential security issues
  if (!isValidDomain(domain)) {
    logger.warn({ domain }, 'Invalid domain format, skipping app-ads.txt check');
    return { exists: false, error: 'Invalid domain format' };
  }
  
  try {
    const normalizedSearchTerms = validateSearchTerms(searchTerms);
    const cacheKey = keys.appAdsTxt(domain, normalizedSearchTerms);
    
    // Check cache first
    const cached = await cache.get(cacheKey);
    if (cached) {
      logger.debug({ domain, cached: true }, 'Using cached app-ads.txt result');
      return cached;
    }
    
    logger.info({ domain, hasSearchTerms: !!normalizedSearchTerms }, 'Checking app-ads.txt');
    
    const protocols = ['https', 'http'];
    let content = null;
    let usedProtocol = null;
    let fetchErrors = [];
    
    // Try fetching with different protocols
    for (const protocol of protocols) {
      if (content) break;
      
      try {
        // Apply rate limiting to avoid overloading servers
        await rateLimiter.limit('app-ads-txt');
        
        const url = `${protocol}://${domain}/app-ads.txt`;
        logger.debug({ url }, 'Fetching app-ads.txt');
        
        const fetchOpts = {
          timeout: 15000,
          validateStatus: status => status === 200
        };
        
        content = await fetchText(url, fetchOpts);
        
        if (content) {
          usedProtocol = protocol;
          // Report success to rate limiter
          rateLimiter.reportSuccess('app-ads-txt');
          break;
        }
      } catch (err) {
        const errorDetails = {
          protocol,
          domain,
          message: err.message,
          status: err.response?.status,
          statusText: err.response?.statusText
        };
        
        // Report error to rate limiter if it's a rate limiting issue
        if (err.response?.status === 429 || err.response?.status === 403) {
          rateLimiter.reportError('app-ads-txt', err.response.status);
        }
        
        fetchErrors.push(errorDetails);
        logger.debug(errorDetails, 'Failed to fetch app-ads.txt');
      }
    }
    
    // If app-ads.txt doesn't exist, cache the negative result
    if (!content) {
      const result = { 
        exists: false,
        fetchErrors: fetchErrors.length > 0 ? fetchErrors : undefined
      };
      
      await cache.set(cacheKey, result, 'appAdsTxtMissing');
      logger.debug({ domain }, 'app-ads.txt not found');
      return result;
    }
    
    fileSize = content.length;
    
    // Determine the best processing method based on content size
    const isLargeFile = content.length > 100000; // 100 KB threshold
    processingMethod = isLargeFile ? 'worker' : 'sync';
    
    logger.debug({
      domain,
      fileSize,
      processingMethod
    }, 'Processing app-ads.txt');
    
    let analyzed, searchResults;
    
    if (isLargeFile) {
      // Use worker thread for large files
      try {
        const workerResult = await appAdsWorkerPool.runTask(
          { content, searchTerms: normalizedSearchTerms },
          Priority.NORMAL
        );
        
        if (!workerResult.success) {
          throw new Error(`Worker thread error: ${workerResult.error}`);
        }
        
        analyzed = workerResult.analyzed;
        searchResults = workerResult.searchResults;
      } catch (workerErr) {
        logger.error({ domain, error: workerErr.message }, 'Worker processing error');
        
        // Fallback to synchronous processing if worker fails
        logger.debug({ domain }, 'Falling back to synchronous processing after worker error');
        const lines = content.split(/\r\n|\n|\r/);
        analyzed = analyzeAppAdsTxt(lines);
        
        if (normalizedSearchTerms?.length > 0) {
          searchResults = processSearchTerms(lines, normalizedSearchTerms);
        }
      }
    } else {
      // Process smaller files synchronously
      const lines = content.split(/\r\n|\n|\r/);
      
      // Analyze the file content
      analyzed = analyzeAppAdsTxt(lines);
      
      // Process search terms if provided
      if (normalizedSearchTerms?.length > 0) {
        searchResults = processSearchTerms(lines, normalizedSearchTerms);
      }
    }
    
    // Trim content if it's too large for caching
    const trimmedContent = content.length > 500000 
      ? content.substring(0, 500000) + '\n... (truncated, file too large)' 
      : content;
    
    const result = {
      exists: true,
      url: `${usedProtocol}://${domain}/app-ads.txt`,
      content: trimmedContent,
      contentLength: content.length,
      analyzed,
      searchResults
    };
    
    const processingTime = Date.now() - startTime;
    logger.debug({
      domain,
      fileSize,
      processingMethod,
      processingTime: `${processingTime}ms`,
      hasSearchTerms: !!normalizedSearchTerms?.length
    }, 'app-ads.txt processing complete');
    
    // Cache the result
    await cache.set(cacheKey, result, 'appAdsTxtFound');
    return result;
  } catch (err) {
    logger.error({ domain, error: err.message }, 'Error checking app-ads.txt');
    
    const result = { 
      exists: false, 
      error: 'Internal error processing app-ads.txt'
    };
    
    await cache.set(keys.appAdsTxt(domain, searchTerms), result, 'appAdsTxtError');
    return result;
  }
}

/**
 * Process search terms against lines of content
 * @param {string[]} lines - Lines of content
 * @param {string[]} searchTerms - Search terms
 * @returns {object} - Search results
 */
function processSearchTerms(lines, searchTerms) {
  const searchResults = {
    terms: searchTerms,
    termResults: searchTerms.map(term => ({
      term,
      matchingLines: [],
      count: 0
    })),
    matchingLines: [],
    count: 0
  };
  
  // Process each line
  lines.forEach((line, lineIndex) => {
    const lineContent = line.trim();
    if (!lineContent) return;
    
    const lineNumber = lineIndex + 1;
    let anyMatch = false;
    
    // Check each search term
    searchTerms.forEach((term, termIndex) => {
      try {
        if (lineContent.toLowerCase().includes(term.toLowerCase())) {
          searchResults.termResults[termIndex].matchingLines.push({
            lineNumber,
            content: lineContent,
            termIndex
          });
          anyMatch = true;
        }
      } catch (err) {
        logger.error({ term, lineIndex, error: err.message }, 'Error matching search term');
      }
    });
    
    // If any term matched, add to overall results
    if (anyMatch) {
      searchResults.matchingLines.push({
        lineNumber,
        content: lineContent
      });
    }
  });
  
  // Update counts
  searchResults.termResults.forEach(result => {
    result.count = result.matchingLines.length;
  });
  searchResults.count = searchResults.matchingLines.length;
  
  return searchResults;
}

/**
 * Analyze app-ads.txt content
 * @param {string[]} lines - Lines of content
 * @returns {object} - Analysis results
 */
function analyzeAppAdsTxt(lines) {
  let validLineCount = 0;
  let commentLineCount = 0;
  let emptyLineCount = 0;
  let invalidLineCount = 0;
  
  const publishers = new Set();
  const relationships = {
    direct: 0,
    reseller: 0,
    other: 0
  };
  
  lines.forEach(line => {
    // Skip empty lines
    if (!line.trim()) {
      emptyLineCount++;
      return;
    }
    
    // Handle comments
    const commentIndex = line.indexOf('#');
    if (commentIndex === 0) {
      commentLineCount++;
      return;
    }
    
    const cleanLine = commentIndex >= 0 ? line.substring(0, commentIndex).trim() : line.trim();
    if (!cleanLine) {
      emptyLineCount++;
      return;
    }
    
    // Parse fields
    const fields = cleanLine.split(',').map(f => f.trim());
    
    if (fields.length >= 3) {
      validLineCount++;
      
      // Extract publisher
      const domain = fields[0].toLowerCase();
      publishers.add(domain);
      
      // Extract relationship
      const relationship = fields[2].toLowerCase();
      if (relationship === 'direct') {
        relationships.direct++;
      } else if (relationship === 'reseller') {
        relationships.reseller++;
      } else {
        relationships.other++;
      }
    } else {
      invalidLineCount++;
    }
  });
  
  return {
    totalLines: lines.length,
    validLines: validLineCount,
    commentLines: commentLineCount,
    emptyLines: emptyLineCount,
    invalidLines: invalidLineCount,
    uniquePublishers: publishers.size,
    relationships
  };
}

/**
 * Shutdown app-ads checker and its dependencies
 */
function shutdown() {
  appAdsWorkerPool.shutdown();
}

module.exports = {
  checkAppAdsTxt,
  processSearchTerms,
  analyzeAppAdsTxt,
  shutdown
};