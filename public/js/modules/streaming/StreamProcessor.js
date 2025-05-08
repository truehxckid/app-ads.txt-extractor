/**
 * StreamProcessor Module
 * Core coordination and initialization for stream processing
 */

import AppState from '../app-state.js';
import DOMUtils from '../dom-utils.js';
import { showNotification } from '../../utils/notification.js';
import StreamProgressUI from './StreamProgressUI.js';
import StreamDataParser from './StreamDataParser.js';
import StreamResultsRenderer from './StreamResultsRenderer.js';

/**
 * Stream Processor Class
 * Handles the core streaming functionality
 */
class StreamProcessor {
  constructor() {
    this.initialized = false;
    this.worker = null;
    this.streamController = null;
    this.decoder = new TextDecoder();
    this._exportInProgress = false;
    
    // Use the imported singleton instances instead of creating new ones
    this.progressUI = StreamProgressUI;
    this.dataParser = StreamDataParser;
    this.resultsRenderer = StreamResultsRenderer;
    // Minimal no-op debugger
    this.debugger = {
      initialize: () => true,
      logStatus: () => {},
      logChunk: () => {},
      logError: (err) => console.error('Error:', err), // Keep error logging
      logConnectionInfo: () => {},
      logSummary: () => {},
      clear: () => {},
      close: () => {}
    };
    
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
    this.renderThrottleTime = 100; // ms between renders (reduced from 200ms for more frequent updates)
    this.isRendering = false;
    this.animationFrameId = null;
  }
  
  /**
   * Initialize the streaming processor
   * @returns {boolean} - Initialization success
   */
  initialize() {
    if (this.initialized) return true;
    
    // Check if browser supports streaming
    if (!window.ReadableStream || !window.TextDecoder) {
      console.warn('Browser does not support streaming, falling back to regular processing');
      return false;
    }
    
    // Ensure the components are properly initialized
    if (this.dataParser) {
      this.dataParser.setDecoder(this.decoder);
    } else {
      console.error('StreamProcessor: dataParser is not available!');
    }
    
    // Try to initialize web worker if supported
    try {
      if (window.Worker) {
        this.worker = new Worker('/js/workers/stream-worker.js');
        
        // Set up event listener for worker messages
        this.worker.onmessage = (e) => {
          this._handleWorkerMessage(e.data);
        };
        
        // Add error handler for worker errors
        this.worker.onerror = (error) => {
          console.error('Worker error:', error);
        };
      } else {
        console.warn('Web Workers not supported by browser');
      }
    } catch (err) {
      console.error('Failed to initialize streaming worker:', err);
    }
    
    // Create a debug element to verify initialization
    try {
      const debugElement = document.getElementById('debug-information') || document.getElementById('debugInfo');
      if (!debugElement) {
        const debugDiv = document.createElement('div');
        debugDiv.id = 'debug-information';
        debugDiv.style.cssText = 'background: #f7f7f7; border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 4px;';
        debugDiv.innerHTML = '<strong>Stream Processing Debug Info:</strong><br>Initialization successful';
        document.body.appendChild(debugDiv);
      }
    } catch (err) {
      console.error('Failed to create debug element:', err);
    }
    
    this.initialized = true;
    return true;
  }
  
  /**
   * Reset state for a new streaming job
   */
  reset() {
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
    this._exportInProgress = false;
    
    // Cancel any pending animation frame
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    // Reset UI components
    if (this.progressUI) {
      this.progressUI.clearIndicators();
    }
    
    if (this.resultsRenderer) {
      // Clear existing results elements thoroughly to prevent DOM conflicts
      const resultContainer = DOMUtils.getElement('result');
      if (resultContainer) {
        // Save any progress indicators that might be active
        const progressIndicator = resultContainer.querySelector('.visual-indicators-container');
        if (progressIndicator) {
          progressIndicator.remove(); // Remove it to add back fresh later
        }
        
        // Clear all results tables and other streaming elements
        const resultsTable = resultContainer.querySelector('.results-table-container');
        if (resultsTable) {
          resultsTable.remove();
        }
        
        // Remove elements more efficiently using combined selectors
        const indicatorsToRemove = [
          '.worker-processing-indicator',
          '.worker-indicator',
          '.streaming-mode-indicator', 
          '.streaming-info-banner'
        ].join(', ');
        
        const elementsToRemove = document.querySelectorAll(indicatorsToRemove);
        // Removing elements during state reset
        elementsToRemove.forEach(element => element.remove());
      }
    }
    
    // Terminate worker if active
    if (this.worker) {
      // Terminating existing worker for new job
      this.worker.terminate();
      this.worker = null;
    }
  }
  
