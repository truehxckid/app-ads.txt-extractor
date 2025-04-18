/**
 * App-Ads.txt Parser Worker Thread with enhanced debugging and reliability
 * Used for processing large app-ads.txt files in a separate thread
 */

'use strict';

const { parentPort, workerData, threadId } = require('worker_threads');

// Flag to track if we've sent a final result
let resultSent = false;

// Send initial startup message
try {
  parentPort.postMessage({
    debug: true,
    message: 'Worker starting',
    threadId,
    timestamp: Date.now(),
    success: true
  });
} catch (err) {
  // Can't do anything if we can't communicate with the parent
  process.exit(2);
}

// Set up message handler for parent communication
parentPort.on('message', (message) => {
  if (message && message.type === 'health_check') {
    safeSendToParent({
      debug: true,
      message: 'Health check response',
      threadId,
      timestamp: Date.now(),
      success: true
    });
  }
});

// Setup basic process-wide exception handlers
process.on('uncaughtException', (err) => {
  try {
    parentPort.postMessage({
      error: `Uncaught exception in worker: ${err.message}`,
      errorDetails: {
        type: 'uncaughtException',
        error: err.message,
        stack: err.stack,
        memoryUsage: process.memoryUsage()
      },
      success: false
    });
    console.error('Worker uncaught exception:', err);
  } catch (postError) {
    console.error('Critical worker error (failed to report):', err);
  }
  
  // Allow some time for the message to be sent before exiting
  setTimeout(() => {
    process.exit(1);
  }, 200);
});

process.on('unhandledRejection', (reason, promise) => {
  try {
    parentPort.postMessage({
      error: `Unhandled promise rejection in worker: ${reason instanceof Error ? reason.message : String(reason)}`,
      errorDetails: {
        type: 'unhandledRejection',
        error: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : 'No stack trace available',
        memoryUsage: process.memoryUsage()
      },
      success: false
    });
    console.error('Worker unhandled rejection:', reason);
  } catch (postError) {
    console.error('Critical worker error (unhandled rejection, failed to report):', reason);
  }
  
  // Allow some time for the message to be sent before exiting
  setTimeout(() => {
    process.exit(1);
  }, 200);
});

/**
 * Safely send message to parent
 * @param {object} message - Message to send
 * @returns {boolean} - Whether the message was sent successfully
 */
function safeSendToParent(message) {
  try {
    if (!parentPort) {
      console.error('No parent port available to send message');
      return false;
    }
    
    parentPort.postMessage(message);
    return true;
  } catch (err) {
    console.error('Failed to send message to parent:', err);
    return false;
  }
}

/**
 * Process search terms against lines of content
 * @param {string[]} lines - Lines of content
 * @param {string[]} searchTerms - Search terms
 * @returns {object} - Search results
 */
