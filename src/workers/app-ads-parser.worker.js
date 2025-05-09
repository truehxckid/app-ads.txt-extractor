/**
 * App-Ads.txt Parser Worker Thread with enhanced debugging and memory management
 * Used for processing large app-ads.txt files in a separate thread
 */

'use strict';

const { parentPort, workerData, threadId } = require('worker_threads');

// Flag to track if we've sent a final result
let resultSent = false;

// Memory thresholds for warnings (in MB)
const MEMORY_THRESHOLDS = {
  warning: 150,  // Warning level at 150 MB
  high: 250,     // High warning at 250 MB
  critical: 350  // Critical warning at 350 MB (near default 384 MB limit)
};

/**
 * Monitor memory usage and send warnings if thresholds are exceeded
 * @returns {object} Memory usage information
 */
function monitorMemory() {
  try {
    const memoryUsage = process.memoryUsage();
    
    // Convert to MB for readability
    const memoryUsageMB = {
      rss: Math.round(memoryUsage.rss / (1024 * 1024)),
      heapTotal: Math.round(memoryUsage.heapTotal / (1024 * 1024)),
      heapUsed: Math.round(memoryUsage.heapUsed / (1024 * 1024)),
      external: Math.round(memoryUsage.external / (1024 * 1024)),
      arrayBuffers: memoryUsage.arrayBuffers ? Math.round(memoryUsage.arrayBuffers / (1024 * 1024)) : 0
    };
    
    let warningLevel = null;
    
    // Determine warning level based on heap usage
    if (memoryUsageMB.heapUsed >= MEMORY_THRESHOLDS.critical) {
      warningLevel = 'critical';
    } else if (memoryUsageMB.heapUsed >= MEMORY_THRESHOLDS.high) {
      warningLevel = 'high';
    } else if (memoryUsageMB.heapUsed >= MEMORY_THRESHOLDS.warning) {
      warningLevel = 'warning';
    }
    
    // Send warning to parent if thresholds exceeded
    if (warningLevel) {
      safeSendToParent({
        memoryWarning: true,
        warningLevel,
        memoryUsage: memoryUsageMB,
        timestamp: Date.now()
      });
      
      // If critical, try to free up memory
      if (warningLevel === 'critical') {
        global.gc && global.gc();
      }
    }
    
    return memoryUsageMB;
  } catch (err) {
    // If memory monitoring fails, just return null
    return null;
  }
}

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
    const memoryUsage = monitorMemory();
    
    safeSendToParent({
      debug: true,
      message: 'Health check response',
      threadId,
      timestamp: Date.now(),
      memoryUsage,
      success: true
    });
  }
  
  if (message && message.type === 'terminate') {
    // Gracefully handle termination request
    safeSendToParent({
      debug: true,
      message: 'Termination requested',
      reason: message.reason || 'unknown',
      threadId,
      timestamp: Date.now(),
      success: true
    });
    
    // Exit cleanly when requested to terminate
    setTimeout(() => process.exit(0), 100);
  }
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
 * Process search terms against lines of content in memory-efficient chunks
 * @param {string[]} lines - Lines of content
 * @param {string[]} searchTerms - Search terms
 * @returns {object} - Search results
 */