  /**
   * Process bundle IDs using streaming
   * @param {string[]} bundleIds - Bundle IDs to process
   * @param {Object|string[]} searchParams - Search parameters with structured params
   * @returns {Promise<boolean>} - Success status
   */
  async processBundleIds(bundleIds, searchParams = null) {
    // Only use structured params in advanced mode
    let structuredParams = null;
    
    if (Array.isArray(searchParams)) {
      // Convert array of terms to structured parameters for backward compatibility
      structuredParams = searchParams.map(term => {
        return { domain: typeof term === 'string' ? term.trim() : term };
      });
    } else if (searchParams && typeof searchParams === 'object') {
      if (searchParams.structuredParams) {
        // Use advanced mode structured params
        // Ensure structuredParams is always an array for consistency
        if (Array.isArray(searchParams.structuredParams)) {
          structuredParams = searchParams.structuredParams;
        } else {
          // Convert single object to array with one item
          structuredParams = [searchParams.structuredParams];
        }
      }
    }
    
    // Store the advanced search params in AppState so they're available throughout
    if (AppState && typeof AppState.setAdvancedSearchParams === 'function') {
      AppState.setAdvancedSearchParams(structuredParams);
    } else {
      // If AppState doesn't have this method, store directly
      window.advancedSearchParams = structuredParams;
    }
    
    // First, remove any stray progress bars from previous exports or interruptions
    const extraProgressBars = document.querySelectorAll('.progress-indicator, #streamProgress');
    if (extraProgressBars.length > 0) {
      extraProgressBars.forEach(bar => {
        if (bar.parentNode) {
          bar.parentNode.removeChild(bar);
        }
      });
    }
    
    // Clear any existing UI elements from previous runs
    this._cleanupUIElements();
    
    // Initialize if not already
    if (!this.initialized) {
      if (!this.initialize()) {
        showNotification('Streaming not supported in this browser, using regular processing instead', 'warning');
        return false;
      }
    }
    
    // Ensure worker is terminated if it exists from a previous run
    if (this.worker) {
      // Terminate existing worker before starting new job
      this.worker.terminate();
      this.worker = null;
      
      // Small delay to ensure cleanup
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Reset state
    this.reset();
    this.stats.startTime = Date.now();
    this.stats.totalBundleIds = bundleIds.length;
    
    // Clear previous results only when starting a new extraction
    // This is different from downloadCSV where we want to keep results visible
    const resultElement = DOMUtils.getElement('result');
    if (resultElement) {
      const resultsDisplay = resultElement.querySelector('.stream-results-display');
      if (resultsDisplay) {
        resultsDisplay.style.display = 'none';
      }
    }
    
    // State initialized with bundle IDs count
    
    // Get result element and create initial UI
    const resultSection = DOMUtils.getElement('result');
    if (!resultSection) return false;
    
    // Make sure the result section is visible
    if (resultSection) {
      resultSection.style.display = 'block';
    }
    
    // Clear any existing "Sending request to server..." messages
    const existingProgressMessages = document.querySelectorAll('.progress-indicator');
    existingProgressMessages.forEach(element => {
      if (element.textContent && element.textContent.includes('Sending request')) {
        element.remove();
      }
    });
    
    // Initialize UI components
    this.resultsRenderer.initializeUI(resultSection, bundleIds.length, structuredParams && structuredParams.length > 0);
    
    // We'll just use the worker indicator now, so no need for separate progress UI
    console.log('Not initializing detailed progress UI, will use worker indicator only');
    
    // Just initialize the stats tracking without UI
    this.progressUI.stats = {
      total: bundleIds.length,
      processed: 0,
      success: 0,
      errors: 0,
      withAppAds: 0,
      startTime: Date.now()
    };
    
    try {
      // Force attempt to create a worker if not already initialized
      if (!this.worker && window.Worker) {
        try {
          this.worker = new Worker('/js/workers/stream-worker.js');
          
          // Set up event listener for worker messages
          this.worker.onmessage = (e) => {
            this._handleWorkerMessage(e.data);
          };
          
          // Add error handler for worker errors
          this.worker.onerror = (error) => {
            console.error('Worker error:', error);
            // Fall back to main thread if worker errors during setup
            this.worker = null;
          };
        } catch (workerError) {
          console.error('Worker initialization failed:', workerError);
          this.worker = null;
        }
      }
      
      // If worker is available and initialized, use it
      if (this.worker) {
        // Create visual indicator that worker is being used
        const workerIndicator = document.createElement('div');
        workerIndicator.className = 'worker-indicator';
        workerIndicator.style.cssText = 'position: fixed; bottom: 10px; left: 10px; background: #dcffe4; border: 1px solid #28a745; color: #28a745; padding: 5px 10px; border-radius: 4px; z-index: 9999; font-size: 12px;';
        workerIndicator.innerHTML = '⚙️ Using Web Worker';
        document.body.appendChild(workerIndicator);
        
        // Remove indicator after 5 seconds
        setTimeout(() => {
          if (workerIndicator.parentNode) {
            workerIndicator.parentNode.removeChild(workerIndicator);
          }
        }, 5000);
        
      // Send message to worker with structured parameters - ensure we're sending complete data
      this.worker.postMessage({
        type: 'processBundleIds',
        bundleIds,
        structuredParams: structuredParams,
        totalBundleIds: bundleIds.length,
        hasSearchTerms: false // Add this for backward compatibility
      });
        
        // Update debug information with worker status - check first if the message is already there
        const debugElement = document.getElementById('debug-information') || document.getElementById('debugInfo');
        if (debugElement && !debugElement.textContent.includes('Using Web Worker for processing')) {
          debugElement.innerHTML += `<br><strong style="color: green;">Using Web Worker for processing! (faster parallel processing)</strong>`;
        }
        
        // Worker handles the UI updates, so we just return
        return true;
      }
      
      // If no worker, process with main thread
      console.warn('No worker available, falling back to main thread processing');
      this.progressUI.setStatusMessage('Processing on main thread (slower)...', 'info');
      
      // Create visual indicator that main thread is being used
      const mainThreadIndicator = document.createElement('div');
      mainThreadIndicator.style.cssText = 'position: fixed; bottom: 10px; left: 10px; background: #fff3cd; border: 1px solid #ffc107; color: #664d03; padding: 5px 10px; border-radius: 4px; z-index: 9999; font-size: 12px;';
      mainThreadIndicator.innerHTML = '⚠️ Using Main Thread (slower)';
      document.body.appendChild(mainThreadIndicator);
      
      // Remove indicator after 5 seconds
      setTimeout(() => {
        if (mainThreadIndicator.parentNode) {
          mainThreadIndicator.parentNode.removeChild(mainThreadIndicator);
        }
      }, 5000);
      
      return await this._processBundleIdsMainThread(bundleIds, [], structuredParams);
    } catch (err) {
      return this._handleError(err, 'Streaming error', { showInUI: true });
    }
  }
  
  /**
   * Process bundle IDs using streaming on the main thread
   * @param {string[]} bundleIds - Bundle IDs to process
   * @param {string[]} searchTerms - Search terms (optional)
   * @param {Object} structuredParams - Structured search parameters (optional)
   * @returns {Promise<boolean>} - Success status
   * @private
   */
  async _processBundleIdsMainThread(bundleIds, searchTerms = [], structuredParams = null) {
    try {
      // Add a cache-busting parameter to avoid cached responses
      const timestamp = Date.now();
      
      // First clear any "Sending request to server..." message that might be displayed
      const progressIndicator = document.querySelector('.progress-indicator');
      if (progressIndicator && progressIndicator.textContent.includes('Sending request')) {
        progressIndicator.innerHTML = `
          <h3>Processing Your Request</h3>
          <p>Preparing to process ${bundleIds.length} bundle IDs</p>
        `;
      }
      
      // Create debug info in the UI
      const debugElement = document.getElementById('debug-information') || document.getElementById('debugInfo');
      
      // If debug element doesn't exist, create it
      if (!debugElement) {
        const debugInfoElement = document.createElement('div');
        debugInfoElement.id = 'debug-information';
        debugInfoElement.style.cssText = 'background: #f8f8f8; border: 1px solid #ddd; padding: 15px; margin: 20px 0; border-radius: 8px; font-family: monospace; white-space: pre-wrap; overflow: auto; max-height: 300px; display: block;';
        
        // Add to the page
        const container = document.querySelector('.container') || document.body;
        container.appendChild(debugInfoElement);
      }
      
      // Now get the element (should exist now) and update it
      const debugInfoElement = document.getElementById('debug-information') || document.getElementById('debugInfo');
      if (debugInfoElement) {
        debugInfoElement.innerHTML = `
          <strong>Stream Processing Debug Info:</strong><br>
          Current time: ${new Date().toLocaleTimeString()}<br>
          Bundle IDs: ${bundleIds.length}<br>
          Starting fetch request...
        `;
        debugInfoElement.style.display = 'block';
      }
      
      // Create debug panel
      this.debugger.initialize('Stream Debug');
      
      // Force UI update now that we have a stream
      this.progressUI.forceUpdate(this.stats);
      
      // Start streaming process with a shorter timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        // Fetch request timed out
        controller.abort();
      }, 60000); // 60 second timeout
      
      try {
        // Send API request
        
        // Update debug information
        const debugInfo = document.getElementById('debug-information') || document.getElementById('debugInfo');
        if (debugInfo) {
            debugInfo.innerHTML += '<br>Sending fetch request...';
        }
        
        // Import API from '../api.js' dynamically to avoid circular dependencies
        const ApiModule = await import('../api.js');
        const Api = ApiModule.default;
        
        // Using API.extractDomains which should redirect to streaming endpoint
        
        // Use the API module which will automatically redirect to streaming endpoint
        // if streaming is enabled in localStorage
        const apiResponse = await Api.extractDomains(bundleIds, [], 1, 20, structuredParams);
        
        // Check if we got a streaming response
        if (apiResponse.isStreaming && apiResponse.response) {
          // API returned a streaming response
          
          const response = apiResponse.response;
          
          // Fetch response received
          
          // Clear the timeout since we got a response
          clearTimeout(timeoutId);
          
          // Add debug info
          this.debugger.logConnectionInfo(response);
          
          if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
          }
          
          if (!response.body) {
            throw new Error('ReadableStream not supported in this browser');
          }
          
          // Process the stream with debug mode
          await this.dataParser.processStream(
            response.body, 
            this._processResult.bind(this),
            this.debugger,
            this.progressUI
          );
          
          // Update the UI when complete
          this._finalizeUI();
          
          return true;
        } else {
          // We got a regular JSON response, not a streaming response
          // Api.extractDomains did not return streaming response
          throw new Error('Api.extractDomains did not return a streaming response. Check localStorage "streamingEnabled" setting.');
        }
        
        // Legacy code path - direct fetch to streaming endpoint
        // This is a fallback in case the Api.extractDomains approach doesn't work
        // Fallback: Using direct streaming API endpoint
        
        // Use the streaming endpoint directly as a fallback
        const response = await fetch(`/api/stream/extract-multiple?nocache=${timestamp}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Debug-Mode': 'true',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          },
          body: JSON.stringify({ 
            bundleIds, 
            structuredParams 
          }),
          signal: controller.signal
        });
        
        // Fallback fetch response received
        
        // Clear the timeout since we got a response
        clearTimeout(timeoutId);
        
        // Add debug info
        this.debugger.logConnectionInfo(response);
        
        if (!response.ok) {
          throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
        if (!response.body) {
          throw new Error('ReadableStream not supported in this browser');
        }
        
        // Process the stream with debug mode
        await this.dataParser.processStream(
          response.body, 
          this._processResult.bind(this),
          this.debugger,
          this.progressUI
        );
        
        // Update the UI when complete
        this._finalizeUI();
        
        return true;
      } catch (err) {
        // Update debug div with error
        this.debugger.logError(err);
        
        return this._handleError(err, 'Stream processing error', { showInUI: true });
      }
    } catch (err) {
      this.debugger.logError(err);
      return this._handleError(err, 'Main thread streaming error', { showInUI: true });
    }
  }
  
  /**
   * Process a single result from the stream
   * @param {Object} result - Result object
   * @private
   */
  _processResult(result) {
    if (!result || !result.bundleId) {
      console.error('Error: Invalid result object received');
      return;
    }
    
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
    
    // Update progress UI
    const stats = {
      processed: this.stats.processedCount,
      success: this.stats.successCount,
      errors: this.stats.errorCount,
      withAppAds: this.stats.withAppAdsTxtCount,
      total: this.stats.totalBundleIds,
      startTime: this.stats.startTime
    };
    
    // Update the progress UI
    this.progressUI.updateProgress(stats);
    
    // Also update the results summary in StreamResultsRenderer
    if (this.resultsRenderer && typeof this.resultsRenderer.updateSummaryStats === 'function') {
      this.resultsRenderer.updateSummaryStats(stats);
    }
    
    // Dispatch a progress update event to synchronize all UI components
    // Use throttling to avoid too many events
    const now = Date.now();
    if (!this._lastProgressUpdateTime || (now - this._lastProgressUpdateTime) > 500) {
      window.dispatchEvent(new CustomEvent('streaming-progress-update', {
        detail: { 
          stats: stats,
          source: 'processResult',
          timestamp: now
        }
      }));
      this._lastProgressUpdateTime = now;
    }
    
    // Update status message periodically
    if (this.stats.processedCount % 5 === 0) {
      const percent = this.stats.totalBundleIds > 0 
        ? Math.round((this.stats.processedCount / this.stats.totalBundleIds) * 100)
        : 0;
      
      this.progressUI.setStatusMessage(
        `Processing... ${percent}% complete (${this.stats.processedCount} of ${this.stats.totalBundleIds})`,
        'info'
      );
    }
    
    // Schedule rendering if not already in progress
    this._scheduleRender();
  }
  
  /**
   * Schedule a batched render operation using requestAnimationFrame
   * @private
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
      this.animationFrameId = requestAnimationFrame(() => {
        this.resultsRenderer._renderBatch(this.resultBuffer, []);
        
        // Update progress UI
        this.progressUI.updateProgress(this.stats);
        
        // Save the current buffer length before clearing it
        const hadResults = this.resultBuffer.length > 0;
        
        // Log rendering operation
        // Rendered batch of results
        
        // Clear buffer and reset rendering state
        this.resultBuffer = [];
        this.lastRenderTime = Date.now();
        this.isRendering = false;
        
        // Force a check for more results (not relying on the now-empty buffer)
        this.animationFrameId = null;
        
        // Re-check for new results after a short delay to allow batch processing
        setTimeout(() => {
          if (this._processResult) this._scheduleRender();
        }, 100);
      });
    }
  }
  
  /**
   * Finalize UI after streaming is complete
   * @private
   */
  _finalizeUI() {
    // Enable download button - using direct query since this is not cached elsewhere
    const downloadBtn = document.querySelector('[data-action="download-csv"]');
    if (downloadBtn) {
      downloadBtn.disabled = false;
    }
    
    // Set results in app state
    AppState.setResults(this.results);
    
    // Calculate elapsed time
    const processingTime = Date.now() - this.stats.startTime;
    const stats = {
      processed: this.stats.processedCount,
      success: this.stats.successCount,
      errors: this.stats.errorCount,
      withAppAds: this.stats.withAppAdsTxtCount,
      total: this.stats.totalBundleIds,
      elapsedTime: processingTime
    };
    
    // Remove ALL progress UI elements more efficiently with a single selector
    const progressSelectors = [
      '.visual-indicators-container', 
      '.stats-container', 
      '.progress-bar-container', 
      '.counter', 
      '.rate-indicator', 
      '.time-remaining', 
      '.progress-indicator', 
      '#streamProgress'
    ].join(', ');
    
    const allProgressElements = document.querySelectorAll(progressSelectors);
    console.log(`⚡ StreamProcessor: Removing ${allProgressElements.length} progress elements`);
    allProgressElements.forEach(element => {
      if (element && element.parentNode) {
        element.parentNode.removeChild(element);
      }
    });
    
    // Check and remove worker messages more efficiently
    const workerMessageSelectors = ['#debug-information', '#debugInfo', '.debug-info'].join(', ');
    const workerMessages = document.querySelectorAll(workerMessageSelectors);
    
    // Create a list of elements to remove, then remove them all at once
    const messagesToRemove = [];
    workerMessages.forEach(element => {
      // Only add it to the removal list if it contains the worker message
      if (element && element.textContent && element.textContent.includes('Using Web Worker for processing')) {
        messagesToRemove.push(element);
      }
    });
    
    // Now remove all collected elements
    console.log(`⚡ StreamProcessor: Removing ${messagesToRemove.length} worker message elements`);
    messagesToRemove.forEach(element => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    });
    
    // Update completion status in the StreamResultsRenderer - this will create the completion banner
    if (this.resultsRenderer && typeof this.resultsRenderer._updateCompletionStatus === 'function') {
      this.resultsRenderer._updateCompletionStatus(stats);
    }
    
    // Hide any worker progress indicators - use DOMUtils since this is repeatedly accessed
    const workerIndicator = document.querySelector('.worker-processing-indicator');
    if (workerIndicator) {
      console.log('⚡ StreamProcessor: Hiding worker processing indicator');
      workerIndicator.style.display = 'none';
    }
    
    // Format the time in a more readable format
    const timeInSeconds = processingTime / 1000;
    const timeDisplay = timeInSeconds >= 60 
      ? `${(timeInSeconds / 60).toFixed(1)} minutes`
      : `${timeInSeconds.toFixed(1)} seconds`;
    
    // Add final status message
    this.progressUI.setStatusMessage(
      `Completed processing ${this.stats.processedCount} bundle IDs (${this.stats.errorCount} errors) in ${timeDisplay}`,
      'success'
    );
    
    // Show completion notification
    const message = `Completed processing ${this.stats.processedCount} bundle IDs (${this.stats.errorCount} errors) in ${timeDisplay}`;
    showNotification(message, 'success');
    
    // Reset processing state in AppState
    if (window.AppState && typeof window.AppState.setProcessing === 'function') {
      window.AppState.setProcessing(false);
    }
    
    // Hide any remaining "Processing..." indicators with a combined query
    const processingIndicatorSelectors = ['.processing-indicator', '[data-status="processing"]'].join(', ');
    const processingIndicators = document.querySelectorAll(processingIndicatorSelectors);
    processingIndicators.forEach(indicator => {
      if (indicator.style) {
        indicator.style.display = 'none';
      }
    });
    
    // Enable extract button - use DOMUtils for cached access
    const extractBtn = DOMUtils.getElement('extractBtn');
    if (extractBtn) {
      extractBtn.disabled = false;
      extractBtn.textContent = 'Extract All Developer Domains';
    }
    
    // Dispatch a "complete" event for other parts of the application to respond to
    window.dispatchEvent(new CustomEvent('streaming-processing-complete', {
      detail: { stats, timestamp: Date.now() }
    }));
  }
  
  /**
   * Handle messages from the web worker
   * @param {Object} message - Message from worker
   * @private
   */
  _handleWorkerMessage(message) {
    const { type, data } = message;
    
    switch (type) {
      case 'initialize':
        // Initialize UI if needed
        if (!document.getElementById('results-tbody')) {
          this.resultsRenderer.initializeUI(null, data.totalBundleIds || this.stats.totalBundleIds, data.hasSearchTerms || false);
        }
        break;
        
      case 'progress':
        // Update stats from worker with safeguards for undefined values
        this.stats.processedCount = typeof data.processedCount === 'number' ? data.processedCount : 0;
        this.stats.successCount = typeof data.successCount === 'number' ? data.successCount : 0;
        this.stats.errorCount = typeof data.errorCount === 'number' ? data.errorCount : 0;
        this.stats.withAppAdsTxtCount = typeof data.withAppAdsTxtCount === 'number' ? data.withAppAdsTxtCount : 0;
        
        // Calculate percentage to ensure we always have a valid number, not NaN
        if (typeof this.stats.totalBundleIds === 'number' && this.stats.totalBundleIds > 0) {
          data.percent = Math.min(100, Math.round((this.stats.processedCount / this.stats.totalBundleIds) * 100));
        } else {
          data.percent = 0; // Default to 0% if we can't calculate
        }
        
        // Process progress update from worker
        
        try {
          // Update progress UI with error handling
          // Add any percent value from the worker to our stats object
          if (typeof data.percent === 'number') {
            this.stats.percent = data.percent;
          }
          
          // Always set both total and processed for consistent reporting
          this.stats.total = this.stats.totalBundleIds;
          this.stats.processed = this.stats.processedCount;
          
          // Double-check that we have valid numbers to avoid NaN
          if (typeof this.stats.total !== 'number' || isNaN(this.stats.total)) {
            this.stats.total = 0;
          }
          
          if (typeof this.stats.processed !== 'number' || isNaN(this.stats.processed)) {
            this.stats.processed = 0;
          }
          
          this.progressUI.updateProgress(this.stats);
          
          // Dispatch a progress update event to synchronize the UI components
          window.dispatchEvent(new CustomEvent('streaming-progress-update', {
            detail: { 
              stats: this.stats,
              timestamp: Date.now()
            }
          }));
        } catch (err) {
          // Log non-critical UI error without notifying user or affecting processing
          console.warn('Error updating progress UI:', err);
        }
        
        try {
          // Also update the results summary in StreamResultsRenderer
          if (this.resultsRenderer && typeof this.resultsRenderer.updateSummaryStats === 'function') {
            this.resultsRenderer.updateSummaryStats(this.stats);
          }
        } catch (err) {
          // Log non-critical UI error without notifying user or affecting processing
          console.warn('Error updating results summary:', err);
        }
        
        // Update status message periodically
        if (this.stats.processedCount % 10 === 0) {
          const percent = this.stats.totalBundleIds > 0 
            ? Math.round((this.stats.processedCount / this.stats.totalBundleIds) * 100)
            : 0;
          
          try {
            this.progressUI.setStatusMessage(
              `⚙️ Worker processing... ${percent}% complete (${this.stats.processedCount} of ${this.stats.totalBundleIds})`,
              'info'
            );
          } catch (err) {
            // Log non-critical UI error without notifying user or affecting processing
            console.warn('Error updating status message:', err);
          }
        }
        break;
        
      case 'result':
        // Process individual result
        if (data.result) {
          // Add directly to results array - bypassing buffer since worker has its own batching
          this.results.push(data.result);
          
          // Use special direct render method for worker results
          // to avoid double-counting stats
          if (this.resultsRenderer) {
            this.resultsRenderer._renderBatch([data.result], []);
          }
        }
        break;
        
      case 'complete':
        // Store final results if provided
        if (data.results && Array.isArray(data.results)) {
          this.results = data.results;
          if (this.results.length === 0) {
            console.warn('No results received from worker');
          }
        }
        
        // Update final stats
        this.stats.processedCount = data.processedCount || this.stats.processedCount;
        this.stats.successCount = data.successCount || this.stats.successCount;
        this.stats.errorCount = data.errorCount || this.stats.errorCount;
        this.stats.withAppAdsTxtCount = data.withAppAdsTxtCount || this.stats.withAppAdsTxtCount;
        
        // Finalize UI
        this._finalizeUI();
        
        // Create completion indicator
        const completeIndicator = document.createElement('div');
        completeIndicator.style.cssText = 'position: fixed; bottom: 10px; left: 10px; background: #dcffe4; border: 1px solid #28a745; color: #28a745; padding: 5px 10px; border-radius: 4px; z-index: 9999; font-size: 12px;';
        completeIndicator.innerHTML = '✅ Worker processing complete!';
        document.body.appendChild(completeIndicator);
        
        // Remove indicator after 5 seconds
        setTimeout(() => {
          if (completeIndicator.parentNode) {
            completeIndicator.parentNode.removeChild(completeIndicator);
          }
        }, 5000);
        
        // Terminate the worker since we're completely done with it
        if (this.worker) {
          try {
            this.worker.terminate();
            this.worker = null;
          } catch (err) {
            console.error('Error terminating worker:', err);
          }
        }
        
        break;
        
      case 'error':
        // Handle worker error with our standardized error handler
        this._handleError(new Error(data.message), 'Worker error');
        
        // Try to fall back to main thread if worker fails
        try {
          // Log attempt to fall back (no user notification needed)
          console.warn('Worker failed, attempting fallback to main thread');
          this._processBundleIdsMainThread(this.stats.bundleIds || [], [], structuredParams);
        } catch (fallbackError) {
          // Handle fallback error with our standardized error handler
          this._handleError(fallbackError, 'Main thread fallback error');
        }
        break;
        
      default:
        console.warn('Unknown worker message type:', type);
    }
  }
  
  /**
   * Clear all processing indicators and related DOM elements from previous runs
   * @private
   */
  _cleanupUIElements() {
    
    // Get the result container using DOMUtils for caching
    const resultElement = DOMUtils.getElement('result');
    if (!resultElement) return;
    
    // Clear progress indicators
    if (this.progressUI) {
      this.progressUI.clearIndicators();
    }
    
    // Remove all visual indicators and processing elements
    const elementsToRemove = [
      '.progress-indicator', 
      '.visual-indicators-container',
      '.streaming-info-banner',
      '.worker-processing-indicator',
      '.processing-indicator',
      '.streaming-mode-indicator',
      '.streaming-confirmation',
      '.completion-banner',
      '.streaming-completion-banner',
      '#streamProgress'
    ];
    
    // Create a combined selector for a single query - more efficient
    const combinedSelector = elementsToRemove.join(', ');
    const elements = document.querySelectorAll(combinedSelector);
    // Remove all matched elements using the more efficient Element.remove()
    elements.forEach(element => element.remove());
    
    // Keep the results display visible during export
    
    // Clear any processing messages with a more efficient approach
    const staticIndicators = resultElement.querySelectorAll(':not(.stream-results-display)');
    
    // Build a list first, then remove all together (more efficient than removing during iteration)
    const indicatorsToRemove = [];
    staticIndicators.forEach(element => {
      if (element.textContent && (
          element.textContent.includes('Processing') || 
          element.textContent.includes('Sending request') ||
          element.textContent.includes('Worker'))) {
        indicatorsToRemove.push(element);
      }
    });
    
    // Now remove all at once
    indicatorsToRemove.forEach(element => element.remove());
  }
  
  /**
   * Export results to CSV via client-side processing (faster, no server overhead)
   * @param {string[]} bundleIds - Bundle IDs
   * @param {Object|string[]} searchParams - Search parameters object or legacy search terms
   * @description PREFERRED METHOD - This is the primary and recommended CSV export function.
   * It performs all processing client-side, avoiding extra server requests and
   * supporting all advanced features including structured search parameters.
   */
  async exportResultsAsCsv(bundleIds, searchParams = {}) {
    // Global export tracking timestamp - use a window property to synchronize between modules
    const now = Date.now();
    
    // Set global timestamp here to prevent duplicate exports between modules
    // EventHandler checks but doesn't set this so we avoid double-check issues
    window._lastGlobalExportTime = now; // Set timestamp here first
    this._exportInProgress = true;
    this._lastExportTime = now;
    
    if (!bundleIds || !bundleIds.length) {
      showNotification('No bundle IDs to export', 'error');
      return;
    }
    
    // Parse search parameters based on type
    let structuredParams = null;
    // Extract structured search parameters
    if (searchParams && typeof searchParams === 'object' && searchParams.structuredParams) {
      structuredParams = searchParams.structuredParams;
      
      // Ensure structuredParams is an array
      if (!Array.isArray(structuredParams)) {
        structuredParams = [structuredParams];
      }
    }
    
    // Prepare export parameters
    
    // Get the results container to show progress
    const resultElement = DOMUtils.getElement('result');
    if (!resultElement) return;
    
    try {
      // First clear any existing UI elements to prevent duplication
      this._cleanupUIElements();
      
      // Initialize visual indicators for export
      this.progressUI.initialize({
        totalItems: bundleIds.length,
        container: resultElement,
        showDetails: false,
        animate: true
      });
      
      // Set initial status message
      this.progressUI.setStatusMessage('Preparing CSV export...', 'info');
      showNotification('Starting CSV export...', 'info');
      
      // Update progress indicators
      this.progressUI.updateProgress({
        processed: 0,
        total: bundleIds.length
      });
      
      // Get the existing results
      const fullResults = window.AppState?.results || this.results || [];
      // Using existing results for client-side CSV generation
      
      // Create CSV header
      let csvContent = "Bundle ID,Store,Domain,Has App-Ads.txt,App-Ads.txt URL,Advanced Search Results,Match Count,Matching Lines,Success,Error\n";
      
      // Update progress to indicate we've started
      this.progressUI.updateProgress({
        processed: Math.floor(bundleIds.length * 0.1),
        total: bundleIds.length
      });
      this.progressUI.setStatusMessage('Generating CSV data...', 'info');
      
      // Process in batches to avoid freezing the UI
      const BATCH_SIZE = 100; // Process 100 results at a time
      const totalBatches = Math.ceil(fullResults.length / BATCH_SIZE);
      
      for (let i = 0; i < totalBatches; i++) {
        const start = i * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, fullResults.length);
        const batch = fullResults.slice(start, end);
        
        // Process this batch
        for (const result of batch) {
          csvContent += this._formatResultAsCsvRow(result, structuredParams);
        }
        
        // Update progress (scale from 10% to 80%)
        const progress = 0.1 + (0.7 * (i + 1) / totalBatches);
        this.progressUI.updateProgress({
          processed: Math.floor(bundleIds.length * progress),
          total: bundleIds.length
        });
        
        // Allow UI to update before processing next batch
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      
      // Create blob from CSV content
      const timestamp = Date.now();
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      
      // Create download link
      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.download = `developer_domains_${new Date().toISOString().slice(0, 10)}.csv`;
      downloadLink.style.display = 'none';
      downloadLink.id = `csv-download-${timestamp}`;
      
      this.progressUI.updateProgress({
        processed: Math.floor(bundleIds.length * 0.9),
        total: bundleIds.length
      });
      this.progressUI.setStatusMessage('Creating download file...', 'info');
      
      // Update progress to 90%
      this.progressUI.updateProgress({
        processed: Math.floor(bundleIds.length * 0.9),
        total: bundleIds.length
      });
      
      // Set the link's href to the object URL
      downloadLink.href = url;
      
      // Append link to body and trigger click
      document.body.appendChild(downloadLink);
      
      // Use a timeout to ensure we don't trigger downloads too quickly
      setTimeout(() => {
        // Verify the link still exists (wasn't already clicked)
        if (document.getElementById(`csv-download-${timestamp}`)) {
          downloadLink.click();
          
          // Clean up
          setTimeout(() => {
            if (document.getElementById(`csv-download-${timestamp}`)) {
              document.body.removeChild(downloadLink);
            }
            URL.revokeObjectURL(url);
          }, 1000);
        }
      }, 500);
      
      // Complete the indicators
      this.progressUI.complete({
        processed: bundleIds.length,
        total: bundleIds.length
      });
      this.progressUI.setStatusMessage('CSV export complete! Download starting...', 'success');
      
      // Clear status message after a delay
      setTimeout(() => {
        // Hide the progress indicators container
        if (this.progressUI) {
          const container = document.querySelector('.visual-indicators-container');
          if (container && container.parentNode) {
            container.parentNode.removeChild(container);
          }
          
          // Clear any status messages
          const statusMessages = document.querySelectorAll('.status-message');
          statusMessages.forEach(message => {
            if (message.parentNode) {
              message.parentNode.removeChild(message);
            }
          });
        }
        
        // Clear the global export timestamp after UI cleanup is complete
        window._lastGlobalExportTime = null;
        this._lastExportTime = null;
        this._exportInProgress = false;
        // Export state cleared, ready for next export
      }, 3000);
      
      showNotification('CSV export complete', 'success');
    } catch (err) {
      // Handle export error
      this._handleError(err, 'CSV export error');
      
      // Clean up any dangling download elements
      const downloadElements = document.querySelectorAll('[id^="csv-download-"]');
      downloadElements.forEach(el => {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
      
      // Reset both local and global export timestamps and flags on error
      this._lastExportTime = null;
      window._lastGlobalExportTime = null;
      this._exportInProgress = false;
    }
  }
  /**
   * Format a result object as a CSV row
   * @param {Object} result - The result object
   * @param {Array} structuredParams - Advanced search parameters
   * @returns {string} - CSV row
   * @private
   */
  _formatResultAsCsvRow(result, structuredParams) {
    if (!result) return '';
    
    // Helper function to escape CSV fields
    const escapeCSV = (field) => {
      if (field === null || field === undefined) return '';
      const str = String(field);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    
    // Extract basic data
    const hasAppAds = result.success && (result.hasAppAds || result.appAdsTxt?.exists);
    const store = result.storeType ? this._formatStoreDisplayName(result.storeType) : '';
    const domain = result.domain || '';
    const appAdsTxtUrl = hasAppAds && result.appAdsTxt?.url ? result.appAdsTxt.url : '';
    const success = result.success ? 'Yes' : 'No';
    const error = result.error || '';
    
    // Process advanced search results
    let advancedSearchInfo = '';
    let matchCount = '0';
    let matchingLinesSummary = '';
    
    // Check if we have structured params (advanced search)
    const isAdvancedSearch = structuredParams && (
      Array.isArray(structuredParams) ? structuredParams.length > 0 : 
      (typeof structuredParams === 'object' && Object.keys(structuredParams).length > 0)
    );
    
    // Always include search parameters for advanced search
    if (isAdvancedSearch) {
      const params = Array.isArray(structuredParams) ? structuredParams[0] : structuredParams;
      let searchDescription = '';
      if (params.domain) searchDescription += `${params.domain}`;
      if (params.publisherId) searchDescription += `${searchDescription ? " | " : ""}publisherId: ${params.publisherId}`;
      if (params.relationship) searchDescription += `${searchDescription ? " | " : ""}rel: ${params.relationship}`;
      if (params.tagId) searchDescription += `${searchDescription ? " | " : ""}tagId: ${params.tagId}`;
      advancedSearchInfo = searchDescription || "Advanced search";
    }
    
    // Check for matching search results
    if (hasAppAds && result.appAdsTxt?.searchResults) {
      const searchResults = result.appAdsTxt.searchResults;
      
      // Process match count
      matchCount = String(searchResults.count || 0);
      
      // Process matching lines
      if (searchResults.termResults && searchResults.termResults.length > 0) {
        matchingLinesSummary = searchResults.termResults
          .map(tr => {
            if (tr.matches && tr.matches.length > 0) {
              return `${tr.term}: ${tr.matches.join(', ')}`;
            }
            return tr.term;
          })
          .join(' | ');
      }
    }
    
    // Also check for matchInfo format (used in some implementations)
    if (result.matchInfo) {
      if (typeof result.matchInfo.count !== 'undefined') {
        matchCount = String(result.matchInfo.count);
      }
      
      if (result.matchInfo.termResults && result.matchInfo.termResults.length > 0) {
        matchingLinesSummary = result.matchInfo.termResults
          .map(tr => {
            if (tr.matches && tr.matches.length > 0) {
              return `${tr.term}: ${tr.matches.join(', ')}`;
            }
            return tr.term;
          })
          .join(' | ');
      }
    }
    
    // Last resort - if structured params exists but no matching info was found,
    // add placeholder data to ensure columns appear
    if (isAdvancedSearch && !advancedSearchInfo) {
      const params = Array.isArray(structuredParams) ? structuredParams[0] : structuredParams;
      let searchDescription = '';
      if (params.domain) searchDescription += `${params.domain}`;
      if (params.publisherId) searchDescription += `${searchDescription ? " | " : ""}publisherId: ${params.publisherId}`;
      if (params.relationship) searchDescription += `${searchDescription ? " | " : ""}rel: ${params.relationship}`;
      if (params.tagId) searchDescription += `${searchDescription ? " | " : ""}tagId: ${params.tagId}`;
      advancedSearchInfo = searchDescription || "Advanced search parameters";
    }
    
    // Build and return CSV row
    return [
      escapeCSV(result.bundleId),
      escapeCSV(store),
      escapeCSV(domain),
      hasAppAds ? 'Yes' : 'No',
      escapeCSV(appAdsTxtUrl),
      escapeCSV(advancedSearchInfo),
      matchCount,
      escapeCSV(matchingLinesSummary),
      success,
      escapeCSV(error)
    ].join(',') + '\n';
  }

  /**
   * Standardized error handling method
   * @param {Error} error - The error that occurred
   * @param {string} context - Context description for the error
   * @param {Object} options - Additional options for error handling
   * @param {boolean} options.logToConsole - Whether to log to console (default: true)
   * @param {boolean} options.showNotification - Whether to show UI notification (default: true)
   * @param {boolean} options.showInUI - Whether to show in result area (default: false)
   * @param {boolean} options.updateProgressUI - Whether to update progress UI (default: true)
   * @returns {boolean} Always returns false to indicate error
   * @private
   */
  _handleError(error, context = 'Error', options = {}) {
    // Set default options
    const settings = {
      logToConsole: true,
      showNotification: true,
      showInUI: false,
      updateProgressUI: true,
      ...options
    };
    
    // Format error message
    const errorMessage = `${context}: ${error.message || String(error)}`;
    
    // Log to console if enabled
    if (settings.logToConsole) {
      console.error(errorMessage, error);
    }
    
    // Show notification if enabled
    if (settings.showNotification) {
      showNotification(errorMessage, 'error');
    }
    
    // Show in result area if enabled
    if (settings.showInUI) {
      DOMUtils.showError('result', errorMessage);
    }
    
    // Update progress UI if enabled
    if (settings.updateProgressUI && this.progressUI) {
      this.progressUI.showError(errorMessage);
    }
    
    // Reset processing state in AppState
    AppState.setProcessing(false);
    
    // Always return false to indicate error
    return false;
  }
  
  /**
   * Helper to get store display name
   * @param {string} storeType - Store type code
   * @returns {string} - Store display name
   * @private
   */
  _formatStoreDisplayName(storeType) {
    const storeMap = {
      'googleplay': 'Google Play',
      'appstore': 'App Store',
      'amazon': 'Amazon',
      'huawei': 'Huawei',
      'samsung': 'Samsung'
    };
    return storeMap[storeType.toLowerCase()] || storeType;
  }
}

// Export singleton instance
const streamProcessor = new StreamProcessor();
export default streamProcessor;