function processSearchTerms(lines, searchTerms) {
  try {
    // Initial debug message
    safeSendToParent({
      debug: true,
      message: 'Starting search term processing',
      lineCount: lines.length,
      searchTermCount: searchTerms.length,
      timestamp: Date.now(),
      success: true
    });
    
    // Initialize results object with safer defaults
    const searchResults = {
      terms: searchTerms || [],
      termResults: Array.isArray(searchTerms) ? searchTerms.map(term => ({
        term,
        matchingLines: [],
        count: 0
      })) : [],
      matchingLines: [],
      count: 0
    };
    
    // Validate inputs more carefully
    if (!Array.isArray(lines)) {
      throw new Error('Lines must be an array');
    }
    
    if (!Array.isArray(searchTerms) || searchTerms.length === 0) {
      return searchResults; // Return empty results for no search terms
    }
    
    // Process in smaller batches to allow for progress reporting
    const BATCH_SIZE = 5000;
    const totalBatches = Math.ceil(lines.length / BATCH_SIZE);
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      // Report progress for large files
      if (lines.length > 10000 && batchIndex % 5 === 0) {
        safeSendToParent({
          debug: true,
          progress: `Processing search terms: ${Math.min(((batchIndex + 1) / totalBatches) * 100, 100).toFixed(1)}%`,
          batch: batchIndex + 1,
          totalBatches,
          matchesFound: searchResults.matchingLines.length,
          timestamp: Date.now(),
          success: true
        });
      }
      
      const batchStart = batchIndex * BATCH_SIZE;
      const batchEnd = Math.min((batchIndex + 1) * BATCH_SIZE, lines.length);
      
      // Process each line in the batch
      for (let i = batchStart; i < batchEnd; i++) {
        // Safeguard against invalid lines
        if (!lines[i] || typeof lines[i] !== 'string') continue;
        
        const lineContent = lines[i].trim();
        if (!lineContent) continue;
        
        const lineNumber = i + 1;
        let anyMatch = false;
        
        // Check each search term
        for (let termIndex = 0; termIndex < searchTerms.length; termIndex++) {
          const term = searchTerms[termIndex];
          
          // Skip invalid terms
          if (!term || typeof term !== 'string') continue;
          
          try {
            // Try case-insensitive match
            if (lineContent.toLowerCase().includes(term.toLowerCase())) {
              // Add to term-specific results
              if (searchResults.termResults[termIndex]) {
                searchResults.termResults[termIndex].matchingLines.push({
                  lineNumber,
                  content: lineContent,
                  termIndex
                });
              }
              
              anyMatch = true;
            }
          } catch (err) {
            // Report error but continue processing
            safeSendToParent({
              warning: `Error matching search term: ${err.message}`,
              lineError: {
                lineIndex: i,
                line: lineContent ? lineContent.substring(0, 100) : 'invalid line',
                term,
                termIndex,
                error: err.message
              },
              success: true
            });
          }
        }
        
        // If any term matched, add to overall results
        if (anyMatch) {
          searchResults.matchingLines.push({
            lineNumber,
            content: lineContent
          });
        }
      }
    }
    
    // Report completion
    safeSendToParent({
      debug: true,
      message: 'Completed search term processing',
      matchesFound: searchResults.matchingLines.length,
      timestamp: Date.now(),
      success: true
    });
    
    // Prevent excessive memory usage for large results
    const MAX_MATCHES = 1000;
    if (searchResults.matchingLines.length > MAX_MATCHES) {
      searchResults.matchingLinesFull = false;
      searchResults.totalMatchingLines = searchResults.matchingLines.length;
      searchResults.matchingLines = searchResults.matchingLines.slice(0, MAX_MATCHES);
    }
    
    // Update counts for each term
    searchResults.termResults.forEach(result => {
      if (result && Array.isArray(result.matchingLines)) {
        result.count = result.matchingLines.length;
        
        // Truncate excessive matches per term
        if (result.matchingLines.length > MAX_MATCHES) {
          result.matchingLinesFull = false;
          result.totalMatchingLines = result.matchingLines.length;
          result.matchingLines = result.matchingLines.slice(0, MAX_MATCHES);
        }
      }
    });
    
    // Set total match count
    searchResults.count = searchResults.matchingLines.length;
    
    return searchResults;
  } catch (err) {
    // Report error to parent
    safeSendToParent({
      error: `Search term processing error: ${err.message}`,
      errorDetails: {
        function: 'processSearchTerms',
        error: err.message,
        stack: err.stack
      },
      success: false
    });
    
    // Re-throw to caller for proper handling
    throw err;
  }
}

/**
 * Analyze app-ads.txt content
 * @param {string[]} lines - Lines of content
 * @returns {object} - Analysis results
 */