function processSearchTermsInChunks(lines, searchTerms) {
  try {
    // Initial debug message
    safeSendToParent({
      debug: true,
      message: 'Starting chunked search term processing',
      lineCount: lines.length,
      searchTermCount: searchTerms ? searchTerms.length : 0,
      timestamp: Date.now(),
      success: true
    });
    
    // Validate inputs more carefully
    if (!Array.isArray(lines)) {
      throw new Error('Lines must be an array');
    }
    
    const validSearchTerms = Array.isArray(searchTerms) ? searchTerms : [];
    
    // Initialize results object with safer defaults
    const searchResults = {
      terms: validSearchTerms,
      termResults: validSearchTerms.map(term => ({
        term: typeof term === 'object' && term.exactMatch ? term.exactMatch : term,
        matchingLines: [],
        count: 0
      })),
      matchingLines: [],
      count: 0
    };
    
    if (validSearchTerms.length === 0) {
      return searchResults; // Return empty results for no search terms
    }
    
    // Group search terms by structuredParams for advanced search
    let searchGroups = [];
    let isStructuredSearch = false;
    
    // Check if searchTerms contains structured parameters
    if (validSearchTerms.length > 0 && typeof validSearchTerms[0] === 'object') {
      // If any term has both domain and publisherId, it's using the advanced search format
      const hasAdvancedParams = validSearchTerms.some(term => 
        term.domain && term.publisherId && 
        typeof term.domain === 'string' && 
        typeof term.publisherId === 'string');
      
      if (hasAdvancedParams) {
        isStructuredSearch = true;
        
        // For advanced search, each object is its own group (AND relationship within group)
        searchGroups = validSearchTerms.map(term => {
          const groupTerms = [];
          if (term.domain) groupTerms.push({ exactMatch: term.domain.toLowerCase() });
          if (term.publisherId) groupTerms.push({ exactMatch: term.publisherId.toLowerCase() });
          if (term.relationship) groupTerms.push({ exactMatch: term.relationship.toLowerCase() });
          if (term.tagId) groupTerms.push({ exactMatch: term.tagId.toLowerCase() });
          return groupTerms;
        });
        
        // Filter out any empty groups
        searchGroups = searchGroups.filter(group => group.length > 0);
        
        // Structured search enabled
      }
    }
    
    // If not using structured search, check if we need to process input terms
    if (!isStructuredSearch) {
      // In simple search mode, if we have multiple search terms, we have two possibilities:
      // 1. Each search term represents a separate search group (OR logic between them)
      // 2. All search terms belong to the same group (AND logic between them)
      
      // For this implementation, we'll group all terms together for AND logic
      // This matches the expectation that searching for "appnexus.com 12447" finds lines with both terms
      searchGroups = [validSearchTerms];
    }
    
    // Define helper function to compile matchers
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
    
    // Process in smaller chunks with better memory management
    const CHUNK_SIZE = 2000; // Reduced from 5000 to 2000
    const totalChunks = Math.ceil(lines.length / CHUNK_SIZE);
    
    for (let batchIndex = 0; batchIndex < totalChunks; batchIndex++) {
      // Check memory for large files
      if (lines.length > 10000 && (batchIndex % 5 === 0 || batchIndex === totalChunks - 1)) {
        monitorMemory();
      }
      
      const batchStart = batchIndex * CHUNK_SIZE;
      const batchEnd = Math.min((batchIndex + 1) * CHUNK_SIZE, lines.length);
      
      // Process each line in the batch
      for (let i = batchStart; i < batchEnd; i++) {
        // Safeguard against invalid lines
        if (!lines[i] || typeof lines[i] !== 'string') continue;
        
        const lineContent = lines[i].trim();
        if (!lineContent) continue;
        
        const lineNumber = i + 1;
        const lineLower = lineContent.toLowerCase();
        
        // Track if the line matches any of the search groups
        let anyGroupMatch = false;
        
        // Check each search group
        searchGroupMatchers.forEach((group, groupIndex) => {
          // For each group, ALL terms in the group must match (AND logic)
          let allGroupTermsMatch = group.length > 0;
          
          // Check each term in the group
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
            const termIndex = validSearchTerms.findIndex(term => {
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
      
      // Force garbage collection after every 5 batches if available
      if (global.gc && batchIndex % 5 === 4) {
        global.gc();
      }
    }
    
    // Final memory check
    monitorMemory();
    
    // Dynamically adjust max matches based on memory usage
    // This helps prevent memory issues with very large result sets
    let MAX_MATCHES = 1000;
    if (finalMemory && finalMemory.heapUsed > MEMORY_THRESHOLDS.high) {
      MAX_MATCHES = 500; // Reduce maximum matches when memory is high
    } else if (finalMemory && finalMemory.heapUsed < MEMORY_THRESHOLDS.warning) {
      MAX_MATCHES = 2000; // Allow more matches when memory is available
    }
    
    // Prevent excessive memory usage for large results
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
    
    // Count unique matching lines to fix overcounting issues
    const uniqueMatchingLines = new Set();
    searchResults.matchingLines.forEach(line => {
      if (line && line.content) {
        uniqueMatchingLines.add(line.content);
      }
    });
    
    // Set total match count based on unique lines
    searchResults.count = searchResults.totalMatchingLines || uniqueMatchingLines.size;
    
    return searchResults;
  } catch (err) {
    // Report error to parent
    safeSendToParent({
      error: `Search term processing error: ${err.message}`,
      errorDetails: {
        function: 'processSearchTermsInChunks',
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
 * Analyze app-ads.txt content in chunks to reduce memory usage
 * @param {string[]} lines - Lines of content to process
 * @param {object} options - Processing options
 * @returns {object} - Analysis results
 */
function analyzeAppAdsTxtInChunks(lines, options = {}) {
  try {
    // Begin chunked analysis
    
    // Validate input
    if (!Array.isArray(lines)) {
      throw new Error('Lines must be an array');
    }
    
    let validLineCount = 0;
    let commentLineCount = 0;
    let emptyLineCount = 0;
    let invalidLineCount = 0;
    
    // Use Set for memory-efficient unique domain tracking
    const publishers = new Set();
    const relationships = {
      direct: 0,
      reseller: 0,
      other: 0
    };
    
    // Process in smaller chunks with memory monitoring
    const CHUNK_SIZE = 2000; // Reduced from 5000 to 2000 for better memory management
    const totalChunks = Math.ceil(lines.length / CHUNK_SIZE);
    
    for (let batchIndex = 0; batchIndex < totalChunks; batchIndex++) {
      // Monitor memory for large files
      if (lines.length > 5000 && (batchIndex % 5 === 0 || batchIndex === totalChunks - 1)) {
        monitorMemory();
      }
      
      const batchStart = batchIndex * CHUNK_SIZE;
      const batchEnd = Math.min((batchIndex + 1) * CHUNK_SIZE, lines.length);
      
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
      
      // Force garbage collection after each chunk if available
      // This helps keep memory usage stable during long analyses
      if (global.gc && batchIndex % 5 === 4) {
        global.gc();
      }
    }
    
    // Final memory check
    monitorMemory();
    
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
        function: 'analyzeAppAdsTxtInChunks',
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
 * Worker thread main function with streaming processing
 */
function processAppAdsContent() {
  const startTime = Date.now();
  
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
    
    // Monitor initial memory
    monitorMemory();
    
    // Split content into lines using a more memory-efficient approach
    // for very large files
    let lines;
    try {
      // Stream-like approach for very large files
      if (content.length > 5000000) { // 5MB threshold
        
        // Process in chunks to avoid large array allocation
        const chunkSize = 1000000; // 1MB chunks
        const estimatedLines = content.length / 100; // Rough estimate of line count
        lines = new Array(Math.ceil(estimatedLines));
        
        let lineCount = 0;
        let lastIndex = 0;
        let chunk, chunkIndex, newlineIndex;
        
        // Process file in chunks
        for (let i = 0; i < content.length; i += chunkSize) {
          chunk = content.substring(i, Math.min(i + chunkSize, content.length));
          chunkIndex = 0;
          
          // Find all newlines in this chunk
          while ((newlineIndex = chunk.indexOf('\n', chunkIndex)) !== -1) {
            // Get the full line (which might start in the previous chunk)
            const line = (i === 0 || lastIndex === 0) 
              ? chunk.substring(lastIndex, newlineIndex) 
              : content.substring(lastIndex, i + newlineIndex);
            
            lines[lineCount++] = line;
            chunkIndex = newlineIndex + 1;
            lastIndex = i + chunkIndex;
          }
          
          // If this is the last chunk, add the final line
          if (i + chunkSize >= content.length && lastIndex < content.length) {
            lines[lineCount++] = content.substring(lastIndex);
          }
          
          // Check memory usage after each chunk
          if (i > 0 && i % (chunkSize * 5) === 0) {
            monitorMemory();
            global.gc && global.gc();
          }
        }
        
        // Trim array to actual line count
        if (lineCount < lines.length) {
          lines.length = lineCount;
        }
      } else {
        // Standard approach for smaller files
        lines = content.split(/\r\n|\n|\r/);
      }
      
    } catch (splitErr) {
      throw new Error(`Failed to split content into lines: ${splitErr.message}`);
    }
    
    // Monitor memory after splitting
    monitorMemory();
    
    // Analyze the content using the new chunked processing
    let analyzed;
    try {
      analyzed = analyzeAppAdsTxtInChunks(lines);
    } catch (analyzeErr) {
      safeSendToParent({
        error: `Failed to analyze content: ${analyzeErr.message}`,
        errorDetails: {
          function: 'analyzeAppAdsTxtInChunks',
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
    
    // Monitor memory after analysis
    monitorMemory();
    
    // Process search terms if provided - with chunked processing
    let searchResults = null;
    if (searchTerms && Array.isArray(searchTerms) && searchTerms.length > 0) {
      try {
        searchResults = processSearchTermsInChunks(lines, searchTerms);
      } catch (searchErr) {
        safeSendToParent({
          error: `Failed to process search terms: ${searchErr.message}`,
          errorDetails: {
            function: 'processSearchTermsInChunks',
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
    
    // Clear lines array to free memory before sending results
    lines = null;
    global.gc && global.gc();
    
    // Final memory usage
    const finalMemory = monitorMemory();
    const memStats = {
      rss: Math.round(finalMemory.rss),
      heapTotal: Math.round(finalMemory.heapTotal),
      heapUsed: Math.round(finalMemory.heapUsed),
      external: Math.round(finalMemory.external),
      arrayBuffers: finalMemory.arrayBuffers
    };
    
    // Create the final result object
    const finalResult = {
      analyzed,
      searchResults,
      contentLength: content.length,
      lineCount: analyzed.totalLines,
      stats: {
        memoryUsageAnalysis: finalMemory,
        memoryUsageFormatted: memStats
      },
      success: true,
      processingTime: Date.now() - startTime
    };
    
    // Send final result without explicitly calling process.exit after
    if (safeSendToParent(finalResult)) {
      resultSent = true;
      safeSendToParent({
        debug: true,
        message: 'Worker completed successfully',
        timestamp: Date.now(),
        success: true
      });
      
      // Let Node.js naturally exit the worker when all tasks are done
    } else {
      throw new Error('Failed to send final result to parent');
    }
    
  } catch (error) {
    // Send error to parent thread
    safeSendToParent({
      error: `Worker error: ${error.message}`,
      errorDetails: {
        error: error.message,
        stack: error.stack,
        memoryUsage: process.memoryUsage()
      },
      success: false
    });
    
    // Exit with error, but with a delay to ensure message is sent
    setTimeout(() => {
      process.exit(1);
    }, 500);
  }
}

// Start processing when the worker is created
processAppAdsContent();

// Add a safety timeout to ensure worker doesn't run forever
const MAX_EXECUTION_TIME = 5 * 60 * 1000; // 5 minutes
setTimeout(() => {
  if (!resultSent) {
    safeSendToParent({
      error: 'Worker timeout: maximum execution time exceeded',
      success: false
    });
    
    // Exit with error
    setTimeout(() => {
      process.exit(1);
    }, 300);
  }
}, MAX_EXECUTION_TIME);

// Improved exit handler to catch issues with process.exit
const originalExit = process.exit;
process.exit = function(code) {
  try {
    if (code !== 0) {
      // Capture stack trace to see where the non-zero exit is happening
      const stack = new Error().stack;
      
      safeSendToParent({
        debug: true,
        message: 'Process exit called with non-zero code',
        exitCode: code,
        exitStack: stack,
        memoryUsage: process.memoryUsage(),
        timestamp: Date.now()
      });
      
      // Give time for the message to be sent
      setTimeout(() => originalExit(code), 300);
    } else {
      originalExit(code);
    }
  } catch (err) {
    // If we can't even send the message, just exit
    originalExit(code);
  }
};

// Add memory monitoring to help detect memory leaks or issues
let memoryMonitorInterval = setInterval(() => {
  const memory = process.memoryUsage();
  
  // Only report if memory usage is concerning
  if (memory.heapUsed > 100 * 1024 * 1024) { // Over 100MB
    safeSendToParent({
      debug: true,
      message: 'High memory usage detected',
      memoryUsage: {
        rss: `${Math.round(memory.rss / (1024 * 1024))}MB`,
        heapTotal: `${Math.round(memory.heapTotal / (1024 * 1024))}MB`,
        heapUsed: `${Math.round(memory.heapUsed / (1024 * 1024))}MB`,
        external: `${Math.round(memory.external / (1024 * 1024))}MB`
      },
      timestamp: Date.now()
    });
  }
}, 5000);

// Ensure the memory monitoring doesn't keep the process alive
memoryMonitorInterval.unref();