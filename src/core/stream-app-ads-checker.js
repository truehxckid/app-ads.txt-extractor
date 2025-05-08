/**
 * Streaming App-Ads.txt Checker for App-Ads.txt Extractor
 * Provides streaming functionality for processing app-ads.txt files
 */

'use strict';

const axios = require('axios');
const { Readable } = require('stream');
const zlib = require('zlib');
const { validateSearchTerms, isValidDomain } = require('../utils/validation');
const rateLimiter = require('../services/rate-limiter');
const { getLogger } = require('../utils/logger');
const config = require('../config');

const logger = getLogger('stream-app-ads-checker');

/**
 * Stream app-ads.txt content and process it incrementally
 * @param {string} domain - Domain to check
 * @param {string[]|null} searchTerms - Search terms to look for
 * @param {object} responseStream - Express response object for streaming (optional)
 * @returns {Promise<object>} - Results of the check
 */
async function streamAppAdsTxt(domain, searchTerms = null, responseStream = null) {
  const startTime = Date.now();
  
  if (!domain) {
    return { exists: false };
  }
  
  // Validate domain format to avoid potential security issues
  if (!isValidDomain(domain)) {
    logger.warn({ domain }, 'Invalid domain format, skipping app-ads.txt check');
    return { exists: false, error: 'Invalid domain format' };
  }
  
  try {
    const validatedTerms = validateSearchTerms(searchTerms);
    const protocols = ['https', 'http'];
    
    // Try each protocol
    for (const protocol of protocols) {
      try {
        // Apply rate limiting to avoid overloading servers
        await rateLimiter.limit('app-ads-txt');
        
        const url = `${protocol}://${domain}/app-ads.txt`;
        logger.debug({ url }, 'Streaming app-ads.txt');
        
        // First make a HEAD request to check if the file exists and get its size
        try {
          const headResponse = await axios.head(url, {
            timeout: 10000,
            validateStatus: status => status === 200
          });
          
          // Get content type and encoding
          const contentType = headResponse.headers['content-type'] || '';
          const contentEncoding = headResponse.headers['content-encoding'] || '';
          const contentLength = parseInt(headResponse.headers['content-length'], 10);
          
          // Check if content is too large
          const maxSize = config.http.maxResponseSize || (20 * 1024 * 1024); // Default 20MB max
          if (!isNaN(contentLength) && contentLength > maxSize) {
            logger.warn({
              domain,
              contentLength,
              maxSize
            }, 'app-ads.txt file too large to process');
            
            return {
              exists: true,
              url,
              error: 'File too large to process',
              contentLength
            };
          }
          
          // If we have a response stream, start streaming metadata
          if (responseStream) {
            responseStream.write('"exists":true,');
            responseStream.write(`"url":"${url}",`);
            responseStream.write(`"contentType":"${contentType}",`);
            responseStream.write(`"contentLength":${contentLength || 'null'},`);
            responseStream.write('"analyzed":{');
          }
          
          // Stream the file content and process it
          return await processAppAdsStream(url, validatedTerms, responseStream);
        } catch (headErr) {
          logger.debug({
            protocol,
            domain,
            error: headErr.message
          }, 'HEAD request failed, trying GET instead');
          
          // If HEAD failed, try direct GET request
          return await processAppAdsStream(url, validatedTerms, responseStream);
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
        
        logger.debug(errorDetails, 'Failed to stream app-ads.txt');
        
        // Try next protocol
      }
    }
    
    // If we get here, all protocols failed
    if (responseStream) {
      responseStream.write('"exists":false,');
      responseStream.write('"error":"File not found for domain"');
    }
    
    return { exists: false, error: 'File not found for domain' };
  } catch (err) {
    logger.error({ 
      domain, 
      error: err.message 
    }, 'Error in streamAppAdsTxt');
    
    // If we have a response stream and haven't written to it yet
    if (responseStream && !responseStream.headersSent) {
      responseStream.write('"exists":false,');
      responseStream.write(`"error":"${err.message}"`);
    }
    
    return { exists: false, error: err.message };
  }
}

/**
 * Process app-ads.txt content as a stream
 * @param {string} url - URL to the app-ads.txt file
 * @param {string[]|null} searchTerms - Search terms to look for
 * @param {object} responseStream - Express response object for streaming (optional)
 * @returns {Promise<object>} - Analysis results
 */
async function processAppAdsStream(url, searchTerms = null, responseStream = null) {
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
        term: typeof term === 'object' ? term.exactMatch : term,
        matchingLines: [],
        count: 0
      }));
    }
    
    // Store a sample of the content for reference
    let contentSample = '';
    const MAX_SAMPLE_SIZE = 100000; // 100KB sample
    
    // Start the HTTP request
    axios.get(url, {
      responseType: 'stream',
      timeout: 30000,
      validateStatus: status => status === 200,
      // HTTP agent config
      httpAgent: config.http.httpAgent,
      httpsAgent: config.http.httpsAgent
    }).then(response => {
      let dataStream = response.data;
      
      // Handle gzip decompression if needed
      if (response.headers['content-encoding'] === 'gzip') {
        const gunzip = zlib.createGunzip();
        dataStream = dataStream.pipe(gunzip);
      }
      
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
                let termMatched = false;
                
                // Check if this is an exact match term from new UI
                if (typeof term === 'object' && term.exactMatch) {
                  const exactTerm = term.exactMatch.toLowerCase();
                  const lowerLine = cleanLine.toLowerCase();
                  
                  // For exact match terms, check if the exact string appears in the line
                  // This will match the term exactly as the user entered it
                  if (lowerLine.includes(exactTerm)) {
                    termMatched = true;
                  }
                }
                // Backward compatibility with string terms
                else if (typeof term === 'string') {
                  const termWords = term.toLowerCase().split(/[\s,;]+/);
                  const lineWords = cleanLine.toLowerCase().split(/[\s,;]+/);
                  
                  // For single word terms, check if the term is present in the line
                  if (termWords.length === 1) {
                    if (lineWords.includes(termWords[0])) {
                      termMatched = true;
                    }
                  }
                  // For multi-word terms, check if all words are present in the line
                  else if (termWords.every(word => cleanLine.toLowerCase().includes(word))) {
                    termMatched = true;
                  }
                }
                
                // If this term matched, track it
                if (termMatched) {
                  // Add to term-specific results (limit to 500 matches per term)
                  if (searchTermResults[termIndex].matchingLines.length < 500) {
                    searchTermResults[termIndex].matchingLines.push({
                      lineNumber: totalLineCount,
                      content: cleanLine,
                      termIndex
                    });
                  }
                  searchTermResults[termIndex].count++;
                  
                  // In simple search mode with multiple terms, we want OR logic 
                  // So if ANY term matches, it should be included in the results
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
        
        // Stream progress updates if we have a response stream
        if (responseStream && totalLineCount % 1000 === 0) {
          try {
            const progressUpdate = {
              totalLines: totalLineCount,
              validLines: validLineCount,
              publishers: publishers.size,
              matches: searchMatchingLines.length
            };
            
            responseStream.write(`"progress":${JSON.stringify(progressUpdate)},`);
            
            // Ensure data is sent immediately
            if (typeof responseStream.flush === 'function') {
              responseStream.flush();
            }
          } catch (updateErr) {
            logger.error({ error: updateErr.message }, 'Error sending progress update');
          }
        }
      };
      
      // Set up line reader
      let buffer = '';
      let bytesRead = 0;
      
      // Handle stream data chunks
      dataStream.on('data', (chunk) => {
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
      dataStream.on('end', () => {
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
          
          // Stream final results if we have a response stream
          if (responseStream) {
            // Complete the analyzed object
            responseStream.write(`"totalLines":${totalLineCount},`);
            responseStream.write(`"validLines":${validLineCount},`);
            responseStream.write(`"commentLines":${commentLineCount},`);
            responseStream.write(`"emptyLines":${emptyLineCount},`);
            responseStream.write(`"invalidLines":${invalidLineCount},`);
            responseStream.write(`"uniquePublishers":${publishers.size},`);
            
            // Add relationships
            responseStream.write('"relationships":{');
            responseStream.write(`"direct":${relationships.direct},`);
            responseStream.write(`"reseller":${relationships.reseller},`);
            responseStream.write(`"other":${relationships.other}`);
            responseStream.write('}'); // Close relationships
            
            responseStream.write('},'); // Close analyzed
            
            // Add content sample
            responseStream.write(`"contentSample":${JSON.stringify(contentSample)},`);
            
            // Add search results if available
            if (searchResults) {
              responseStream.write('"searchResults":{');
              responseStream.write(`"count":${searchResults.count},`);
              
              // Add terms
              responseStream.write(`"terms":${JSON.stringify(searchResults.terms)},`);
              
              // Stream term results (limited to save bandwidth)
              responseStream.write('"termResults":[');
              
              for (let i = 0; i < searchResults.termResults.length; i++) {
                const result = searchResults.termResults[i];
                
                if (i > 0) responseStream.write(',');
                
                responseStream.write('{');
                responseStream.write(`"term":${JSON.stringify(result.term)},`);
                responseStream.write(`"count":${result.count},`);
                
                // Limit number of matching lines sent
                const limitedLines = result.matchingLines.slice(0, 100);
                responseStream.write(`"matchingLines":${JSON.stringify(limitedLines)}`);
                
                responseStream.write('}');
              }
              
              responseStream.write('],'); // Close termResults
              
              // Stream overall matching lines (limited)
              const limitedMatchingLines = searchResults.matchingLines.slice(0, 200);
              responseStream.write(`"matchingLines":${JSON.stringify(limitedMatchingLines)}`);
              
              responseStream.write('}'); // Close searchResults
            }
          }
          
          // Create the final result object
          const result = {
            exists: true,
            url: url,
            content: contentSample,
            contentLength: bytesRead,
            analyzed,
            searchResults
          };
          
          // Report successful extraction to rate limiter
          rateLimiter.reportSuccess('app-ads-txt');
          
          resolve(result);
          
        } catch (err) {
          logger.error({ 
            error: err.message, 
            stack: err.stack
          }, 'Error completing app-ads.txt analysis');
          
          reject(err);
        }
      });
      
      // Handle stream errors
      dataStream.on('error', (err) => {
        reject(err);
      });
    }).catch(err => {
      reject(err);
    });
  });
}

module.exports = {
  streamAppAdsTxt,
  processAppAdsStream
};