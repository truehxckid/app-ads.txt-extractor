/**
 * Stream Worker
 * Web Worker for handling streaming data processing
 */

// State tracking
let buffer = '';
let results = [];
let processedCount = 0;
let successCount = 0; 
let errorCount = 0;
let withAppAdsTxtCount = 0;
let searchTerms = [];
let structuredParams = null;
let lastProgressUpdate = 0;
let processingStartTime = 0;

// Message handler
self.onmessage = function(e) {
  const { type, bundleIds, searchTerms: terms, structuredParams: params } = e.data;
  
  if (type === 'processBundleIds') {
    // Reset state
    resetState();
    
    // Store search terms and structured params
    searchTerms = terms || [];
    structuredParams = params || null;
    processingStartTime = Date.now();
    
    // Debug logging for structured params
    console.log('Worker received structuredParams:', JSON.stringify(structuredParams));
    
    // Initialize UI in main thread with total count
    self.postMessage({
      type: 'initialize',
      data: {
        hasSearchTerms: searchTerms.length > 0,
        hasStructuredParams: structuredParams !== null,
        totalBundleIds: bundleIds.length,
        processedCount: 0,
        percent: 0
      }
    });
    
    // Start processing
    processStreamedBundleIds(bundleIds, searchTerms, structuredParams);
  }
};

/**
 * Reset state for a new processing job
 */
function resetState() {
  buffer = '';
  results = [];
  processedCount = 0;
  successCount = 0;
  errorCount = 0;
  withAppAdsTxtCount = 0;
  searchTerms = [];
  structuredParams = null;
  lastProgressUpdate = 0;
  processingStartTime = 0;
}

/**
 * Process bundle IDs using streaming
 * @param {string[]} bundleIds - Bundle IDs to process
 * @param {string[]} searchTerms - Search terms
 * @param {Object} structuredParams - Structured search parameters (optional)
 */
async function processStreamedBundleIds(bundleIds, searchTerms, structuredParams = null) {
  try {
    // Debug the data we're about to send to API
    console.log('Worker sending to API - searchTerms:', JSON.stringify(searchTerms));
    console.log('Worker sending to API - structuredParams:', JSON.stringify(structuredParams));
    
    // Create payload with structured parameters - always in advanced mode now
    const payload = {
      bundleIds,
      mode: 'advanced',
      searchTerms: [], // Empty for advanced mode
      structuredParams: structuredParams || [] // Empty array if no structured params provided
    };
    
    console.log('Worker finalized API payload:', JSON.stringify(payload));
    
    // Make isAdvancedSearch available globally in the worker context
    const isAdvancedSearch = structuredParams !== null && (
      Array.isArray(structuredParams) ? structuredParams.length > 0 : Object.keys(structuredParams).length > 0
    );
    console.log('Worker determined isAdvancedSearch:', isAdvancedSearch);
    
    // Start fetch request
    const response = await fetch('/api/stream/extract-multiple', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }
    
    if (!response.body) {
      throw new Error('ReadableStream not supported');
    }
    
    // Get reader for streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    // Set up flags for JSON parsing
    let jsonStarted = false;
    let resultArrayStarted = false;
    
    // Process the stream
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        break;
      }
      
      // Decode chunk and add to buffer
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      
      // Process buffer for JSON objects
      if (!jsonStarted && buffer.includes('{"success":')) {
        jsonStarted = true;
        
        // Find start of results array
        const resultsStart = buffer.indexOf('"results":[');
        if (resultsStart !== -1) {
          resultArrayStarted = true;
          buffer = buffer.substring(resultsStart + 11); // Skip over "results":[
        }
      }
      
      if (resultArrayStarted) {
        // Extract complete JSON objects
        processBuffer();
        
        // Send progress update (limit frequency)
        const now = Date.now();
        if (now - lastProgressUpdate > 500) { // Update every 500ms max
          lastProgressUpdate = now;
          
          // Calculate percent based on expected total
          const percent = Math.min(Math.round((processedCount / bundleIds.length) * 100), 99);
          
          self.postMessage({
            type: 'progress',
            data: {
              processedCount,
              successCount,
              errorCount,
              withAppAdsTxtCount,
              percent,
              totalBundleIds: bundleIds.length // Always include total bundle IDs count
            }
          });
        }
      }
    }
    
    // Process any remaining buffer
    processBuffer();
    
    // Final update with total count
    self.postMessage({
      type: 'complete',
      data: {
        results,
        processedCount,
        successCount,
        errorCount,
        withAppAdsTxtCount,
        totalBundleIds: bundleIds.length,
        processingTime: Date.now() - processingStartTime,
        percent: 100 // Always 100% on completion
      }
    });
    
  } catch (err) {
    console.error('Streaming error:', err);
    
    self.postMessage({
      type: 'error',
      data: {
        message: err.message
      }
    });
  }
}

/**
 * Process the buffer to extract complete JSON objects
 */
