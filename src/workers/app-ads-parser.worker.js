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
        // Error handling in worker
        parentPort.postMessage({
          error: `Error matching search term: ${err.message}`,
          term,
          lineIndex,
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
 * Worker thread main function
 */
function processAppAdsContent() {
  const { content, searchTerms } = workerData;
  
  try {
    // Split content into lines
    const lines = content.split(/\r\n|\n|\r/);
    
    // Analyze the content
    const analyzed = analyzeAppAdsTxt(lines);
    
    // Process search terms if provided
    let searchResults = null;
    if (searchTerms && searchTerms.length > 0) {
      searchResults = processSearchTerms(lines, searchTerms);
    }
    
    // Send the results back to the main thread
    parentPort.postMessage({
      analyzed,
      searchResults,
      contentLength: content.length,
      success: true
    });
  } catch (error) {
    parentPort.postMessage({
      error: error.message,
      stack: error.stack,
      success: false
    });
  }
}

// Start processing when the worker is created
processAppAdsContent();