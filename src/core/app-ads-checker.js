/**
 * App-Ads.txt Checker for App-Ads.txt Extractor
 * Handles all functionality related to fetching and analyzing app-ads.txt files
 * Optimized for memory efficiency with streaming support
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
const axios = require('axios');
const memoryManager = require('../services/memory-manager');

const logger = getLogger('app-ads-checker');

// Initialize worker pool for app-ads.txt processing
const appAdsWorkerPool = new WorkerPool(
  path.join(__dirname, '../workers/app-ads-parser.worker.js'),
  {
    maxWorkers: config.workers.maxWorkers,
    minWorkers: 1,
    // Explicitly set timeouts to ensure they're valid numbers
    taskTimeout: 60000, // 60 seconds for processing large files
    idleTimeout: 120000, // 2 minutes
    // Set memory limits from config
    maxRssMb: config.workers.maxRssMb,
    maxHeapMb: config.workers.maxHeapMb
  }
);

/**
 * Check for app-ads.txt file on a domain and analyze its content
 * Using streaming processing for large files to reduce memory usage
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
    let stream = null;
    
    // Try fetching with different protocols
    for (const protocol of protocols) {
      if (content || stream) break;
      
      try {
        // Apply rate limiting to avoid overloading servers
        await rateLimiter.limit('app-ads-txt');
        
        const url = `${protocol}://${domain}/app-ads.txt`;
        logger.debug({ url }, 'Fetching app-ads.txt');
        
        const fetchOpts = {
          timeout: 15000,
          validateStatus: status => status === 200,
          // Ensure HTTP config is properly initialized
          http: {
            retries: 2,
            retryDelay: 1000
          }
        };
        
        // Check content size first with HEAD request
        try {
          const headResponse = await axios.head(url, {
            timeout: 5000,
            validateStatus: status => status === 200
          });
          
          const contentLength = parseInt(headResponse.headers['content-length'], 10);
          
          // If file is very large, use streaming approach
          if (!isNaN(contentLength) && contentLength > config.workers.streamThresholdBytes) {
            logger.debug({ 
              domain, 
              contentLength: `${Math.round(contentLength / 1024 / 1024)}MB` 
            }, 'Using streaming for large app-ads.txt file');
            
            // Set fileSize for logging
            fileSize = contentLength;
            
            // Get the file as a stream
            const response = await axios.get(url, {
              ...fetchOpts,
              responseType: 'stream'
            });
            
            stream = response.data;
            usedProtocol = protocol;
            
            // Report success to rate limiter
            rateLimiter.reportSuccess('app-ads-txt');
            break;
          }
        } catch (headErr) {
          // If HEAD request fails, just proceed with normal GET request
          logger.debug({ 
            domain, 
            error: headErr.message 
          }, 'HEAD request failed, falling back to GET');
        }
        
        // Standard approach for smaller files
        content = await fetchText(url, fetchOpts);
        
        if (content) {
          usedProtocol = protocol;
          fileSize = content.length;
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
    if (!content && !stream) {
      const result = { 
        exists: false,
        fetchErrors: fetchErrors.length > 0 ? fetchErrors : undefined
      };
      
      await cache.set(cacheKey, result, 'appAdsTxtMissing');
      logger.debug({ domain }, 'app-ads.txt not found');
      return result;
    }
    
    // Determine the best processing method based on content type
    const isStreamMode = !!stream;
    processingMethod = isStreamMode ? 'stream' : (fileSize > 100000 ? 'worker' : 'sync');
    
    logger.debug({
      domain,
      fileSize,
      processingMethod,
      isStreamMode
    }, 'Processing app-ads.txt');
    
    let analyzed, searchResults;
    
    if (isStreamMode) {
      // Process the stream
      try {
        logger.debug({ 
          domain, 
          fileSize: fileSize ? `${Math.round(fileSize / 1024)}KB` : 'unknown',
          searchTermsCount: normalizedSearchTerms?.length || 0
        }, 'Processing stream');
        
        // Parse the stream in chunks to minimize memory usage
        const result = await processStreamedContent(stream, normalizedSearchTerms);
        
        // Set content to a truncated version for caching
        content = result.content;
        analyzed = result.analyzed;
        searchResults = result.searchResults;
        
        logger.debug({
          domain,
          analyzedLines: analyzed?.totalLines || 0,
          validLines: analyzed?.validLines || 0,
          processingTime: Date.now() - startTime
        }, 'Completed stream processing');
      } catch (streamErr) {
        logger.error({ 
          domain, 
          error: streamErr.message,
          stack: streamErr.stack
        }, 'Stream processing error');
        
        // Fall back to normal processing if possible
        if (content) {
          logger.debug({ domain }, 'Falling back to normal processing after stream error');
          processingMethod = fileSize > 100000 ? 'worker' : 'sync';
        } else {
          throw streamErr; // Re-throw if we can't fall back
        }
      }
    }
    
    // If we weren't using streaming or it failed and we have content
    if (!isStreamMode || (processingMethod !== 'stream' && content)) {
      if (processingMethod === 'worker') {
        // Use worker thread for large files
        try {
          logger.debug({ 
            domain, 
            contentSize: content.length,
            searchTermsCount: normalizedSearchTerms?.length || 0
          }, 'Using worker thread for large file');
          
          const workerResult = await appAdsWorkerPool.runTask(
            { content, searchTerms: normalizedSearchTerms },
            Priority.NORMAL
          );
          
          if (!workerResult || !workerResult.success) {
            throw new Error(`Worker thread error: ${workerResult?.error || 'Unknown error'}`);
          }
          
          analyzed = workerResult.analyzed;
          searchResults = workerResult.searchResults;
          
          // Log worker performance stats
          if (workerResult.stats) {
            logger.debug({
              domain,
              processingTime: workerResult.processingTime,
              memoryUsage: workerResult.stats.memoryUsageAnalysis ? 
                `${Math.round(workerResult.stats.memoryUsageAnalysis.heapUsed / (1024 * 1024))}MB` : 'unknown'
            }, 'Worker performance stats');
          }
        } catch (workerErr) {
          logger.error({ 
            domain, 
            error: workerErr.message,
            stack: workerErr.stack
          }, 'Worker processing error');
          
          // Fallback to synchronous processing if worker fails
          logger.debug({ domain }, 'Falling back to synchronous processing after worker error');
          
          try {
            const lines = content.split(/\r\n|\n|\r/);
            analyzed = analyzeAppAdsTxt(lines);
            
            if (normalizedSearchTerms?.length > 0) {
              searchResults = processSearchTerms(lines, normalizedSearchTerms);
            }
          } catch (fallbackErr) {
            logger.error({
              domain,
              error: fallbackErr.message,
              stack: fallbackErr.stack
            }, 'Fallback processing error');
            
            // Return minimal analysis if even fallback fails
            analyzed = {
              totalLines: content.split(/\r\n|\n|\r/).length,
              validLines: 0,
              commentLines: 0,
              emptyLines: 0,
              invalidLines: 0,
              uniquePublishers: 0,
              relationships: { direct: 0, reseller: 0, other: 0 },
              error: 'Analysis error'
            };
          }
        }
      } else if (processingMethod === 'sync') {
        // Process smaller files synchronously
        try {
          const lines = content.split(/\r\n|\n|\r/);
          
          // Analyze the file content
          analyzed = analyzeAppAdsTxt(lines);
          
          // Process search terms if provided
          if (normalizedSearchTerms?.length > 0) {
            searchResults = processSearchTerms(lines, normalizedSearchTerms);
          }
        } catch (syncErr) {
          logger.error({
            domain,
            error: syncErr.message,
            stack: syncErr.stack
          }, 'Synchronous processing error');
          
          // Return minimal analysis if processing fails
          analyzed = {
            totalLines: content.split(/\r\n|\n|\r/).length,
            validLines: 0,
            commentLines: 0,
            emptyLines: 0,
            invalidLines: 0,
            uniquePublishers: 0,
            relationships: { direct: 0, reseller: 0, other: 0 },
            error: 'Analysis error'
          };
        }
      }
    }
    
    // Trim content if it's too large for caching
    const contentSizeLimit = 500000; // 500KB limit for caching
    const trimmedContent = content && content.length > contentSizeLimit
      ? content.substring(0, contentSizeLimit) + '\n... (truncated, file too large)' 
      : (content || '(Streamed content, not stored in full)');
    
    const result = {
      exists: true,
      url: `${usedProtocol}://${domain}/app-ads.txt`,
      content: trimmedContent,
      contentLength: fileSize || (content ? content.length : 0),
      analyzed,
      searchResults,
      processingMethod,
      processingTime: Date.now() - startTime
    };
    
    // Log performance metrics
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
    const processingTime = Date.now() - startTime;
    
    logger.error({ 
      domain, 
      error: err.message,
      stack: err.stack,
      fileSize,
      processingMethod,
      processingTime: `${processingTime}ms`
    }, 'Error checking app-ads.txt');
    
    const result = { 
      exists: false, 
      error: 'Internal error processing app-ads.txt',
      errorDetails: err.message,
      processingTime
    };
    
    await cache.set(keys.appAdsTxt(domain, searchTerms), result, 'appAdsTxtError');
    return result;
  }
}

/**
 * Process content from a stream in a memory-efficient way
 * @param {Stream} stream - The readable stream
 * @param {string[]} searchTerms - Search terms (optional)
 * @returns {Promise<object>} - Processing results
 */