function processBuffer() {
  // Find complete JSON objects in buffer
  let objectStart = 0;
  let objectDepth = 0;
  let inString = false;
  let escapeNext = false;
  
  for (let i = 0; i < buffer.length; i++) {
    const char = buffer[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }
    
    if (inString) continue;
    
    if (char === '{') {
      if (objectDepth === 0) {
        objectStart = i;
      }
      objectDepth++;
    } else if (char === '}') {
      objectDepth--;
      
      if (objectDepth === 0) {
        // We have a complete object
        try {
          const objectStr = buffer.substring(objectStart, i + 1);
          const resultObject = JSON.parse(objectStr);
          
          // Process the result
          processResult(resultObject);
          
          // Remove processed object from buffer
          buffer = buffer.substring(i + 1);
          
          // Check if next character is a comma (likely), and skip it
          if (buffer.charAt(0) === ',') {
            buffer = buffer.substring(1);
          }
          
          // Reset parser state
          i = -1; // Next iteration will start at index 0
        } catch (parseErr) {
          // This might be an incomplete JSON object; continue collecting
        }
      }
    }
  }
}

/**
 * Process a single result object
 * @param {Object} result - Result object from API
 */
function processResult(result) {
  // Skip invalid results
  if (!result || typeof result !== 'object') {
    console.error('Invalid result received:', result);
    return;
  }
  
  // Ensure result has bundleId (critical field)
  if (!result.bundleId) {
    console.error('Result missing bundleId:', result);
    return;
  }
  
  // Log the result for debugging (only in dev mode)
  console.log('Processing result:', result.bundleId, result);
  
  // Update statistics for all processed items
  processedCount++;
  
  if (result.success) {
    // Check if this result matches structured parameters if we're using advanced search
    if (structuredParams && Array.isArray(structuredParams) && structuredParams.length > 0) {
      if (!matchesStructuredParams(result, structuredParams)) {
        // Result doesn't match the advanced search criteria, don't count it as success
        // and don't add it to results
        console.log('Result excluded by advanced search:', result.bundleId);
        errorCount++; // Count as error for stats
        return; // Skip storing and sending this result
      }
      
      // If we get here, it matches the advanced search criteria
      console.log('Result matched advanced search criteria:', result.bundleId);
    }
    
    // Count as success
    successCount++;
    if (result.appAdsTxt?.exists) {
      withAppAdsTxtCount++;
    }
  } else {
    errorCount++;
  }
  
  // Check if result has search match data for structured search
  if (result.appAdsTxt && result.appAdsTxt.structuredMatches) {
    console.log('Structured matches found for', result.bundleId, result.appAdsTxt.structuredMatches);
  }
  
  // Store result
  results.push(result);
  
  // Send to main thread
  self.postMessage({
    type: 'result',
    data: {
      result
    }
  });
}

/**
 * Check if a result matches structured parameters
 * @param {Object} result - Result object
 * @param {Array} params - Structured parameters array
 * @returns {boolean} - True if result matches parameters
 */
function matchesStructuredParams(result, params) {
  // If no app-ads.txt, it can't match any parameters
  if (!result.appAdsTxt || !result.appAdsTxt.exists) {
    return false;
  }
  
  // Get app-ads.txt entries
  const entries = result.appAdsTxt.entries || [];
  if (!entries.length) {
    return false;
  }
  
  // For each parameter set, check if any entry matches all criteria
  for (const paramSet of params) {
    // Check for empty param set
    if (!paramSet || Object.keys(paramSet).length === 0) {
      continue;
    }
    
    console.log(`Checking entries against paramSet:`, paramSet);
    
    // Find matches for this parameter set
    const matchesForThisParamSet = entries.some(entry => {
      // Match domain if specified
      if (paramSet.domain && entry.domain) {
        const domainMatches = entry.domain.toLowerCase() === paramSet.domain.toLowerCase();
        if (!domainMatches) return false;
      }
      
      // Match publisherId if specified
      if (paramSet.publisherId && entry.publisherId) {
        // Handle both single publisherId and multiple (+ separated)
        let publisherIdMatches = false;
        
        if (paramSet.publisherId.includes('+')) {
          // Multiple publisher IDs in the parameter
          const paramPublisherIds = paramSet.publisherId.split('+').map(id => id.trim());
          publisherIdMatches = paramPublisherIds.includes(entry.publisherId.trim());
        } else {
          // Single publisher ID comparison
          publisherIdMatches = entry.publisherId.trim() === paramSet.publisherId.trim();
        }
        
        if (!publisherIdMatches) return false;
      }
      
      // Match relationship if specified
      if (paramSet.relationship && entry.relationship) {
        const relationshipMatches = entry.relationship.toUpperCase() === paramSet.relationship.toUpperCase();
        if (!relationshipMatches) return false;
      }
      
      // Match tagId if specified
      if (paramSet.tagId && entry.tagId) {
        const tagIdMatches = entry.tagId.trim() === paramSet.tagId.trim();
        if (!tagIdMatches) return false;
      }
      
      // If we got here, all specified parameters matched
      return true;
    });
    
    // If any parameter set matches, the result is included
    if (matchesForThisParamSet) {
      console.log('Found matching entry for paramSet:', paramSet);
      return true;
    }
  }
  
  // If we get here, none of the parameter sets matched any entries
  return false;
}

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} - Escaped string
 */
function escapeHtml(str) {
  if (!str || typeof str !== 'string') return '';
  
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}