function analyzeAppAdsTxt(lines) {
  try {
    // Initial debug message
    safeSendToParent({
      debug: true,
      message: 'Starting app-ads.txt analysis',
      lineCount: lines.length,
      timestamp: Date.now(),
      success: true
    });
    
    // Validate input
    if (!Array.isArray(lines)) {
      throw new Error('Lines must be an array');
    }
    
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
    
    // Process in smaller batches to allow for progress reporting
    const BATCH_SIZE = 5000;
    const totalBatches = Math.ceil(lines.length / BATCH_SIZE);
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      // Report progress for large files
      if (lines.length > 10000 && batchIndex % 5 === 0) {
        safeSendToParent({
          debug: true,
          progress: `Analyzing app-ads.txt: ${Math.min(((batchIndex + 1) / totalBatches) * 100, 100).toFixed(1)}%`,
          batch: batchIndex + 1,
          totalBatches,
          validLinesFound: validLineCount,
          timestamp: Date.now(),
          success: true
        });
      }
      
      const batchStart = batchIndex * BATCH_SIZE;
      const batchEnd = Math.min((batchIndex + 1) * BATCH_SIZE, lines.length);
      
      // Process each line in the batch
      for (let i = batchStart; i < batchEnd; i++) {
        const line = lines[i];
        
        try {
          // Skip invalid lines
          if (!line || typeof line !== 'string') {
            invalidLineCount++;
            continue;
          }
          
          // Skip empty lines
          if (!line.trim()) {
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
        } catch (lineErr) {
          // Report line processing error but continue
          invalidLineCount++;
          
          if (i % 1000 === 0) { // Limit reporting to avoid flooding
            safeSendToParent({
              warning: `Error processing line ${i + 1}: ${lineErr.message}`,
              lineError: {
                lineIndex: i,
                error: lineErr.message
              },
              success: true
            });
          }
        }
      }
    }
    
    // Report completion
    safeSendToParent({
      debug: true,
      message: 'Completed app-ads.txt analysis',
      validLines: validLineCount,
      uniquePublishers: publishers.size,
      timestamp: Date.now(),
      success: true
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
  } catch (err) {
    // Report error to parent
    safeSendToParent({
      error: `App-ads.txt analysis error: ${err.message}`,
      errorDetails: {
        function: 'analyzeAppAdsTxt',
        error: err.message,
        stack: err.stack
      },
      success: false
    });
    
    // Re-throw to caller for proper handling
    throw err;
  }
}

/**
 * Worker thread main function
 */
function processAppAdsContent() {
  try {
    // Check if workerData exists and has the required properties
    if (!workerData) {
      throw new Error('No worker data provided');
    }
    
    // Log worker data properties for debugging
    safeSendToParent({
      debug: true,
      message: 'Worker data received',
      hasContent: !!workerData.content,
      contentLength: workerData.content ? workerData.content.length : 0,
      hasSearchTerms: !!workerData.searchTerms,
      searchTermCount: workerData.searchTerms ? workerData.searchTerms.length : 0,
      threadId,
      timestamp: Date.now(),
      success: true
    });
    
    const { content, searchTerms } = workerData;
    
    if (!content || typeof content !== 'string') {
      throw new Error('Invalid or missing content in worker data');
    }
    
    // Log memory usage before processing
    const initialMemory = process.memoryUsage();
    safeSendToParent({
      debug: true,
      message: 'Initial memory usage',
      memoryUsage: {
        rss: `${Math.round(initialMemory.rss / (1024 * 1024))}MB`,
        heapTotal: `${Math.round(initialMemory.heapTotal / (1024 * 1024))}MB`,
        heapUsed: `${Math.round(initialMemory.heapUsed / (1024 * 1024))}MB`,
        external: `${Math.round(initialMemory.external / (1024 * 1024))}MB`
      },
      contentLength: content.length,
      timestamp: Date.now(),
      success: true
    });
    
    // Split content into lines
    let lines;
    try {
      lines = content.split(/\r\n|\n|\r/);
      
      safeSendToParent({
        debug: true,
        message: 'Content split into lines',
        lineCount: lines.length,
        timestamp: Date.now(),
        success: true
      });
    } catch (splitErr) {
      throw new Error(`Failed to split content into lines: ${splitErr.message}`);
    }
    
    // Log memory usage after splitting
    const afterSplitMemory = process.memoryUsage();
    safeSendToParent({
      debug: true,
      message: 'Memory usage after splitting',
      memoryUsage: {
        rss: `${Math.round(afterSplitMemory.rss / (1024 * 1024))}MB`,
        heapTotal: `${Math.round(afterSplitMemory.heapTotal / (1024 * 1024))}MB`,
        heapUsed: `${Math.round(afterSplitMemory.heapUsed / (1024 * 1024))}MB`,
        external: `${Math.round(afterSplitMemory.external / (1024 * 1024))}MB`
      },
      timestamp: Date.now(),
      success: true
    });
    
    // Analyze the content - with careful error handling
    let analyzed;
    try {
      analyzed = analyzeAppAdsTxt(lines);
    } catch (analyzeErr) {
      safeSendToParent({
        error: `Failed to analyze content: ${analyzeErr.message}`,
        errorDetails: {
          function: 'analyzeAppAdsTxt',
          error: analyzeErr.message,
          stack: analyzeErr.stack
        },
        success: false
      });
      
      // Provide a minimal analysis result to allow the process to continue
      analyzed = {
        totalLines: lines.length,
        validLines: 0,
        commentLines: 0,
        emptyLines: 0,
        invalidLines: lines.length,
        uniquePublishers: 0,
        relationships: { direct: 0, reseller: 0, other: 0 },
        error: 'Analysis error'
      };
    }
    
    // Log memory usage after analysis
    const afterAnalysisMemory = process.memoryUsage();
    safeSendToParent({
      debug: true,
      message: 'Memory usage after analysis',
      memoryUsage: {
        rss: `${Math.round(afterAnalysisMemory.rss / (1024 * 1024))}MB`,
        heapTotal: `${Math.round(afterAnalysisMemory.heapTotal / (1024 * 1024))}MB`,
        heapUsed: `${Math.round(afterAnalysisMemory.heapUsed / (1024 * 1024))}MB`,
        external: `${Math.round(afterAnalysisMemory.external / (1024 * 1024))}MB`
      },
      timestamp: Date.now(),
      success: true
    });
    
    // Process search terms if provided - with careful error handling
    let searchResults = null;
    if (searchTerms && Array.isArray(searchTerms) && searchTerms.length > 0) {
      try {
        searchResults = processSearchTerms(lines, searchTerms);
      } catch (searchErr) {
        safeSendToParent({
          error: `Failed to process search terms: ${searchErr.message}`,
          errorDetails: {
            function: 'processSearchTerms',
            error: searchErr.message,
            stack: searchErr.stack
          },
          success: false
        });
        
        // Provide empty search results to allow the process to continue
        searchResults = {
          terms: searchTerms,
          termResults: searchTerms.map(term => ({ term, matchingLines: [], count: 0 })),
          matchingLines: [],
          count: 0,
          error: 'Search processing error'
        };
      }
    }
    
    // Final memory usage
    const finalMemory = process.memoryUsage();
    const memStats = {
      rss: Math.round(finalMemory.rss / (1024 * 1024)),
      heapTotal: Math.round(finalMemory.heapTotal / (1024 * 1024)),
      heapUsed: Math.round(finalMemory.heapUsed / (1024 * 1024)),
      external: Math.round(finalMemory.external / (1024 * 1024))
    };
    
    // Create the final result object
    const finalResult = {
      analyzed,
      searchResults,
      contentLength: content.length,
      lineCount: lines.length,
      stats: {
        memoryUsageAnalysis: finalMemory,
        memoryUsageFormatted: memStats
      },
      success: true,
      processingTime: Date.now() - (workerData.startTime || Date.now())
    };
    
    // Send final result - with tracking to ensure it's sent
    resultSent = safeSendToParent(finalResult);
    
    // Wait a bit before exiting to ensure message is sent
    // This is a key fix to ensure message delivery before exit
    setTimeout(() => {
      process.exit(0); // Exit with success code
    }, 300);
    
  } catch (error) {
    // Send error to parent thread
    resultSent = safeSendToParent({
      error: `Worker error: ${error.message}`,
      errorDetails: {
        error: error.message,
        stack: error.stack,
        memoryUsage: process.memoryUsage()
      },
      success: false
    });
    
    // Use setTimeout to ensure the message is sent before exiting
    setTimeout(() => {
      process.exit(1);
    }, 300);
  }
}

// Start processing when the worker is created
try {
  // Add a startTime for performance tracking
  if (workerData) {
    workerData.startTime = Date.now();
  }
  
  // Run the main worker function
  processAppAdsContent();
} catch (startupError) {
  // Try to report the error
  safeSendToParent({
    error: `Fatal worker startup error: ${startupError.message}`,
    errorDetails: {
      error: startupError.message,
      stack: startupError.stack
    },
    success: false
  });
  
  // Use setTimeout to ensure the message is sent before exiting
  setTimeout(() => {
    process.exit(1);
  }, 300);
}

// Add a safety timeout to ensure worker doesn't run forever
const MAX_EXECUTION_TIME = 5 * 60 * 1000; // 5 minutes
setTimeout(() => {
  if (!resultSent) {
    safeSendToParent({
      error: 'Worker timeout: maximum execution time exceeded',
      success: false
    });
    
    setTimeout(() => {
      process.exit(1);
    }, 300);
  }
}, MAX_EXECUTION_TIME);