async function processStreamedContent(stream, searchTerms = null) {
  return new Promise((resolve, reject) => {
    // Initialize analysis counters
    let validLineCount = 0;
    let commentLineCount = 0;
    let emptyLineCount = 0;
    let invalidLineCount = 0;
    let totalLineCount = 0;
    
    // Store for publishers and other stats
    const publishers = new Set();
    const relationships = {
      direct: 0,
      reseller: 0,
      other: 0
    };
    
    // Search results tracking
    let searchMatchingLines = [];
    let searchTermResults = [];
    
    // Initialize search term tracking if needed
    if (searchTerms && searchTerms.length > 0) {
      searchTermResults = searchTerms.map(term => ({
        term,
        matchingLines: [],
        count: 0
      }));
    }
    
    // Store a sample of the content for reference
    let contentSample = '';
    const MAX_SAMPLE_SIZE = 100000; // 100KB sample
    
    // Create line parsing function
    const processLine = (line) => {
      totalLineCount++;
      
      // Add to content sample if it's not too big yet
      if (contentSample.length < MAX_SAMPLE_SIZE) {
        contentSample += line + '\n';
      }
      
      try {
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
          
          // Extract publisher (safely)
          try {
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
          } catch (fieldErr) {
            // Don't let field processing errors stop the whole analysis
            invalidLineCount++;
          }
        } else {
          invalidLineCount++;
        }
        
        // Process search terms if provided
        if (searchTerms && searchTerms.length > 0) {
          let anyMatch = false;
          
          // Check each search term
          searchTerms.forEach((term, termIndex) => {
            try {
              if (cleanLine.toLowerCase().includes(term.toLowerCase())) {
                // Add to term-specific results (limit to 500 matches per term)
                if (searchTermResults[termIndex].matchingLines.length < 500) {
                  searchTermResults[termIndex].matchingLines.push({
                    lineNumber: totalLineCount,
                    content: cleanLine,
                    termIndex
                  });
                }
                searchTermResults[termIndex].count++;
                anyMatch = true;
              }
            } catch (err) {
              // Ignore search errors and continue
            }
          });
          
          // If any term matched, add to overall results
          if (anyMatch && searchMatchingLines.length < 1000) {
            searchMatchingLines.push({
              lineNumber: totalLineCount,
              content: cleanLine
            });
          }
        }
      } catch (lineErr) {
        // Ignore line processing errors
        invalidLineCount++;
      }
    };
    
    // Set up line reader
    let buffer = '';
    let bytesRead = 0;
    
    // Handle stream data chunks
    stream.on('data', (chunk) => {
      try {
        bytesRead += chunk.length;
        
        // Convert Buffer to string and add to buffer
        const data = chunk.toString('utf8');
        buffer += data;
        
        // Process complete lines
        let lineEndIndex = buffer.indexOf('\n');
        while (lineEndIndex !== -1) {
          const line = buffer.substring(0, lineEndIndex);
          processLine(line);
          
          // Move buffer forward
          buffer = buffer.substring(lineEndIndex + 1);
          lineEndIndex = buffer.indexOf('\n');
        }
      } catch (chunkErr) {
        // Log error but continue processing
        logger.error({ error: chunkErr.message }, 'Error processing stream chunk');
      }
    });
    
    // Handle end of stream
    stream.on('end', () => {
      try {
        // Process any remaining data in the buffer
        if (buffer.length > 0) {
          processLine(buffer);
        }
        
        // Create analysis result
        const analyzed = {
          totalLines: totalLineCount,
          validLines: validLineCount,
          commentLines: commentLineCount,
          emptyLines: emptyLineCount,
          invalidLines: invalidLineCount,
          uniquePublishers: publishers.size,
          relationships
        };
        
        // Create search results if needed
        let searchResults = null;
        if (searchTerms && searchTerms.length > 0) {
          searchResults = {
            terms: searchTerms,
            termResults: searchTermResults,
            matchingLines: searchMatchingLines,
            count: searchMatchingLines.length
          };
        }
        
        // Resolve with results
        resolve({
          content: contentSample,
          analyzed,
          searchResults
        });
      } catch (err) {
        reject(err);
      }
    });
    
    // Handle stream errors
    stream.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Process search terms against lines of content
 * @param {string[]} lines - Lines of content
 * @param {Array} searchTerms - Search terms (string or objects with exactMatch property)
 * @returns {object} - Search results
 */
function processSearchTerms(lines, searchTerms) {
  try {
    const searchResults = {
      terms: searchTerms,
      termResults: searchTerms.map(term => ({
        term: typeof term === 'object' ? term.exactMatch : term,
        matchingLines: [],
        count: 0
      })),
      matchingLines: [],
      count: 0
    };
    
    // Group search terms by structuredParams for advanced search
    let searchGroups = [];
    let isStructuredSearch = false;
    
    // Check if searchTerms contains structured parameters
    if (searchTerms.length > 0 && typeof searchTerms[0] === 'object') {
      // If any term has both domain and publisherId, it's using the advanced search format
      const hasAdvancedParams = searchTerms.some(term => 
        term.domain && term.publisherId && 
        typeof term.domain === 'string' && 
        typeof term.publisherId === 'string');
      
      if (hasAdvancedParams) {
        isStructuredSearch = true;
        
        // For advanced search, each object is its own group (AND relationship within group)
        searchGroups = searchTerms.map(term => {
          const groupTerms = [];
          if (term.domain) groupTerms.push({ exactMatch: term.domain.toLowerCase() });
          if (term.publisherId) groupTerms.push({ exactMatch: term.publisherId.toLowerCase() });
          if (term.relationship) groupTerms.push({ exactMatch: term.relationship.toLowerCase() });
          if (term.tagId) groupTerms.push({ exactMatch: term.tagId.toLowerCase() });
          return groupTerms;
        });
        
        // Filter out any empty groups
        searchGroups = searchGroups.filter(group => group.length > 0);
        
        logger.debug({ 
          searchGroups,
          isStructuredSearch 
        }, 'Using structured search with groups');
      }
    }
    
    // If not using structured search, check if we need to process input terms
    if (!isStructuredSearch) {
      // In simple search mode, if we have multiple search terms, we have two possibilities:
      // 1. Each search term represents a separate search group (OR logic between them)
      // 2. All search terms belong to the same group (AND logic between them)
      
      // For this implementation, we'll group all terms together for AND logic
      // This matches the expectation that searching for "appnexus.com 12447" finds lines with both terms
      searchGroups = [searchTerms];
      
      logger.debug({
        searchGroups: searchGroups.map(group => group.map(term => 
          typeof term === 'object' ? term.exactMatch : term
        )),
        termCount: searchTerms.length
      }, 'Using simple search with AND logic between terms');
    }
    
    // Pre-compile regexes or prepare exact match terms for performance
    const compileSearchMatcher = term => {
      if (typeof term === 'object' && term.exactMatch) {
        // If it's an exact match object, prepare the exact match string
        return {
          type: 'exact',
          value: term.exactMatch.toLowerCase(),
          originalTerm: term
        };
      } else {
        // Otherwise create a regex for backward compatibility
        const termStr = typeof term === 'string' ? term : String(term);
        return {
          type: 'regex',
          value: new RegExp(termStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
          originalTerm: term
        };
      }
    };
    
    // Compile matchers for each term in each group
    const searchGroupMatchers = searchGroups.map(group => 
      group.map(term => compileSearchMatcher(term))
    );
    
    // Process in batches to reduce memory pressure
    const BATCH_SIZE = 2000;
    const totalBatches = Math.ceil(lines.length / BATCH_SIZE);
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * BATCH_SIZE;
      const batchEnd = Math.min((batchIndex + 1) * BATCH_SIZE, lines.length);
      
      // Process each line in the batch
      for (let i = batchStart; i < batchEnd; i++) {
        // Process each line
        const lineContent = lines[i]?.trim();
        if (!lineContent) continue;
        
        const lineNumber = i + 1;
        const lineLower = lineContent.toLowerCase();
        
        // Track if the line matches any of the search groups
        let anyGroupMatch = false;
        
        // Check each search group
        searchGroupMatchers.forEach((group, groupIndex) => {
          // For each group, ALL terms in the group must match (AND logic)
          let allGroupTermsMatch = group.length > 0;
          
          group.forEach(matcher => {
            let isMatch = false;
            
            if (matcher.type === 'exact') {
              // For exact match terms, check if the exact string appears in the line
              isMatch = lineLower.includes(matcher.value);
            } else {
              // For regex terms, use the regex test method
              isMatch = matcher.value.test(lineContent);
            }
            
            // If any term in the group doesn't match, the whole group doesn't match
            if (!isMatch) {
              allGroupTermsMatch = false;
            }
            
            // Record individual term matches for per-term results
            // Find the original term index in the flat searchTerms array
            const termIndex = searchTerms.findIndex(term => {
              if (typeof term === 'object' && typeof matcher.originalTerm === 'object') {
                return term.exactMatch === matcher.originalTerm.exactMatch;
              }
              return term === matcher.originalTerm;
            });
            
            if (isMatch && termIndex !== -1 && searchResults.termResults[termIndex]) {
              searchResults.termResults[termIndex].matchingLines.push({
                lineNumber,
                content: lineContent,
                termIndex
              });
              searchResults.termResults[termIndex].count++;
            }
          });
          
          // If all terms in this group matched, it's a match for the group
          if (allGroupTermsMatch) {
            anyGroupMatch = true;
          }
        });
        
        // If any group matched entirely, add to overall results
        if (anyGroupMatch) {
          searchResults.matchingLines.push({
            lineNumber,
            content: lineContent
          });
        }
      }
    }
    
    // Limit matching lines for very large results
    const MAX_MATCHING_LINES = 1000;
    if (searchResults.matchingLines.length > MAX_MATCHING_LINES) {
      searchResults.matchingLines = searchResults.matchingLines.slice(0, MAX_MATCHING_LINES);
      searchResults.truncated = true;
      searchResults.originalCount = searchResults.matchingLines.length;
      
      // Also truncate per-term results
      searchResults.termResults.forEach(result => {
        if (result.matchingLines.length > MAX_MATCHING_LINES) {
          result.originalCount = result.matchingLines.length;
          result.matchingLines = result.matchingLines.slice(0, MAX_MATCHING_LINES);
          result.truncated = true;
        }
      });
    }
    
    // Update counts
    searchResults.count = searchResults.originalCount || searchResults.matchingLines.length;
    
    return searchResults;
  } catch (err) {
    logger.error({ 
      error: err.message,
      stack: err.stack,
      searchTerms,
      lineCount: lines?.length
    }, 'Error processing search terms');
    
    // Return empty results on error
    return {
      terms: searchTerms,
      termResults: searchTerms.map(term => ({ term, matchingLines: [], count: 0 })),
      matchingLines: [],
      count: 0,
      error: 'Error processing search terms'
    };
  }
}

/**
 * Analyze app-ads.txt content
 * @param {string[]} lines - Lines of content
 * @returns {object} - Analysis results
 */
function analyzeAppAdsTxt(lines) {
  try {
    // Use memory-efficient processing in batches
    const BATCH_SIZE = 2000;
    let validLineCount = 0;
    let commentLineCount = 0;
    let emptyLineCount = 0;
    let invalidLineCount = 0;
    
    // Use Set for memory efficiency
    const publishers = new Set();
    const relationships = {
      direct: 0,
      reseller: 0,
      other: 0
    };
    
    // Track errors during processing
    const processingErrors = [];
    
    // Process in batches
    const totalBatches = Math.ceil(lines.length / BATCH_SIZE);
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * BATCH_SIZE;
      const batchEnd = Math.min((batchIndex + 1) * BATCH_SIZE, lines.length);
      
      for (let i = batchStart; i < batchEnd; i++) {
        const line = lines[i];
        
        try {
          // Skip empty lines
          if (!line || typeof line !== 'string' || !line.trim()) {
            emptyLineCount++;
            continue;
          }
          
          // Handle comments
          const commentIndex = line.indexOf('#');
          if (commentIndex === 0) {
            commentLineCount++;
            continue;
          }
          
          const cleanLine = commentIndex >= 0 ? line.substring(0, commentIndex).trim() : line.trim();
          if (!cleanLine) {
            emptyLineCount++;
            continue;
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
            
            // Only track first few errors to avoid excessive logging
            if (processingErrors.length < 5) {
              processingErrors.push({
                line: i + 1,
                content: line.length > 100 ? line.substring(0, 100) + '...' : line,
                error: 'Invalid line format (requires at least 3 comma-separated fields)'
              });
            }
          }
        } catch (lineErr) {
          invalidLineCount++;
          
          // Only track first few errors
          if (processingErrors.length < 5) {
            processingErrors.push({
              line: i + 1,
              error: lineErr.message
            });
          }
        }
      }
    }
    
    // Log any processing errors
    if (processingErrors.length > 0) {
      logger.debug({ processingErrors }, 'Errors during app-ads.txt analysis');
    }
    
    return {
      totalLines: lines.length,
      validLines: validLineCount,
      commentLines: commentLineCount,
      emptyLines: emptyLineCount,
      invalidLines: invalidLineCount,
      uniquePublishers: publishers.size,
      relationships,
      processingErrors: processingErrors.length > 0 ? processingErrors : undefined
    };
  } catch (err) {
    logger.error({ 
      error: err.message,
      stack: err.stack,
      lineCount: lines?.length
    }, 'Error analyzing app-ads.txt');
    
    // Return minimal analysis on error
    return {
      totalLines: lines?.length || 0,
      validLines: 0,
      commentLines: 0,
      emptyLines: 0,
      invalidLines: 0,
      uniquePublishers: 0,
      relationships: { direct: 0, reseller: 0, other: 0 },
      error: 'Analysis error: ' + err.message
    };
  }
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
  processStreamedContent,
  shutdown
};