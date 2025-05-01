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
    console.log('🔍 StreamDataParser instance created with decoder:', !!this.decoder);
  }
  
  /**
   * Set the decoder to use for stream processing
   * @param {TextDecoder} decoder - Text decoder to use
   */
  setDecoder(decoder) {
    if (decoder) {
      console.log('🔍 StreamDataParser: Setting decoder');
      this.decoder = decoder;
    }
  }
  
  /**
   * Process a stream and handle results
   * @param {ReadableStream} stream - Response body stream
   * @param {Function} resultCallback - Callback for processing each result
   * @param {Object} debuggerInstance - Debugger instance for logging
   * @param {Object} progressUI - Progress UI instance for updates
   * @returns {Promise<void>}
   */
  async processStream(stream, resultCallback, debuggerInstance, progressUI) {
    console.log('🌊 StreamDataParser.processStream: Starting stream processing');
    console.log('🌊 CRITICAL CHECK: Stream exists:', !!stream);
    console.log('🌊 CRITICAL CHECK: Stream is readable:', !!stream.getReader);
    
    // Get stream reader
    const reader = stream.getReader();
    let buffer = '';
    let parseCount = 0;
    let chunkCount = 0;
    const streamStartTime = Date.now();
    
    // Add debug event
    try {
      // Add an event to the monitor to help debug
      if (window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('stream-processing-started', {
          detail: { streamStartTime, timestamp: Date.now() }
        }));
        console.log('🌊 STREAM EVENT: Dispatched stream-processing-started event');
      }
    } catch (e) {
      console.error('Error dispatching stream event:', e);
    }
    
    // Set up heartbeat for progress updates
    let heartbeatInterval = setInterval(() => {
      progressUI.forceUpdate();
      
      // Log heartbeat in debug
      if (debuggerInstance) {
        const runTime = Math.round((Date.now() - streamStartTime) / 1000);
        debuggerInstance.logStatus(`Heartbeat at ${runTime}s - Buffer size: ${buffer.length}`);
      }
    }, 1000);
    
    try {
      // Process the stream
      console.log('⚡ SUPER CRITICAL DEBUG: Starting to read stream');
      
      // Update debug info safely
      const updateDebugInfo = (message) => {
        try {
          const debugElement = document.getElementById('debug-information') || document.getElementById('debugInfo');
          if (debugElement) {
            debugElement.innerHTML += message;
          }
        } catch (err) {
          console.error('Error updating debug info:', err);
        }
      };
      
      updateDebugInfo('<br>Starting to read stream...');
      
      while (true) {
        try {
          console.log('⚡ Stream reader: Calling reader.read()...');
          const { done, value } = await reader.read();
          
          if (done) {
            console.log('⚡ Stream reader: Read complete, stream done');
            updateDebugInfo('<br>Stream read complete!');
            if (debuggerInstance) {
              debuggerInstance.logStatus('Stream complete (done=true)');
            }
            break;
          }
          
          // Decode the chunk and add to buffer
          console.log(`⚡ Stream reader: Received data chunk of size ${value?.length || 0} bytes`);
          updateDebugInfo(`<br>Received chunk #${chunkCount+1} (${value?.length || 0} bytes)`);
          
          const chunk = this.decoder.decode(value, { stream: true });
          buffer += chunk;
          chunkCount++;
          
          // Log chunk details in debugger
          if (debuggerInstance) {
            debuggerInstance.logChunk(chunk, value.length);
          }
          
          // Process complete objects
          console.log('⚡ Parsing buffer of length:', buffer.length);
          updateDebugInfo(`<br>Parsing buffer (${buffer.length} bytes)...`);
          
          const extractedResults = this._extractObjectsFromBuffer(buffer);
          
          if (extractedResults.objects.length > 0) {
            console.log(`⚡⚡⚡ SUCCESS!! Extracted ${extractedResults.objects.length} results from buffer!`);
            updateDebugInfo(`<br><strong style="color:green">SUCCESS! Found ${extractedResults.objects.length} results</strong>`);
            buffer = extractedResults.remainingBuffer;
            
            // Process each extracted result
            for (const resultObject of extractedResults.objects) {
              console.log(`⚡⚡⚡ Processing result object:`, resultObject.bundleId);
              updateDebugInfo(`<br>Processing: ${resultObject.bundleId || 'unknown'}`);
              
              if (resultCallback) {
                resultCallback(resultObject);
              } else {
                console.error('⚡⚡⚡ CRITICAL ERROR: resultCallback is not defined!');
                updateDebugInfo('<br><span style="color:red">ERROR: Result callback missing!</span>');
              }
              parseCount++;
            }
            
            if (debuggerInstance) {
              debuggerInstance.logStatus(`Processed ${extractedResults.objects.length} objects (total: ${parseCount})`);
            }
          }
        } catch (readError) {
          if (debuggerInstance) {
            debuggerInstance.logError('Error reading chunk: ' + readError.message);
          }
          console.error('Error reading stream chunk:', readError);
          // Continue trying to read in case of recoverable errors
        }
      }
    } finally {
      clearInterval(heartbeatInterval);
      reader.releaseLock();
      
      // Update final status
      if (debuggerInstance) {
        const runTime = Math.round((Date.now() - streamStartTime) / 1000);
        debuggerInstance.logSummary(`Stream processing completed in ${runTime}s`, {
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
    console.log('🔍 Parsing buffer of length:', buffer.length);
    
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
    
    // Log extracted objects
    if (objects.length > 0) {
      console.log(`📊 Extracted ${objects.length} objects from buffer`);
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

// Create and export a singleton instance
const streamDataParser = new StreamDataParser();
export default streamDataParser;