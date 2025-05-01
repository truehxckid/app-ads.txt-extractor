/**
 * Streaming Module for App-Ads.txt Extractor
 * Handles client-side streaming processing for large datasets
 */

import AppState from './app-state.js';
import DOMUtils from './dom-utils.js';
import { showNotification } from '../utils/notification.js';
import { formatNumber, getStoreDisplayName } from '../utils/formatting.js';
import VisualIndicators from './visual-indicators.js';

/**
 * Streaming processor class
 */
class StreamingProcessor {
  constructor() {
    this.initialized = false;
    this.worker = null;
    this.streamController = null;
    this.decoder = new TextDecoder();
    
    // Initialize stats
    this.stats = {
      processedCount: 0,
      successCount: 0,
      errorCount: 0,
      withAppAdsTxtCount: 0,
      startTime: 0,
      totalBundleIds: 0,
      lastRenderTime: 0
    };
    
    // Results storage
    this.results = [];
    this.searchTerms = [];
    
    // Progressive rendering buffers
    this.resultBuffer = [];
    this.lastRenderTime = 0;
    this.renderThrottleTime = 200; // ms between renders
    this.isRendering = false;
    this.animationFrameId = null;
    
    // References for fallback indicators
    this.fallbackIndicator = null;
    this.fallbackProgressBar = null;
    this.fallbackStatusText = null;
  }
  
  /**
   * Create a fallback indicator if the main one fails
   * @param {HTMLElement} container - Container element
   * @param {number} totalItems - Total items to process
   * @private
   */
  _createFallbackIndicator(container, totalItems) {
    if (!container) return;
    
    // Create indicator container
    const indicator = document.createElement('div');
    indicator.className = 'fallback-indicator';
    indicator.style.cssText = 'margin-bottom: 20px; padding: 15px; border-radius: 8px; background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border: 1px solid #e0e0e0;';
    
    // Create content
    indicator.innerHTML = `
      <div style="margin-bottom: 10px; font-weight: bold;">Processing ${totalItems} bundle IDs</div>
      <div style="height: 20px; background: #f0f0f0; border-radius: 10px; overflow: hidden; margin-bottom: 10px;">
        <div class="fallback-progress-bar" style="height: 100%; width: 10%; background: linear-gradient(90deg, #3498db, #2980b9); transition: width 0.5s ease;"></div>
      </div>
      <div class="fallback-status-text">Starting process...</div>
    `;
    
    // Insert at the beginning of the container
    container.insertBefore(indicator, container.firstChild);
    
    // Store references
    this.fallbackIndicator = indicator;
    this.fallbackProgressBar = indicator.querySelector('.fallback-progress-bar');
    this.fallbackStatusText = indicator.querySelector('.fallback-status-text');
    
    console.log('Fallback indicator created');
  }
  
  /**
   * Update the fallback indicator
   * @param {Object} stats - Current processing statistics
   * @private
   */
  _updateFallbackIndicator(stats) {
    console.log('Attempting to update fallback indicator', stats);
    
    // If fallback doesn't exist yet, create it
    if (!this.fallbackIndicator || !this.fallbackProgressBar || !this.fallbackStatusText) {
      console.log('Fallback indicator not found, creating...');
      const container = document.getElementById('result');
      if (container) {
        this._createFallbackIndicator(container, stats.total || 100);
      } else {
        console.warn('Could not find result container for fallback indicator');
        return;
      }
    }
    
    // Double-check fallback exists after creation attempt
    if (!this.fallbackProgressBar || !this.fallbackStatusText) {
      console.error('Failed to create or find fallback indicator elements');
      return;
    }
    
    // Calculate percentage
    let percent = 0;
    if (stats.total > 0) {
      percent = Math.min(100, Math.round((stats.processed / stats.total) * 100));
    } else {
      // If total unknown, use a time-based estimate (max 95%)
      const elapsed = Date.now() - stats.startTime;
      percent = Math.min(95, Math.round((elapsed / 60000) * 100));
    }
    
    console.log(`Fallback indicator update: ${percent}% (${stats.processed}/${stats.total})`);
    
    // Update progress bar using direct DOM manipulation to ensure it works
    try {
      this.fallbackProgressBar.style.width = `${percent}%`;
      
      // Update status text
      this.fallbackStatusText.textContent = `Processing... ${percent}% complete (${stats.processed} of ${stats.total})`;
      
      // Add completion class if done
      if (percent >= 100) {
        this.fallbackIndicator.style.borderColor = '#27ae60';
        this.fallbackStatusText.textContent = 'Processing complete!';
      }
      
      // Make sure the fallback indicator is visible
      this.fallbackIndicator.style.display = 'block';
    } catch (err) {
      console.error('Error updating fallback indicator:', err);
    }
  }
  
  /**
   * Initialize the streaming processor
   */
  initialize() {
    if (this.initialized) return;
    
    // Check if browser supports streaming
    if (!window.ReadableStream || !window.TextDecoder) {
      console.warn('Browser does not support streaming, falling back to regular processing');
      return false;
    }
    
    // Try to initialize web worker if supported
    try {
      if (window.Worker) {
        this.worker = new Worker('/js/workers/stream-worker.js');
        
        // Set up event listener for worker messages
        this.worker.onmessage = (e) => {
          this._handleWorkerMessage(e.data);
        };
      }
    } catch (err) {
      console.warn('Failed to initialize streaming worker:', err);
    }
    
    this.initialized = true;
    return true;
  }
  
  /**
   * Process bundle IDs using streaming
   * @param {string[]} bundleIds - Bundle IDs to process
   * @param {string[]} searchTerms - Search terms (optional)
   * @returns {Promise<boolean>} - Success status
   */
  async processBundleIds(bundleIds, searchTerms = []) {
    // Initialize if not already
    if (!this.initialized) {
      if (!this.initialize()) {
        showNotification('Streaming not supported in this browser, using regular processing instead', 'warning');
        return false;
      }
    }
    
    // Reset state
    this.resetState();
    this.searchTerms = searchTerms;
    this.stats.startTime = Date.now();
    this.stats.totalBundleIds = bundleIds.length;
    
    // Get result element and create initial UI
    const resultElement = DOMUtils.getElement('result');
    if (!resultElement) return false;
    
    // Make sure the result section is visible
    if (resultElement) {
      resultElement.style.display = 'block';
    }
    
    // Initialize visual indicators with direct DOM element and fallback
    const initSuccess = VisualIndicators.initialize({
      totalItems: bundleIds.length,
      containerSelector: resultElement || document.getElementById('result'),
      showDetails: true,
      animate: true
    });
    
    if (!initSuccess) {
      console.error('Failed to initialize visual indicators, creating direct fallback');
      // Create a direct fallback if initialization fails
      this._createFallbackIndicator(resultElement || document.getElementById('result'), bundleIds.length);
    } else {
      // Set initial status message
      VisualIndicators.setStatusMessage('Starting streaming process...', 'info');
    }
    
    try {
      // If worker is available and initialized, use it
      if (this.worker) {
        console.log('Using Web Worker for streaming processing');
        VisualIndicators.setStatusMessage('Processing with Web Worker...', 'info');
        
        this.worker.postMessage({
          type: 'processBundleIds',
          bundleIds,
          searchTerms,
          totalBundleIds: bundleIds.length
        });
        
        // Worker handles the UI updates, so we just return
        return true;
      }
      
      // If no worker, process with main thread
      VisualIndicators.setStatusMessage('Processing on main thread...', 'info');
      return await this._processBundleIdsMainThread(bundleIds, searchTerms);
    } catch (err) {
      console.error('Error starting streaming process:', err);
      showNotification(`Streaming error: ${err.message}`, 'error');
      VisualIndicators.showError(`Streaming error: ${err.message}`);
      return false;
    }
  }
  
