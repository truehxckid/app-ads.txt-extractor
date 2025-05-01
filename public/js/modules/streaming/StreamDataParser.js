/**
 * StreamDataParser Module
 * Handles parsing and processing of streaming data
 */

/**
 * Stream Data Parser Class
 * Processes and parses streaming data from server
 */
class StreamDataParser {
  /**
   * Constructor
   * @param {TextDecoder} decoder - Text decoder for byte streams
   */
  constructor(decoder) {
    this.decoder = decoder || new TextDecoder();
  }
  
  /**
   * Process a stream and handle results
   * @param {ReadableStream} stream - Response body stream
   * @param {Function} resultCallback - Callback for processing each result
   * @param {Object} debugger - Debugger instance for logging
   * @param {Object} progressUI - Progress UI instance for updates
   * @returns {Promise<void>}
   */
  async processStream(stream, resultCallback, debugger, progressUI) {
    // Get stream reader
    const reader = stream.getReader();
    let buffer = '';
    let parseCount = 0;
    let chunkCount = 0;
    const streamStartTime = Date.now();
    
    // Set up heartbeat for progress updates
    let heartbeatInterval = setInterval(() => {
      progressUI.forceUpdate();
      
      // Log heartbeat in debug
      if (debugger) {
        const runTime = Math.round((Date.now() - streamStartTime) / 1000);
        debugger.logStatus(`Heartbeat at ${runTime}s - Buffer size: ${buffer.length}`);
      }
    }, 1000);
    
    try {
      // Process the stream
      while (true) {
        try {
          const { done, value } = await reader.read();
          
          if (done) {
            if (debugger) {
              debugger.logStatus('Stream complete (done=true)');
            }
            break;
          }
          
          // Decode the chunk and add to buffer
          const chunk = this.decoder.decode(value, { stream: true });
          buffer += chunk;
          chunkCount++;
          
          // Log chunk details in debugger
          if (debugger) {
            debugger.logChunk(chunk, value.length);
          }
          
          // Process complete objects
          const extractedResults = this._extractObjectsFromBuffer(buffer);
          
          if (extractedResults.objects.length > 0) {
            buffer = extractedResults.remainingBuffer;
            
            // Process each extracted result
            for (const resultObject of extractedResults.objects) {
              if (resultCallback) {
                resultCallback(resultObject);
              }
              parseCount++;
            }
            
            if (debugger) {
              debugger.logStatus(`Processed ${extractedResults.objects.length} objects (total: ${parseCount})`);
            }
          }
        } catch (readError) {
          if (debugger) {
            debugger.logError('Error reading chunk: ' + readError.message);
          }
          console.error('Error reading stream chunk:', readError);
          // Continue trying to read in case of recoverable errors
        }
      }
    } finally {
      clearInterval(heartbeatInterval);
      reader.releaseLock();
      
      // Update final status
      if (debugger) {
        const runTime = Math.round((Date.now() - streamStartTime) / 1000);
        debugger.logSummary(`Stream processing completed in ${runTime}s`, {
          totalObjects: parseCount,
          totalChunks: chunkCount
        });
      }
    }
  }
  
  /**
   * Extract complete JSON objects from buffer
   * @param {string} buffer - Current buffer content
   * @returns {Object} Object containing extracted objects and remaining buffer
   * @private
   */
  _extractObjectsFromBuffer(buffer) {
    const objects = [];
    let currentIndex = 0;
    let objectStart = -1;
    let objectDepth = 0;
    let inString = false;
    let escapeNext = false;
    
    // First locate where JSON array begins if not already identified
    if (buffer.includes('{"success":') && buffer.includes('"results":[')) {
      const resultsStart = buffer.indexOf('"results":[');
      if (resultsStart !== -1) {
        // Move current position to start of array data
        currentIndex = resultsStart + 11; // Skip over "results":[
      }
    }
    
    // Process buffer character by character from current index
    for (let i = currentIndex; i < buffer.length; i++) {
      const char = buffer[i];
      
      // Handle escape characters
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      // Track string boundaries
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      
      // Skip if in string
      if (inString) continue;
      
      // Handle comments in the stream (used as heartbeats)
      if (char === '/' && i+1 < buffer.length && buffer[i+1] === '*') {
        // Found start of comment, find the end
        const commentEnd = buffer.indexOf('*/', i + 2);
        if (commentEnd !== -1) {
          i = commentEnd + 1; // Skip over comment
          continue;
        }
      }
      
      // Track object nesting
      if (char === '{') {
        if (objectDepth === 0) {
          objectStart = i;
        }
        objectDepth++;
      } else if (char === '}') {
        objectDepth--;
        
        if (objectDepth === 0 && objectStart !== -1) {
          // We have a complete object
          try {
            const objectStr = buffer.substring(objectStart, i + 1);
            const resultObject = JSON.parse(objectStr);
            objects.push(resultObject);
            
            // Update object start for next object
            objectStart = -1;
            
            // Skip comma if present
            if (i + 1 < buffer.length && buffer[i + 1] === ',') {
              i++;
            }
          } catch (parseErr) {
            // Incomplete or invalid JSON, reset depth and continue
            objectDepth = 0;
            objectStart = -1;
          }
        }
      }
    }
    
    // If we've extracted any objects, return the remainder of the buffer
    if (objects.length > 0 && objectStart === -1) {
      // Find the next object start or comment
      let nextStart = buffer.indexOf('{', currentIndex);
      const nextComment = buffer.indexOf('/*', currentIndex);
      
      if (nextComment !== -1 && (nextStart === -1 || nextComment < nextStart)) {
        nextStart = nextComment;
      }
      
      // If we found a valid next point, return buffer from there
      if (nextStart !== -1) {
        return { 
          objects, 
          remainingBuffer: buffer.substring(nextStart)
        };
      }
    }
    
    // Return objects and remaining buffer
    return { 
      objects, 
      remainingBuffer: buffer
    };
  }
  
  /**
   * Parse a chunk of JSON for quick stats
   * @param {string} chunk - JSON chunk to analyze
   * @returns {Object} Summary stats from the chunk
   */
  analyzeChunk(chunk) {
    const stats = {
      byteLength: chunk.length,
      jsonObjects: 0,
      heartbeats: 0
    };
    
    // Count JSON objects by brace pairs
    let braceCount = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === '{') braceCount++;
      if (chunk[i] === '}' && braceCount > 0) {
        braceCount--;
        if (braceCount === 0) stats.jsonObjects++;
      }
    }
    
    // Count heartbeat comments
    let pos = 0;
    while ((pos = chunk.indexOf('/*', pos)) !== -1) {
      stats.heartbeats++;
      pos += 2;
    }
    
    return stats;
  }
}

export default StreamDataParser;