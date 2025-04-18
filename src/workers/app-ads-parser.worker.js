/**
 * App-Ads.txt Parser Worker Thread
 * Used for processing large app-ads.txt files in a separate thread
 */

'use strict';

const { parentPort, workerData } = require('worker_threads');

/**
 * Process search terms against lines of content
 * @param {string[]} lines - Lines of content
 * @param {string[]} searchTerms - Search terms
 * @returns {object} - Search results
 */
function processSearchTerms(lines, searchTerms) {
  try {
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
    lines.forEach((lineContent, lineIndex) => {
      if (!lineContent.trim()) return;
      
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
          // Improved error handling with context
          const errorDetails = {
            location: 'processSearchTerms:term-matching',
            error: err.message,
            stack: err.stack,
            term: term, 
            lineIndex: lineIndex,
            lineContent: lineContent.length > 100 ? lineContent.substring(0, 100) + '...' : lineContent
          };
          
          parentPort.postMessage({
            error: `Error matching search term: ${err.message}`,
            errorDetails,
            success: false
          });
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
  } catch (err) {
    // Enhanced error reporting for the overall function
    const errorDetails = {
      location: 'processSearchTerms',
      error: err.message,
      stack: err.stack,
      searchTermsCount: searchTerms.length,
      linesCount: lines.length
    };
    
    parentPort.postMessage({
      error: `Error processing search terms: ${err.message}`,
      errorDetails,
      success: false
    });
    
    // Re-throw for caller
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
    
    lines.forEach((line, index) => {
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
      } catch (lineErr) {
        // Error handling for individual line processing
        invalidLineCount++;
        
        // Only log severe errors to avoid flooding
        if (index % 100 === 0 || index < 10) {
          parentPort.postMessage({
            warning: `Error processing line ${index + 1}: ${lineErr.message}`,
            lineError: {
              lineIndex: index,
              lineContent: line.length > 100 ? line.substring(0, 100) + '...' : line,
              error: lineErr.message
            },
            success: true // Don't fail the entire job for single line errors
          });
        }
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
  } catch (err) {
    // Enhanced error reporting
    const errorDetails = {
      location: 'analyzeAppAdsTxt',
      error: err.message,
      stack: err.stack,
      linesCount: lines.length,
      firstFewLines: lines.slice(0, 3).map(line => line.length > 100 ? line.substring(0, 100) + '...' : line)
    };
    
    parentPort.postMessage({
      error: `Error analyzing app-ads.txt: ${err.message}`,
      errorDetails,
      success: false
    });
    
    // Re-throw for caller
    throw err;
  }
}

/**
 * Worker thread main function
 */
function processAppAdsContent() {
  // Add timeout tracking to detect potential hangs
  const startTime = Date.now();
  const intervalId = setInterval(() => {
    const elapsed = Date.now() - startTime;
    if (elapsed > 10000) { // 10 seconds
      parentPort.postMessage({
        progress: `Processing in progress - ${Math.round(elapsed / 1000)}s elapsed`,
        success: true
      });
    }
  }, 10000);
  
  // Track stats to help diagnose memory issues
  const stats = {
    contentLength: 0,
    lineCount: 0,
    memoryUsage: process.memoryUsage()
  };
  
  try {
    if (!workerData) {
      throw new Error('No worker data provided');
    }
    
    const { content, searchTerms } = workerData;
    
    if (!content) {
      throw new Error('No content provided in worker data');
    }
    
    stats.contentLength = content.length;
    
    // Split content into lines
    const lines = content.split(/\r\n|\n|\r/);
    stats.lineCount = lines.length;
    
    // Update memory stats after splitting
    stats.memoryUsageSplit = process.memoryUsage();
    
    // Log progress for large files
    if (lines.length > 10000) {
      parentPort.postMessage({
        progress: `Processing ${lines.length} lines`,
        success: true
      });
    }
    
    // Analyze the content
    const analyzed = analyzeAppAdsTxt(lines);
    
    // Update memory stats after analysis
    stats.memoryUsageAnalysis = process.memoryUsage();
    
    // Process search terms if provided
    let searchResults = null;
    if (searchTerms && searchTerms.length > 0) {
      if (lines.length > 10000) {
        parentPort.postMessage({
          progress: `Processing search terms across ${lines.length} lines`,
          success: true
        });
      }
      
      searchResults = processSearchTerms(lines, searchTerms);
      
      // Update memory stats after search
      stats.memoryUsageSearch = process.memoryUsage();
    }
    
    // Clean up the interval
    clearInterval(intervalId);
    
    // Send the results back to the main thread
    parentPort.postMessage({
      analyzed,
      searchResults,
      contentLength: content.length,
      stats,
      success: true,
      processingTime: Date.now() - startTime
    });
  } catch (error) {
    // Clean up the interval
    clearInterval(intervalId);
    
    // Enhanced error reporting
    const errorDetails = {
      error: error.message,
      stack: error.stack,
      stats,
      workerData: {
        hasContent: !!workerData?.content,
        contentLength: workerData?.content?.length,
        hasSearchTerms: !!workerData?.searchTerms,
        searchTermsCount: workerData?.searchTerms?.length
      },
      memoryUsage: process.memoryUsage()
    };
    
    parentPort.postMessage({
      error: `Worker error: ${error.message}`,
      errorDetails,
      success: false,
      processingTime: Date.now() - startTime
    });
    
    // The process will exit with non-zero code to indicate an error
    process.exit(1);
  }
}

// Register uncaught exception handler
process.on('uncaughtException', (err) => {
  try {
    parentPort.postMessage({
      error: `Uncaught exception in worker: ${err.message}`,
      errorDetails: {
        error: err.message,
        stack: err.stack,
        memoryUsage: process.memoryUsage()
      },
      success: false
    });
  } catch (postError) {
    // Last resort if even reporting fails
    console.error('Critical worker error:', err);
  }
  
  // Exit with error
  process.exit(1);
});

// Register unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  try {
    parentPort.postMessage({
      error: `Unhandled promise rejection in worker: ${reason instanceof Error ? reason.message : String(reason)}`,
      errorDetails: {
        error: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : 'No stack trace available',
        memoryUsage: process.memoryUsage()
      },
      success: false
    });
  } catch (postError) {
    // Last resort if even reporting fails
    console.error('Critical worker error (unhandled rejection):', reason);
  }
  
  // Exit with error
  process.exit(1);
});

// Start processing when the worker is created
processAppAdsContent();