  /**
   * Process bundle IDs using streaming on the main thread
   * @param {string[]} bundleIds - Bundle IDs to process
   * @param {string[]} searchTerms - Search terms (optional)
   * @returns {Promise<boolean>} - Success status
   */
  async _processBundleIdsMainThread(bundleIds, searchTerms = []) {
    try {
      // Prepare the DOM for streaming results
      this._initializeResultsUI(searchTerms.length > 0);
      
      // Add a cache-busting parameter to avoid cached responses
      const timestamp = Date.now();
      console.log(`Starting stream fetch with timestamp ${timestamp}`);
      
      // Create a debugging div to show raw stream data
      const debugDiv = document.createElement('div');
      debugDiv.id = 'stream-debug';
      debugDiv.style.cssText = 'position: fixed; bottom: 10px; right: 10px; width: 300px; height: 200px; background: #f0f0f0; border: 1px solid #999; padding: 10px; overflow: auto; z-index: 9999; font-size: 10px;';
      document.body.appendChild(debugDiv);
      
      // Start streaming process with a shorter timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
      
      try {
        const response = await fetch(`/api/stream/extract-multiple?nocache=${timestamp}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Debug-Mode': 'true',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          },
          body: JSON.stringify({ bundleIds, searchTerms }),
          signal: controller.signal
        });
        
        // Clear the timeout since we got a response
        clearTimeout(timeoutId);
        
        // Update debug info
        debugDiv.innerHTML = `
          <strong>Connection established</strong><br>
          Status: ${response.status}<br>
          Headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}<br>
          <hr>
        `;
      
      
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }
      
      if (!response.body) {
        throw new Error('ReadableStream not supported in this browser');
      }
      
      // Update debug info
      debugDiv.innerHTML += 'Stream body available, starting to read...<br>';
      
      // Set up a special debug stream reader
      this.debugDiv = debugDiv;
      this.streamStartTime = Date.now();
      
      // Force UI update now that we have a stream
      this._forceUpdateProgressUI();
      
      // Process the stream with debug mode
      await this._processResponseStreamWithDebug(response.body);
      
      // Update the UI when complete
      this._finalizeUI();
      
      return true;
    } catch (err) {
      console.error('Streaming error:', err);
      
      // Update debug div with error
      if (this.debugDiv) {
        this.debugDiv.innerHTML += `<strong style="color: red">ERROR: ${err.message}</strong><br>`;
        this.debugDiv.innerHTML += `<pre>${err.stack}</pre>`;
      }
      
      showNotification(`Streaming error: ${err.message}`, 'error');
      DOMUtils.showError('result', err.message);
      return false;
    } finally {
      // Keep the debug div visible after error or completion
      if (this.debugDiv) {
        this.debugDiv.innerHTML += '<hr><strong>Stream processing complete or failed</strong>';
      }
    }
  } catch (err) {
    console.error('Main thread streaming error:', err);
    
    // Update debug div with error if it exists
    if (this.debugDiv) {
      this.debugDiv.innerHTML += `<strong style="color: red">MAIN THREAD ERROR: ${err.message}</strong><br>`;
      this.debugDiv.innerHTML += `<pre>${err.stack}</pre>`;
    }
    
    showNotification(`Main thread streaming error: ${err.message}`, 'error');
    DOMUtils.showError('result', `Main thread streaming error: ${err.message}`);
    return false;
  }
  }
  
  /**
   * Process response stream with debug information
   * @param {ReadableStream} stream - Response body stream
   */
  async _processResponseStreamWithDebug(stream) {
    // Get stream reader
    const reader = stream.getReader();
    let buffer = '';
    let jsonStarted = false;
    let resultArrayStarted = false;
    let parseCount = 0;
    let chunkCount = 0;
    
    // Set up heartbeat for progress indicators - more frequent updates
    let heartbeatInterval = setInterval(() => {
      this._forceUpdateProgressUI();
      
      // Update debug div with heartbeat status
      if (this.debugDiv) {
        const runTime = Math.round((Date.now() - this.streamStartTime) / 1000);
        this.debugDiv.innerHTML += `Heartbeat at ${runTime}s - Buffer size: ${buffer.length}<br>`;
        // Auto-scroll to bottom
        this.debugDiv.scrollTop = this.debugDiv.scrollHeight;
      }
    }, 1000); // More frequent updates
    
    // Set up an independent fallback heartbeat to handle errors
    let fallbackHeartbeat = setInterval(() => {
      try {
        // Force direct DOM updates as a backup
        this._updateFallbackIndicator({
          processed: this.stats.processedCount,
          total: this.stats.totalBundleIds,
          startTime: this.stats.startTime
        });
        
        // Create or update a simple progress meter in case all else fails
        const container = document.getElementById('result');
        if (container) {
          let simpleIndicator = document.getElementById('simple-progress-indicator');
          if (!simpleIndicator) {
            simpleIndicator = document.createElement('div');
            simpleIndicator.id = 'simple-progress-indicator';
            simpleIndicator.style.cssText = 'margin: 10px 0; padding: 15px; background: white; border: 1px solid #e0e0e0; border-radius: 8px;';
            container.insertBefore(simpleIndicator, container.firstChild);
          }
          
          const percent = this.stats.totalBundleIds > 0 
            ? Math.min(100, Math.round((this.stats.processedCount / this.stats.totalBundleIds) * 100))
            : 0;
          
          simpleIndicator.innerHTML = `
            <div><strong>Streaming Progress:</strong> ${this.stats.processedCount} / ${this.stats.totalBundleIds} items (${percent}%)</div>
            <div style="height: 10px; background: #f0f0f0; margin: 8px 0; border-radius: 5px; overflow: hidden;">
              <div style="height: 100%; width: ${percent}%; background: #3498db; transition: width 0.3s ease;"></div>
            </div>
          `;
        }
      } catch (e) {
        console.error('Error in fallback heartbeat:', e);
      }
    }, 1500); // Offset from main heartbeat
    
    try {
      // Initialize progress indicators
      this.stats.startTime = Date.now();
      this._forceUpdateProgressUI();
      
      // Process the stream
      while (true) {
        try {
          const { done, value } = await reader.read();
          
          if (done) {
            if (this.debugDiv) {
              this.debugDiv.innerHTML += '<strong>Stream complete (done=true)</strong><br>';
            }
            break;
          }
          
          // Decode the chunk and add to buffer
          const chunk = this.decoder.decode(value, { stream: true });
          buffer += chunk;
          chunkCount++;
          
          // Log chunk details
          if (this.debugDiv) {
            const displayChunk = chunk.length > 50 ? chunk.substring(0, 50) + '...' : chunk;
            this.debugDiv.innerHTML += `Chunk #${chunkCount} (${value.length} bytes): ${displayChunk.replace(/</g, '&lt;')}<br>`;
            this.debugDiv.scrollTop = this.debugDiv.scrollHeight;
          }
          
          // Process complete objects
          const extractedResults = this._extractObjectsFromBuffer(buffer);
          
          if (extractedResults.objects.length > 0) {
            buffer = extractedResults.remainingBuffer;
            
            // Process each extracted result
            for (const resultObject of extractedResults.objects) {
              this._processResult(resultObject);
              parseCount++;
            }
            
            if (this.debugDiv) {
              this.debugDiv.innerHTML += `Processed ${extractedResults.objects.length} objects (total: ${parseCount})<br>`;
              this.debugDiv.scrollTop = this.debugDiv.scrollHeight;
            }
            
            // Force update UI
            this._forceUpdateProgressUI();
          }
        } catch (readError) {
          if (this.debugDiv) {
            this.debugDiv.innerHTML += `<span style="color:red">Error reading chunk: ${readError.message}</span><br>`;
            this.debugDiv.scrollTop = this.debugDiv.scrollHeight;
          }
          console.error('Error reading stream chunk:', readError);
          // Continue trying to read in case of recoverable errors
        }
      }
    } finally {
      clearInterval(heartbeatInterval);
      clearInterval(fallbackHeartbeat); // Clear fallback heartbeat
      reader.releaseLock();
      
      // Update final status
      if (this.debugDiv) {
        const runTime = Math.round((Date.now() - this.streamStartTime) / 1000);
        this.debugDiv.innerHTML += `<strong>Stream processing completed in ${runTime}s</strong><br>`;
        this.debugDiv.innerHTML += `Total processed objects: ${parseCount}<br>`;
        this.debugDiv.innerHTML += `Total chunks received: ${chunkCount}<br>`;
        this.debugDiv.scrollTop = this.debugDiv.scrollHeight;
      }
      
      // Force final UI update
      this._forceUpdateProgressUI();
      
      // Update one last time via fallback for reliability
      this._updateFallbackIndicator({
        processed: this.stats.processedCount,
        total: this.stats.totalBundleIds,
        startTime: this.stats.startTime
      });
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
   * Original process response body as a stream method (for reference)
   * @param {ReadableStream} stream - Response body stream
   */
  async _processResponseStream(stream) {
    // Get stream reader
    const reader = stream.getReader();
    let buffer = '';
    let jsonStarted = false;
    let resultArrayStarted = false;
    let parseCount = 0;
    
    // Set up heartbeat for progress indicators to update every second regardless of stream data
    let heartbeatInterval = setInterval(() => {
      console.log('Heartbeat update UI');
      this._forceUpdateProgressUI();
    }, 1000);
    
    try {
      // Initialize progress indicators immediately
      this.stats.startTime = Date.now();
      this._forceUpdateProgressUI();
      
      // Add server status message
      const statusMessage = document.querySelector('.status-message');
      if (statusMessage) {
        statusMessage.textContent = 'Connected to server, waiting for data...';
        statusMessage.className = 'status-message info';
      }
      
      // Process the stream
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }
        
        // Decode the chunk and add to buffer
        const chunk = this.decoder.decode(value, { stream: true });
        buffer += chunk;
        
        console.log('Received chunk:', chunk.substring(0, 100) + (chunk.length > 100 ? '...' : ''));
        
        // Process buffer for complete JSON objects
        if (!jsonStarted && buffer.includes('{"success":')) {
          jsonStarted = true;
          console.log('JSON response started');
          
          // Extract any initial metadata
          const resultsStart = buffer.indexOf('"results":[');
          if (resultsStart !== -1) {
            resultArrayStarted = true;
            buffer = buffer.substring(resultsStart + 11); // Skip over "results":[
            console.log('Results array started');
          }
        }
        
        if (resultArrayStarted) {
          // Try to extract complete JSON objects from the array
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
                  this._processResult(resultObject);
                  
                  // Force update UI on each result
                  this._forceUpdateProgressUI();
                  
                  // Update progress every few items
                  if (++parseCount % 2 === 0) {
                    this._updateProgressUI();
                  }
                  
                  // Remove processed object from buffer
                  buffer = buffer.substring(i + 1);
                  
                  // Check if next character is a comma (likely), and skip it
                  if (buffer.charAt(0) === ',') {
                    buffer = buffer.substring(1);
                  }
                  
                  // Reset parser state
                  i = -1; // Next iteration will be at index 0
                } catch (parseErr) {
                  console.debug('Incomplete JSON object, continuing collection', parseErr);
                  // Don't modify buffer, continue collecting
                }
              }
            }
          }
        }
        
        // Force update UI after processing each chunk
        this._forceUpdateProgressUI();
      }
      
      // Final buffer processing for any trailing metadata
      if (buffer.includes('"totalProcessed":')) {
        const totalProcessedMatch = buffer.match(/"totalProcessed":(\d+)/);
        if (totalProcessedMatch && totalProcessedMatch[1]) {
          const totalProcessed = parseInt(totalProcessedMatch[1], 10);
          console.log(`Total processed according to server: ${totalProcessed}`);
          
          // Force update UI with server-reported total
          this.stats.processedCount = totalProcessed;
          this._forceUpdateProgressUI();
        }
      }
    } catch (err) {
      console.error('Error processing stream:', err);
      throw err;
    } finally {
      // Clear heartbeat interval
      clearInterval(heartbeatInterval);
      
      // Make sure we do a final UI update
      this._forceUpdateProgressUI();
      
      reader.releaseLock();
    }
  }
  
  /**
   * Force update all progress UI elements directly
   * @private
   */
  _forceUpdateProgressUI() {
    console.log(`Force updating UI: ${this.stats.processedCount}/${this.stats.totalBundleIds}`);
    
    // Create a direct DOM update function for reliability
    const updateDOM = () => {
      // Calculate percent
      const percent = this.stats.totalBundleIds > 0 
        ? Math.min(100, Math.round((this.stats.processedCount / this.stats.totalBundleIds) * 100))
        : 0;
      
      console.log(`Calculated percent: ${percent}% (${this.stats.processedCount}/${this.stats.totalBundleIds})`);
      
      // Update main visual indicators container
      const mainProgressBar = document.querySelector('.visual-indicators-container .progress-bar');
      if (mainProgressBar) {
        console.log('Found main progress bar, updating to', `${percent}%`);
        mainProgressBar.style.width = `${percent}%`;
      } else {
        console.warn('Main progress bar not found');
      }
      
      // Stream progress container - check if it exists, create if not
      let streamProgressBar = document.querySelector('#streamProgress .progress-bar > div');
      const streamProgress = document.getElementById('streamProgress');
      
      if (!streamProgress) {
        console.log('Creating stream progress element...');
        // Create progress element if it doesn't exist
        const progressElem = document.createElement('div');
        progressElem.id = 'streamProgress';
        progressElem.className = 'progress-indicator';
        progressElem.style.display = 'flex';
        progressElem.style.margin = '10px 0';
        progressElem.innerHTML = `
          <div class="progress-bar" style="flex: 1; background: #f0f0f0; border-radius: 4px; overflow: hidden; height: 20px; margin-right: 10px;">
            <div style="height: 100%; width: ${percent}%; background: linear-gradient(90deg, #3498db, #2980b9); transition: width 0.3s ease;"></div>
          </div>
          <span class="progress-text" style="font-size: 14px; white-space: nowrap;">${percent}% (${this.stats.processedCount}/${this.stats.totalBundleIds})</span>
        `;
        
        // Insert into result container
        const resultElement = document.getElementById('result');
        if (resultElement) {
          const insertBefore = resultElement.querySelector('.results-table-container') || resultElement.firstChild;
          resultElement.insertBefore(progressElem, insertBefore);
          streamProgressBar = progressElem.querySelector('.progress-bar > div');
        }
      } else if (streamProgressBar) {
        console.log('Found stream progress bar, updating to', `${percent}%`);
        streamProgressBar.style.width = `${percent}%`;
        
        const streamPercentText = document.querySelector('#streamProgress .progress-text');
        if (streamPercentText) {
          streamPercentText.textContent = `${percent}% (${this.stats.processedCount}/${this.stats.totalBundleIds})`;
        }
      }
      
      // Various percentage indicators
      const progressPercentText = document.querySelector('.completion-percentage');
      if (progressPercentText) {
        progressPercentText.textContent = `${percent}%`;
      }
      
      // Counters
      const processedCounter = document.querySelector('.processed-counter .counter-value');
      if (processedCounter) {
        processedCounter.textContent = `${this.stats.processedCount} / ${this.stats.totalBundleIds}`;
      }
      
      const successCounter = document.querySelector('.success-counter .counter-value');
      if (successCounter) {
        successCounter.textContent = this.stats.successCount.toString();
      }
      
      const errorsCounter = document.querySelector('.errors-counter .counter-value');
      if (errorsCounter) {
        errorsCounter.textContent = this.stats.errorCount.toString();
      }
      
      const appAdsCounter = document.querySelector('.appAds-counter .counter-value');
      if (appAdsCounter) {
        appAdsCounter.textContent = this.stats.withAppAdsTxtCount.toString();
      }
      
      // Update summary stats
      const summaryStats = document.querySelector('.summary-stats');
      if (summaryStats) {
        summaryStats.innerHTML = `
          <span>Processing: <strong>${this.stats.processedCount}</strong>${
            this.stats.totalBundleIds > 0 ? ` / ${this.stats.totalBundleIds}` : ''
          }</span>
          <span class="success-count">Success: <strong>${this.stats.successCount}</strong></span>
          <span class="error-count">Errors: <strong>${this.stats.errorCount}</strong></span>
          <span class="app-ads-count">With app-ads.txt: <strong>${this.stats.withAppAdsTxtCount}</strong></span>
        `;
      }
    };
    
    try {
      // First try updating through visual indicators
      VisualIndicators.updateProgress({
        processed: this.stats.processedCount,
        success: this.stats.successCount,
        errors: this.stats.errorCount,
        withAppAds: this.stats.withAppAdsTxtCount,
        total: this.stats.totalBundleIds,
        startTime: this.stats.startTime
      });
    } catch (e) {
      console.warn('Error updating through visual indicators:', e);
    }
    
    // Then do direct DOM updates as a reliable backup
    try {
      // Schedule the update on the next animation frame for better performance
      requestAnimationFrame(updateDOM);
    } catch (err) {
      console.error('Error scheduling DOM update:', err);
      // Try immediate update as last resort
      try {
        updateDOM();
      } catch (finalErr) {
        console.error('Critical error during DOM update:', finalErr);
      }
    }
  }
  
  /**
   * Process a single result from the stream
   * @param {Object} result - Result object
   */
  _processResult(result) {
    // Update statistics
    this.stats.processedCount++;
    
    if (result.success) {
      this.stats.successCount++;
      if (result.appAdsTxt?.exists) {
        this.stats.withAppAdsTxtCount++;
      }
    } else {
      this.stats.errorCount++;
    }
    
    // Add to results array
    this.results.push(result);
    
    // Add to buffer for progressive rendering
    this.resultBuffer.push(result);
    
    // Create stats object for updates
    const statUpdate = {
      processed: this.stats.processedCount,
      success: this.stats.successCount,
      errors: this.stats.errorCount,
      withAppAds: this.stats.withAppAdsTxtCount,
      total: this.stats.totalBundleIds,
      startTime: this.stats.startTime
    };
    
    // Update visual indicators with error handling
    try {
      // Force UI update on each result during low progress
      const forceUpdate = this.stats.processedCount <= 10 || this.stats.processedCount % 5 === 0;
      
      if (forceUpdate) {
        console.log(`Updating visual indicator: ${this.stats.processedCount}/${this.stats.totalBundleIds}`);
        // Directly access DOM elements to ensure updates
        const progressBar = document.querySelector('.progress-bar');
        if (progressBar) {
          const percent = this.stats.totalBundleIds > 0 
            ? Math.min(100, Math.round((this.stats.processedCount / this.stats.totalBundleIds) * 100))
            : 0;
          const progressElem = progressBar.querySelector('div');
          if (progressElem) {
            progressElem.style.width = `${percent}%`;
          }
          
          const percentText = document.querySelector('.completion-percentage');
          if (percentText) {
            percentText.textContent = `${percent}%`;
          }
        }
      }
      
      VisualIndicators.updateProgress(statUpdate);
    } catch (e) {
      console.warn('Error updating visual indicators:', e);
      // Update fallback indicator instead
      this._updateFallbackIndicator(statUpdate);
    }
    
    // Update status message periodically
    if (this.stats.processedCount % 5 === 0) {
      const percent = this.stats.totalBundleIds > 0 
        ? Math.round((this.stats.processedCount / this.stats.totalBundleIds) * 100)
        : 0;
      
      try {
        VisualIndicators.setStatusMessage(
          `Processing... ${percent}% complete (${this.stats.processedCount} of ${this.stats.totalBundleIds})`,
          'info'
        );
      } catch (e) {
        console.warn('Error updating status message:', e);
      }
    }
    
    // Schedule rendering if not already in progress
    this._scheduleRender();
  }
  
  /**
   * Schedule a batched render operation using requestAnimationFrame
   */
  _scheduleRender() {
    // If already rendering or if buffer is empty, do nothing
    if (this.isRendering || this.resultBuffer.length === 0) {
      return;
    }
    
    const now = Date.now();
    
    // Check if we should render now (either first render or enough time has passed)
    if (this.lastRenderTime === 0 || (now - this.lastRenderTime) > this.renderThrottleTime) {
      this.isRendering = true;
      this.animationFrameId = requestAnimationFrame(() => this._renderResultsBatch());
    }
  }
  
  /**
   * Render a batch of results using a document fragment for efficiency
   */
  _renderResultsBatch() {
    const tbody = document.getElementById('results-tbody');
    const detailsContainer = document.getElementById('details-container');
    
    if (!tbody) {
      // If no tbody, clear buffer and return
      this.resultBuffer = [];
      this.isRendering = false;
      return;
    }
    
    // Create a document fragment for batch DOM updates
    const fragment = document.createDocumentFragment();
    const tempDiv = document.createElement('div');
    
    // Process all buffered results
    this.resultBuffer.forEach(result => {
      // Create row HTML
      const rowHtml = this._createResultRow(result);
      tempDiv.innerHTML = rowHtml;
      
      // Append row from temp div to fragment
      while (tempDiv.firstChild) {
        fragment.appendChild(tempDiv.firstChild);
      }
      
      // If detailed app-ads.txt info was provided, add to details container
      if (result.success && result.appAdsTxt?.exists && detailsContainer) {
        const detailsId = `app-ads-details-${this.results.indexOf(result) + 1}`;
        this._addAppAdsDetails(result, detailsId);
      }
    });
    
    // Update the DOM in a single operation
    tbody.appendChild(fragment);
    
    // Update progress UI
    this._updateProgressUI();
    
    // Clear buffer and reset rendering state
    this.resultBuffer = [];
    this.lastRenderTime = Date.now();
    this.isRendering = false;
    
    // Schedule next batch if there are more results
    if (this.resultBuffer.length > 0) {
      this.animationFrameId = requestAnimationFrame(() => this._renderResultsBatch());
    } else {
      this.animationFrameId = null;
    }
  }
  
  /**
   * Initialize the UI for streaming results
   * @param {boolean} hasSearchTerms - Whether search terms are present
   */
  _initializeResultsUI(hasSearchTerms) {
    const resultElement = DOMUtils.getElement('result');
    if (!resultElement) return;
    
    // Create initial structure
    resultElement.innerHTML = `
      <div class="results-summary">
        <div class="summary-stats">
          <span>Processing: <strong>0</strong></span>
          <span class="success-count">Success: <strong>0</strong></span>
          <span class="error-count">Errors: <strong>0</strong></span>
          <span class="app-ads-count">With app-ads.txt: <strong>0</strong></span>
        </div>
        <div class="action-buttons">
          <button class="download-btn" data-action="download-csv" disabled>Download Results</button>
        </div>
      </div>
      <div id="streamProgress" class="progress-indicator" style="display: flex;">
        <div class="progress-bar">
          <div style="width: 0%;"></div>
        </div>
        <span class="progress-text">0%</span>
      </div>
      <div class="results-table-container">
        <table class="results-table">
          <thead>
            <tr>
              <th scope="col">Bundle ID</th>
              <th scope="col">Store</th>
              <th scope="col">Domain</th>
              <th scope="col">App-ads.txt</th>
              ${hasSearchTerms ? '<th scope="col">Search Matches</th>' : ''}
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody id="results-tbody">
          </tbody>
        </table>
      </div>
      <div class="details-container" id="details-container"></div>
    `;
    
    // Show the result element
    resultElement.style.display = 'block';
  }
  
  /**
   * Update progress UI during streaming
   */
  _updateProgressUI() {
    // Update summary stats
    const summaryStats = document.querySelector('.summary-stats');
    if (summaryStats) {
      summaryStats.innerHTML = `
        <span>Processing: <strong>${formatNumber(this.stats.processedCount)}</strong>${
          this.stats.totalBundleIds > 0 ? ` / ${formatNumber(this.stats.totalBundleIds)}` : ''
        }</span>
        <span class="success-count">Success: <strong>${formatNumber(this.stats.successCount)}</strong></span>
        <span class="error-count">Errors: <strong>${formatNumber(this.stats.errorCount)}</strong></span>
        <span class="app-ads-count">With app-ads.txt: <strong>${formatNumber(this.stats.withAppAdsTxtCount)}</strong></span>
      `;
    }
    
    // Update progress bar
    const progressElement = document.getElementById('streamProgress');
    if (progressElement) {
      let percent;
      let statusText;
      
      // Calculate percentage based on total if available, otherwise use time-based estimate
      if (this.stats.totalBundleIds > 0) {
        percent = Math.round((this.stats.processedCount / this.stats.totalBundleIds) * 100);
        statusText = `${percent}% (${formatNumber(this.stats.processedCount)} of ${formatNumber(this.stats.totalBundleIds)})`;
      } else {
        // Fallback: Assume we don't know the total, so base percentage on time elapsed
        const elapsed = Date.now() - this.stats.startTime;
        // Estimate 100% after 60 seconds max
        percent = Math.min(95, Math.round((elapsed / 60000) * 100));
        statusText = `${formatNumber(this.stats.processedCount)} processed`;
      }
      
      // Calculate processing rate (items per second)
      const elapsed = (Date.now() - this.stats.startTime) / 1000; // in seconds
      const itemsPerSecond = elapsed > 0 ? this.stats.processedCount / elapsed : 0;
      
      // Estimate remaining time if we know total
      let remainingText = '';
      if (this.stats.totalBundleIds > 0 && itemsPerSecond > 0) {
        const remaining = this.stats.totalBundleIds - this.stats.processedCount;
        const remainingSecs = Math.round(remaining / itemsPerSecond);
        
        if (remainingSecs > 0) {
          remainingText = remainingSecs > 60 
            ? ` - est. ${Math.round(remainingSecs/60)} min remaining`
            : ` - est. ${remainingSecs} sec remaining`;
        }
      }
      
      const progressBar = progressElement.querySelector('.progress-bar > div');
      const progressText = progressElement.querySelector('.progress-text');
      
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (progressText) progressText.textContent = `${statusText}${remainingText}`;
      
      // Display progress element if it was hidden
      progressElement.style.display = 'flex';
    }
  }
  
  /**
   * Create a result row HTML
   * @param {Object} result - Result object
   * @returns {string} - HTML for table row
   */
  _createResultRow(result) {
    if (result.success) {
      const hasAppAds = result.appAdsTxt?.exists;
      const detailsId = hasAppAds ? `app-ads-details-${this.stats.processedCount}` : '';
      
      // Check if there are search matches
      const hasSearchMatches = hasAppAds && result.appAdsTxt.searchResults && 
                              result.appAdsTxt.searchResults.count > 0;
      const searchMatchCount = hasSearchMatches ? result.appAdsTxt.searchResults.count : 0;
      
      let html = `
        <tr class="success-row ${hasAppAds ? 'has-app-ads' : ''} ${hasSearchMatches ? 'has-search-matches' : ''}">
          <td>${DOMUtils.escapeHtml(result.bundleId)}</td>
          <td>${DOMUtils.escapeHtml(getStoreDisplayName(result.storeType))}</td>
          <td class="domain-cell">${DOMUtils.escapeHtml(result.domain || 'N/A')}</td>
          <td class="app-ads-cell">
      `;
      
      if (hasAppAds) {
        html += `
          <span class="app-ads-found">Found</span>
          <button class="toggle-app-ads" data-action="toggle-ads" data-target="${detailsId}" 
            type="button" aria-expanded="false" aria-controls="${detailsId}">
            Show app-ads.txt
          </button>
        `;
      } else {
        html += `<span class="app-ads-missing">Not found</span>`;
      }
      
      html += `</td>`;
      
      // Search matches cell if search terms provided
      if (this.searchTerms.length > 0) {
        html += `<td class="search-matches-cell">`;
        
        if (hasSearchMatches) {
          html += `<span class="search-matches-found">`;
          
          // For multi-term search, show color-coded indicators
          if (result.appAdsTxt.searchResults.termResults) {
            // Generate colored indicators for each term
            result.appAdsTxt.searchResults.termResults.forEach((termResult, termIndex) => {
              if (termResult.count > 0) {
                const colorClass = `term-match-${termIndex % 5}`;
                html += `<span class="term-match-indicator ${colorClass}">${termResult.count}</span> `;
              }
            });
          } else {
            // Fallback for single-term search
            html += `${searchMatchCount} matches`;
          }
          
          html += `</span>`;
          
          if (searchMatchCount > 0) {
            const targetId = `search-${detailsId}`;
            html += `
              <button class="toggle-search-matches" data-action="toggle-matches" data-target="${targetId}" 
                type="button" aria-expanded="false" aria-controls="${targetId}">
                Show matches
              </button>
            `;
          }
        } else {
          html += `<span class="search-matches-missing">No matches</span>`;
        }
        
        html += `</td>`;
      }
      
      // Actions cell
      html += `
        <td>
          <button class="table-copy-btn" data-action="copy" data-copy="${result.domain || ''}" 
            type="button" title="Copy domain to clipboard">Copy</button>
        </td>
      </tr>
      `;
      
      return html;
    } else {
      // Error row
      return `
        <tr class="error-row">
          <td>${DOMUtils.escapeHtml(result.bundleId)}</td>
          <td class="error-message" colspan="${this.searchTerms.length > 0 ? 4 : 3}">
            Error: ${DOMUtils.escapeHtml(result.error || 'Unknown error')}
          </td>
          <td></td>
        </tr>
      `;
    }
  }
  
  /**
   * Add app-ads.txt details to the details container
   * @param {Object} result - Result object
   * @param {string} [customDetailsId] - Custom details ID, if provided
   */
  _addAppAdsDetails(result, customDetailsId) {
    const detailsContainer = document.getElementById('details-container');
    if (!detailsContainer) return;
    
    const detailsId = customDetailsId || `app-ads-details-${this.stats.processedCount}`;
    
    // Limit content length for better performance
    const contentText = result.appAdsTxt.content && result.appAdsTxt.content.length > 10000 
      ? result.appAdsTxt.content.substring(0, 10000) + '...\n(truncated for performance)' 
      : (result.appAdsTxt.content || 'Content not available in streaming mode');
    
    // Create a document fragment for better performance
    const tempDiv = document.createElement('div');
    
    tempDiv.innerHTML = `
      <div id="${detailsId}" class="app-ads-details" style="display:none;">
        <h4>app-ads.txt for ${DOMUtils.escapeHtml(result.domain)}</h4>
        <div class="app-ads-url"><strong>URL:</strong> <a href="${DOMUtils.escapeHtml(result.appAdsTxt.url)}" target="_blank" rel="noopener noreferrer">${DOMUtils.escapeHtml(result.appAdsTxt.url)}</a></div>
        <div class="app-ads-stats">
          <strong>Stats:</strong> 
          ${result.appAdsTxt.analyzed.totalLines} lines, 
          ${result.appAdsTxt.analyzed.validLines} valid entries
        </div>
        <div class="app-ads-content">
          <pre>${DOMUtils.escapeHtml(contentText)}</pre>
        </div>
      </div>
    `;
    
    // Add search matches section if there are matches
    const hasSearchMatches = result.appAdsTxt.searchResults && 
                            result.appAdsTxt.searchResults.count > 0;
    
    if (hasSearchMatches) {
      // Create tabs for search results if multiple terms are available
      const hasMultipleTerms = result.appAdsTxt.searchResults.termResults && 
                              result.appAdsTxt.searchResults.termResults.length > 1;
      
      let tabsHtml = '<div class="search-matches-tabs" role="tablist">';
      let tabContentsHtml = '';
      
      // "All Matches" tab (always present)
      const allTabId = `all-${detailsId}`;
      tabsHtml += `<button class="search-tab active" data-action="tab-switch" data-tab="${allTabId}" role="tab" aria-selected="true" aria-controls="${allTabId}" id="tab-${allTabId}">All Matches</button>`;
      
      // Generate the all matches tab content
      const allMatchingLinesHtml = result.appAdsTxt.searchResults.matchingLines
        .slice(0, 100) // Limit to 100 matches for performance
        .map(line => `
          <tr>
            <td>${line.lineNumber}</td>
            <td class="search-match-content">${this._highlightSearchTerms(
              line.content, 
              result.appAdsTxt.searchResults.terms || this.searchTerms
            )}</td>
          </tr>
        `).join('');
      
      // Search terms legend
      const searchTermsForLegend = result.appAdsTxt.searchResults.terms || this.searchTerms;
      const legendHtml = this._generateSearchTermLegend(searchTermsForLegend);
      
      tabContentsHtml += `
        <div id="${allTabId}" class="search-tab-content active" role="tabpanel" aria-labelledby="tab-${allTabId}">
          <div class="search-matches-count">
            <strong>Total matches:</strong> ${result.appAdsTxt.searchResults.count}
            ${legendHtml}
          </div>
          <div class="search-matches-list">
            <table class="search-matches-table">
              <thead>
                <tr>
                  <th scope="col">Line #</th>
                  <th scope="col">Content</th>
                </tr>
              </thead>
              <tbody>
                ${allMatchingLinesHtml}
                ${result.appAdsTxt.searchResults.matchingLines.length > 100 ? 
                  `<tr><td colspan="2">(${result.appAdsTxt.searchResults.matchingLines.length - 100} more matches not shown for performance)</td></tr>` : ''}
              </tbody>
            </table>
          </div>
        </div>
      `;
      
      // Add per-term tabs if available
      if (hasMultipleTerms) {
        result.appAdsTxt.searchResults.termResults.forEach((termResult, termIndex) => {
          if (termResult.count > 0) {
            const termTabId = `term-${termIndex}-${detailsId}`;
            const colorClass = `term-match-${termIndex % 5}`;
            
            tabsHtml += `<button class="search-tab ${colorClass}" data-action="tab-switch" data-tab="${termTabId}" role="tab" aria-selected="false" aria-controls="${termTabId}" id="tab-${termTabId}">${DOMUtils.escapeHtml(termResult.term)}</button>`;
            
            // Generate the term-specific tab content
            const termMatchingLinesHtml = termResult.matchingLines
              .slice(0, 100) // Limit to 100 matches for performance
              .map(line => `
                <tr>
                  <td>${line.lineNumber}</td>
                  <td class="search-match-content">${this._highlightSearchTerms(
                    line.content, 
                    [termResult.term]
                  )}</td>
                </tr>
              `).join('');
            
            tabContentsHtml += `
              <div id="${termTabId}" class="search-tab-content" role="tabpanel" aria-labelledby="tab-${termTabId}" aria-hidden="true">
                <div class="search-matches-count">
                  <strong>Matches for "${DOMUtils.escapeHtml(termResult.term)}":</strong> ${termResult.count}
                </div>
                <div class="search-matches-list">
                  <table class="search-matches-table">
                    <thead>
                      <tr>
                        <th scope="col">Line #</th>
                        <th scope="col">Content</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${termMatchingLinesHtml}
                      ${termResult.matchingLines.length > 100 ? 
                        `<tr><td colspan="2">(${termResult.matchingLines.length - 100} more matches not shown for performance)</td></tr>` : ''}
                    </tbody>
                  </table>
                </div>
              </div>
            `;
          }
        });
      }
      
      tabsHtml += '</div>'; // Close tabs container
      
      tempDiv.innerHTML += `
        <div id="search-${detailsId}" class="search-matches-details" style="display:none;">
          <h4>Search Matches in ${DOMUtils.escapeHtml(result.domain)}</h4>
          ${tabsHtml}
          ${tabContentsHtml}
        </div>
      `;
    }
    
    // Add to details container using document fragment for better performance
    const fragment = document.createDocumentFragment();
    while (tempDiv.firstChild) {
      fragment.appendChild(tempDiv.firstChild);
    }
    
    detailsContainer.appendChild(fragment);
  }
  
  /**
   * Highlight search terms in text
   * @param {string} text - Text to highlight
   * @param {string[]} terms - Search terms
   * @returns {string} - Highlighted HTML
   */
  _highlightSearchTerms(text, terms) {
    if (!text || !terms || !terms.length) {
      return DOMUtils.escapeHtml(text);
    }
    
    let escapedText = DOMUtils.escapeHtml(text);
    
    // Create positions array to avoid overlapping highlights
    const positions = [];
    
    terms.forEach((term, termIndex) => {
      if (!term) return;
      
      const termLower = term.toLowerCase();
      let textLower = text.toLowerCase();
      let lastIndex = 0;
      let startIndex;
      
      while ((startIndex = textLower.indexOf(termLower, lastIndex)) !== -1) {
        positions.push({
          start: startIndex,
          end: startIndex + term.length,
          termIndex: termIndex % 5 // Limit to 5 different colors
        });
        
        lastIndex = startIndex + termLower.length;
      }
    });
    
    // Sort positions by start index (descending) to avoid index shifts during replacement
    positions.sort((a, b) => b.start - a.start);
    
    // Apply highlights
    positions.forEach(pos => {
      const before = escapedText.substring(0, pos.start);
      const match = escapedText.substring(pos.start, pos.end);
      const after = escapedText.substring(pos.end);
      
      escapedText = `${before}<span class="search-highlight term-match-${pos.termIndex}">${match}</span>${after}`;
    });
    
    return escapedText;
  }
  
  /**
   * Generate search term legend
   * @param {string[]} terms - Search terms
   * @returns {string} - HTML for search term legend
   */
  _generateSearchTermLegend(terms) {
    if (!terms || !terms.length) return '';
    
    let html = '<div class="search-terms-legend"><strong>Search terms:</strong> ';
    
    terms.forEach((term, index) => {
      const colorClass = `term-match-${index % 5}`;
      html += `<span class="search-highlight ${colorClass}">${DOMUtils.escapeHtml(term)}</span> `;
    });
    
    html += '</div>';
    return html;
  }
  
  /**
   * Finalize UI after streaming is complete
   */
  _finalizeUI() {
    // Update summary stats one last time
    this._updateProgressUI();
    
    // Hide progress indicator
    const progressElement = document.getElementById('streamProgress');
    if (progressElement) {
      progressElement.style.display = 'none';
    }
    
    // Enable download button
    const downloadBtn = document.querySelector('[data-action="download-csv"]');
    if (downloadBtn) {
      downloadBtn.disabled = false;
    }
    
    // Set results in app state
    AppState.setResults(this.results);
    
    // Complete visual indicators
    const processingTime = Date.now() - this.stats.startTime;
    VisualIndicators.complete({
      processed: this.stats.processedCount,
      success: this.stats.successCount,
      errors: this.stats.errorCount,
      withAppAds: this.stats.withAppAdsTxtCount,
      total: this.stats.totalBundleIds
    });
    
    // Format the time in a more readable format
    const timeInSeconds = processingTime / 1000;
    const timeDisplay = timeInSeconds >= 60 
      ? `${(timeInSeconds / 60).toFixed(1)} minutes`
      : `${timeInSeconds.toFixed(1)} seconds`;
    
    // Add final status message
    VisualIndicators.setStatusMessage(
      `Completed processing ${this.stats.processedCount} bundle IDs (${this.stats.errorCount} errors) in ${timeDisplay}`,
      'success'
    );
    
    // Show completion notification
    const message = `Completed processing ${this.stats.processedCount} bundle IDs (${this.stats.errorCount} errors) in ${timeDisplay}`;
    showNotification(message, 'success');
  }
  
  /**
   * Reset state for a new streaming job
   */
  resetState() {
    this.stats = {
      processedCount: 0,
      successCount: 0,
      errorCount: 0,
      withAppAdsTxtCount: 0,
      startTime: 0,
      totalBundleIds: 0,
      lastRenderTime: 0
    };
    
    this.results = [];
    this.searchTerms = [];
    this.resultBuffer = [];
    this.lastRenderTime = 0;
    this.isRendering = false;
    
    // Cancel any pending animation frame
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
  
  /**
   * Handle messages from the web worker
   * @param {Object} message - Message from worker
   */
  _handleWorkerMessage(message) {
    const { type, data } = message;
    
    switch (type) {
      case 'initialize':
        this._initializeResultsUI(data.hasSearchTerms);
        break;
        
      case 'progress':
        // Update stats from worker
        this.stats.processedCount = data.processedCount;
        this.stats.successCount = data.successCount;
        this.stats.errorCount = data.errorCount;
        this.stats.withAppAdsTxtCount = data.withAppAdsTxtCount;
        
        // Update visual indicators
        VisualIndicators.updateProgress({
          processed: this.stats.processedCount,
          success: this.stats.successCount,
          errors: this.stats.errorCount,
          withAppAds: this.stats.withAppAdsTxtCount,
          total: this.stats.totalBundleIds
        });
        
        // Update status message periodically
        if (this.stats.processedCount % 10 === 0) {
          const percent = this.stats.totalBundleIds > 0 
            ? Math.round((this.stats.processedCount / this.stats.totalBundleIds) * 100)
            : 0;
          
          VisualIndicators.setStatusMessage(
            `Worker processing... ${percent}% complete (${this.stats.processedCount} of ${this.stats.totalBundleIds})`,
            'info'
          );
        }
        
        // Update legacy UI
        this._updateProgressUI();
        
        // Update progress bar with percentage if provided
        if (data.percent) {
          const progressElement = document.getElementById('streamProgress');
          if (progressElement) {
            const progressBar = progressElement.querySelector('.progress-bar > div');
            const progressText = progressElement.querySelector('.progress-text');
            
            if (progressBar) progressBar.style.width = `${data.percent}%`;
            if (progressText) progressText.textContent = `${data.percent}%`;
          }
        }
        break;
        
      case 'result':
        // Process individual result
        if (data.result) {
          this._processResult(data.result);
        }
        break;
        
      case 'complete':
        // Store final results
        this.results = data.results || this.results;
        
        // Update final stats
        this.stats.processedCount = data.processedCount || this.stats.processedCount;
        this.stats.successCount = data.successCount || this.stats.successCount;
        this.stats.errorCount = data.errorCount || this.stats.errorCount;
        this.stats.withAppAdsTxtCount = data.withAppAdsTxtCount || this.stats.withAppAdsTxtCount;
        
        // Finalize UI
        this._finalizeUI();
        break;
        
      case 'error':
        console.error('Worker error:', data.message);
        showNotification(`Worker error: ${data.message}`, 'error');
        VisualIndicators.showError(`Worker error: ${data.message}`);
        break;
    }
  }
  
  /**
   * Export results to CSV via streaming
   * @param {string[]} bundleIds - Bundle IDs
   * @param {string[]} searchTerms - Search terms
   */
  async exportCsv(bundleIds, searchTerms = []) {
    if (!bundleIds || !bundleIds.length) {
      showNotification('No bundle IDs to export', 'error');
      return;
    }
    
    // Get the results container to show progress
    const resultElement = DOMUtils.getElement('result');
    if (!resultElement) return;
    
    try {
      // Initialize visual indicators for export
      VisualIndicators.initialize({
        totalItems: bundleIds.length,
        containerSelector: resultElement,
        showDetails: false,
        animate: true
      });
      
      // Set initial status message
      VisualIndicators.setStatusMessage('Preparing CSV export stream...', 'info');
      showNotification('Starting CSV export stream...', 'info');
      
      // Create a download link
      const downloadLink = document.createElement('a');
      downloadLink.href = `/api/stream/export-csv?ts=${Date.now()}`; // Add timestamp to prevent caching
      downloadLink.download = `developer_domains_${new Date().toISOString().slice(0, 10)}.csv`;
      downloadLink.style.display = 'none';
      
      // Update visual progress indicators
      VisualIndicators.updateProgress({
        processed: 0,
        total: bundleIds.length
      });
      VisualIndicators.setStatusMessage('Connecting to server...', 'info');
      
      // Set up fetch for streaming response
      const response = await fetch('/api/stream/export-csv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ bundleIds, searchTerms })
      });
      
      if (!response.ok) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }
      
      // Update progress indicators
      VisualIndicators.updateProgress({
        processed: Math.floor(bundleIds.length * 0.1), // Show some progress
        total: bundleIds.length
      });
      VisualIndicators.setStatusMessage('Processing data on server...', 'info');
      
      // Get the blob from the response
      const blob = await response.blob();
      
      // Update progress to 80%
      VisualIndicators.updateProgress({
        processed: Math.floor(bundleIds.length * 0.8),
        total: bundleIds.length
      });
      VisualIndicators.setStatusMessage('Creating download file...', 'info');
      
      // Create object URL for the blob
      const url = URL.createObjectURL(blob);
      
      // Update progress to 90%
      VisualIndicators.updateProgress({
        processed: Math.floor(bundleIds.length * 0.9),
        total: bundleIds.length
      });
      
      // Set the link's href to the object URL
      downloadLink.href = url;
      
      // Append link to body and trigger click
      document.body.appendChild(downloadLink);
      downloadLink.click();
      
      // Clean up
      setTimeout(() => {
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(url);
      }, 100);
      
      // Complete the indicators
      VisualIndicators.complete({
        processed: bundleIds.length,
        total: bundleIds.length
      });
      VisualIndicators.setStatusMessage('CSV export complete! Download starting...', 'success');
      
      showNotification('CSV export complete', 'success');
    } catch (err) {
      console.error('CSV export error:', err);
      showNotification(`Export error: ${err.message}`, 'error');
      VisualIndicators.showError(`Export error: ${err.message}`);
    }
  }
}

// Export singleton instance
const streamingProcessor = new StreamingProcessor();
export default streamingProcessor;