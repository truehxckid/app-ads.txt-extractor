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
    // Create a minimal debug replacement
    this.debugger = {
      initialize: () => true,
      logStatus: (msg) => console.log('Stream Debug:', msg),
      logChunk: (chunk, length) => console.log(`Stream Debug: Chunk ${length} bytes`),
      logError: (err) => console.error('Stream Debug Error:', err),
      logConnectionInfo: (response) => console.log('Stream Debug Connection:', response.status),
      logSummary: (msg, stats) => console.log('Stream Debug Summary:', msg, stats),
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
    
    console.log('🚀 StreamProcessor: Initializing streaming processor');
    
    // Check if browser supports streaming
    if (!window.ReadableStream || !window.TextDecoder) {
      console.warn('Browser does not support streaming, falling back to regular processing');
      return false;
    }
    
    // Ensure the components are properly initialized
    if (this.dataParser) {
      console.log('🚀 StreamProcessor: Setting decoder on dataParser');
      this.dataParser.setDecoder(this.decoder);
    } else {
      console.error('🚀 StreamProcessor: dataParser is not available!');
    }
    
    // Try to initialize web worker if supported
    try {
      if (window.Worker) {
        console.log('⚡ StreamProcessor: Web Workers are supported, initializing worker');
        this.worker = new Worker('/js/workers/stream-worker.js');
        
        // Set up event listener for worker messages
        this.worker.onmessage = (e) => {
          console.log('⚡ StreamProcessor: Received worker message:', e.data.type);
          this._handleWorkerMessage(e.data);
        };
        
        // Add error handler for worker errors
        this.worker.onerror = (error) => {
          console.error('⚡ StreamProcessor: Worker error:', error);
        };
        
        console.log('⚡ StreamProcessor: Worker initialized successfully');
      } else {
        console.warn('⚡ StreamProcessor: Web Workers not supported by browser');
      }
    } catch (err) {
      console.error('⚡ StreamProcessor: Failed to initialize streaming worker:', err);
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
    
    console.log('🚀 StreamProcessor: Initialization complete');
    this.initialized = true;
    return true;
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
      const resultContainer = document.getElementById('result');
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
        
        // Remove any worker indicators
        const workerIndicators = document.querySelectorAll('.worker-processing-indicator, .worker-indicator');
        workerIndicators.forEach(indicator => indicator.remove());
        
        // Remove any streaming banners
        const streamingBanners = document.querySelectorAll('.streaming-mode-indicator, .streaming-info-banner');
        streamingBanners.forEach(banner => banner.remove());
      }
    }
    
    // Terminate worker if active
    if (this.worker) {
      console.log('🚀 StreamProcessor: Terminating existing worker for new job');
      this.worker.terminate();
      this.worker = null;
    }
  }
  
  /**
   * Process bundle IDs using streaming
   * @param {string[]} bundleIds - Bundle IDs to process
   * @param {Object|string[]} searchParams - Unified search parameters or legacy search terms
   * @returns {Promise<boolean>} - Success status
   */
  async processBundleIds(bundleIds, searchParams = null) {
    console.log('🚀 StreamProcessor.processBundleIds called with', bundleIds.length, 'bundle IDs');
    
    // Handle both unified search params and legacy search terms
    let searchTerms = [];
    let structuredParams = null;
    let searchMode = 'simple'; // Default mode
    
    if (Array.isArray(searchParams)) {
      // Legacy format - just search terms array
      searchTerms = searchParams;
      structuredParams = null; // Explicitly set to null for simple mode
      console.log('🚀 Legacy search terms:', searchTerms);
    } else if (searchParams && typeof searchParams === 'object') {
      // Store the search mode for later reference
      searchMode = searchParams.mode || 'simple';
      
      // New unified format - STRICT SEPARATION between modes
      if (searchParams.mode === 'simple' && searchParams.queries) {
        // ONLY use search terms from simple mode, explicitly clear structured params
        searchTerms = searchParams.queries;
        structuredParams = null; // Explicitly clear any structured params
        console.log('🚀 Simple search mode with queries:', searchParams.queries);
        
        // Clear any previously stored advanced search params
        if (AppState && typeof AppState.setAdvancedSearchParams === 'function') {
          AppState.setAdvancedSearchParams(null);
        }
        window.advancedSearchParams = null;
        
      } else if (searchParams.mode === 'advanced' && searchParams.structuredParams) {
        // ONLY use structured params from advanced mode, explicitly clear search terms
        searchTerms = []; // Clear simple search terms when using advanced mode
        
        // Ensure structuredParams is always an array for consistency
        if (Array.isArray(searchParams.structuredParams)) {
          structuredParams = searchParams.structuredParams;
        } else {
          // Convert single object to array with one item
          structuredParams = [searchParams.structuredParams];
        }
        
        console.log('🚀 Advanced search mode with params:', structuredParams);
        
        // Store the advanced search params in AppState so they're available throughout
        if (AppState && typeof AppState.setAdvancedSearchParams === 'function') {
          AppState.setAdvancedSearchParams(structuredParams);
        } else {
          // If AppState doesn't have this method, store directly
          window.advancedSearchParams = structuredParams;
        }
      }
    }
    
    // Store search mode in a global property for reference elsewhere
    window.currentSearchMode = searchMode;
    
    // For debugging
    console.log('🚀 Using search terms:', searchTerms);
    console.log('🚀 Using structured params:', structuredParams);
    
    // First, remove any stray progress bars from previous exports or interruptions
    const extraProgressBars = document.querySelectorAll('.progress-indicator, #streamProgress');
    if (extraProgressBars.length > 0) {
      console.log('🚀 Removing extra progress bars before starting new process');
      extraProgressBars.forEach(bar => {
        if (bar.parentNode) {
          bar.parentNode.removeChild(bar);
        }
      });
    }
    
    // Clear any existing processing indicators from previous runs
    this._clearAllProcessingIndicators();
    
    // Initialize if not already
    if (!this.initialized) {
      if (!this.initialize()) {
        showNotification('Streaming not supported in this browser, using regular processing instead', 'warning');
        return false;
      }
    }
    
    // Ensure worker is terminated if it exists from a previous run
    if (this.worker) {
      console.log('🚀 StreamProcessor: Terminating existing worker before starting new job');
      this.worker.terminate();
      this.worker = null;
      
      // Small delay to ensure cleanup
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Reset state
    this.resetState();
    this.searchTerms = searchTerms;
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
    
    console.log('👉 State initialized with totalBundleIds:', this.stats.totalBundleIds);
    
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
        console.log('🚀 Removing existing progress message:', element);
        element.remove();
      }
    });
    
    // Initialize UI components
    this.resultsRenderer.initializeUI(resultSection, bundleIds.length, searchTerms.length > 0);
    
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
          console.log('⚡ StreamProcessor: Late initialization of Web Worker');
          this.worker = new Worker('/js/workers/stream-worker.js');
          
          // Set up event listener for worker messages
          this.worker.onmessage = (e) => {
            console.log('⚡ StreamProcessor: Received worker message:', e.data.type);
            this._handleWorkerMessage(e.data);
          };
          
          // Add error handler for worker errors
          this.worker.onerror = (error) => {
            console.error('⚡ StreamProcessor: Worker error:', error);
            // Fall back to main thread if worker errors during setup
            this.worker = null;
          };
        } catch (workerError) {
          console.error('⚡ StreamProcessor: Late worker initialization failed:', workerError);
          this.worker = null;
        }
      }
      
      // If worker is available and initialized, use it
      if (this.worker) {
        console.log('⚡ StreamProcessor: Using Web Worker for streaming processing');
        // We no longer use progress UI for status messages
        
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
        
        // Enhanced logging before sending to worker
      console.log('🚀 StreamProcessor: About to send to worker - searchTerms:', searchTerms);
      console.log('🚀 StreamProcessor: About to send to worker - structuredParams:', structuredParams);
      console.log('🚀 StreamProcessor: Structured params type:', structuredParams ? typeof structuredParams : 'null');
      if (structuredParams) {
        console.log('🚀 StreamProcessor: Is structuredParams array?', Array.isArray(structuredParams));
      }
        
      // Send message to worker with structured parameters - ensure we're sending complete data
      this.worker.postMessage({
        type: 'processBundleIds',
        bundleIds,
        searchTerms: searchTerms || [],
        structuredParams: structuredParams,
        totalBundleIds: bundleIds.length
      });
        
        // Update debug information with worker status
        const debugElement = document.getElementById('debug-information') || document.getElementById('debugInfo');
        if (debugElement) {
          debugElement.innerHTML += `<br><strong style="color: green;">Using Web Worker for processing! (faster parallel processing)</strong>`;
        }
        
        // Worker handles the UI updates, so we just return
        return true;
      }
      
      // If no worker, process with main thread
      console.warn('⚡ StreamProcessor: No worker available, falling back to main thread processing');
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
      
      return await this._processBundleIdsMainThread(bundleIds, searchTerms, structuredParams);
    } catch (err) {
      console.error('Error starting streaming process:', err);
      showNotification(`Streaming error: ${err.message}`, 'error');
      this.progressUI.showError(`Streaming error: ${err.message}`);
      return false;
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
      console.log(`⚡ CRITICAL DEBUG: Starting stream fetch with timestamp ${timestamp}`);
      
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
        console.log('⚡ CRITICAL DEBUG: Creating debug information element');
        const debugInfoElement = document.createElement('div');
        debugInfoElement.id = 'debug-information';
        debugInfoElement.style.cssText = 'background: #f8f8f8; border: 1px solid #ddd; padding: 15px; margin: 20px 0; border-radius: 8px; font-family: monospace; white-space: pre-wrap; overflow: auto; max-height: 300px; display: block;';
        
        // Add to the page
        const container = document.querySelector('.container') || document.body;
        container.appendChild(debugInfoElement);
        
        console.log('⚡ CRITICAL DEBUG: Debug information element created');
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
      } else {
        console.error('⚡ CRITICAL DEBUG: Failed to create or find debug information element');
      }
      
      // Log some network state
      console.log('⚡ Network status:', navigator.onLine ? 'Online' : 'Offline');
      
      // Create debug panel
      this.debugger.initialize('Stream Debug');
      
      // Force UI update now that we have a stream
      this.progressUI.forceUpdate(this.stats);
      
      // Start streaming process with a shorter timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.log('⚡ CRITICAL DEBUG: Fetch timed out after 60 seconds!');
        controller.abort();
      }, 60000); // 60 second timeout
      
      try {
        console.log('⚡ CRITICAL DEBUG: Sending fetch request...');
        
        // Update debug information
        const debugInfo = document.getElementById('debug-information') || document.getElementById('debugInfo');
        if (debugInfo) {
            debugInfo.innerHTML += '<br>Sending fetch request...';
        }
        
        // Import API from '../api.js' dynamically to avoid circular dependencies
        const ApiModule = await import('../api.js');
        const Api = ApiModule.default;
        
        console.log('⚡ CRITICAL DEBUG: Using API.extractDomains which should redirect to streaming endpoint');
        
        // Use the API module which will automatically redirect to streaming endpoint
        // if streaming is enabled in localStorage
        const apiResponse = await Api.extractDomains(bundleIds, searchTerms, 1, 20, structuredParams);
        
        // Check if we got a streaming response
        if (apiResponse.isStreaming && apiResponse.response) {
          console.log('⚡ CRITICAL DEBUG: Api.extractDomains returned a streaming response!');
          
          // Log the full response object for debugging
          console.log('⚡ CRITICAL DEBUG: Api.extractDomains response:', apiResponse);
          
          const response = apiResponse.response;
          
          console.log('⚡ CRITICAL DEBUG: Fetch response received:', response.status, response.statusText);
          
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
          console.error('⚡ CRITICAL DEBUG: Api.extractDomains did not return a streaming response!');
          throw new Error('Api.extractDomains did not return a streaming response. Check localStorage "streamingEnabled" setting.');
        }
        
        // Legacy code path - direct fetch to streaming endpoint
        // This is a fallback in case the Api.extractDomains approach doesn't work
        console.log('⚡ CRITICAL DEBUG: FALLBACK: Using direct streaming API endpoint with nocache:', timestamp);
        
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
            searchTerms,
            structuredParams 
          }),
          signal: controller.signal
        });
        
        console.log('⚡ CRITICAL DEBUG: FALLBACK: Fetch response received:', response.status, response.statusText);
        
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
        console.error('Streaming error:', err);
        
        // Update debug div with error
        this.debugger.logError(err);
        
        showNotification(`Streaming error: ${err.message}`, 'error');
        DOMUtils.showError('result', err.message);
        return false;
      }
    } catch (err) {
      console.error('Main thread streaming error:', err);
      this.debugger.logError(err);
      showNotification(`Main thread streaming error: ${err.message}`, 'error');
      DOMUtils.showError('result', `Main thread streaming error: ${err.message}`);
      return false;
    }
  }
  
  /**
   * Process a single result from the stream
   * @param {Object} result - Result object
   * @private
   */
  _processResult(result) {
    if (!result || !result.bundleId) {
      console.error('📦 Error: Invalid result object received', result);
      return;
    }
    
    console.log('📦 Processing result for:', result.bundleId);
    
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
    
    // Log every 10th result to avoid console spam
    if (this.stats.processedCount % 10 === 0 || this.stats.processedCount < 5) {
      console.log('📊 Updated stats:', { 
        processed: this.stats.processedCount, 
        success: this.stats.successCount,
        errors: this.stats.errorCount,
        withAppAds: this.stats.withAppAdsTxtCount,
        total: this.stats.totalBundleIds,
        bufferSize: this.resultBuffer ? this.resultBuffer.length + 1 : 0 // +1 for current result
      });
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
        this.resultsRenderer.renderBatch(this.resultBuffer, this.searchTerms);
        
        // Update progress UI
        this.progressUI.updateProgress(this.stats);
        
        // Save the current buffer length before clearing it
        const hadResults = this.resultBuffer.length > 0;
        
        // Log rendering operation
        console.log('📊 StreamProcessor: Rendered batch of', this.resultBuffer.length, 'results');
        
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
    // Enable download button
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
    
    // Remove ALL progress UI elements completely 
    const allProgressElements = document.querySelectorAll(
      '.visual-indicators-container, .stats-container, .progress-bar-container, .counter, .rate-indicator, .time-remaining, .progress-indicator, #streamProgress'
    );
    allProgressElements.forEach(element => {
      if (element && element.parentNode) {
        element.parentNode.removeChild(element);
      }
    });
    
    // Update completion status in the StreamResultsRenderer - this will create the completion banner
    if (this.resultsRenderer && typeof this.resultsRenderer.updateCompletionStatus === 'function') {
      this.resultsRenderer.updateCompletionStatus(stats);
    }
    
    // Hide any worker progress indicators
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
    
    // Hide any remaining "Processing..." indicators
    const processingIndicators = document.querySelectorAll('.processing-indicator, [data-status="processing"]');
    processingIndicators.forEach(indicator => {
      if (indicator.style) {
        indicator.style.display = 'none';
      }
    });
    
    // Enable extract button
    const extractBtn = document.getElementById('extractBtn');
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
    console.log('⚡ StreamProcessor: Handling worker message:', message.type);
    const { type, data } = message;
    
    switch (type) {
      case 'initialize':
        console.log('⚡ StreamProcessor: Worker initialize message received');
        // Initialize UI if needed
        if (!document.getElementById('results-tbody')) {
          console.log('⚡ StreamProcessor: Initializing UI from worker message');
          this.resultsRenderer.initializeUI(null, data.totalBundleIds || this.stats.totalBundleIds, data.hasSearchTerms || false);
        } else {
          console.log('⚡ StreamProcessor: UI already initialized, skipping');
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
        
        // Log the data from worker to help with debugging
        console.log('Worker progress data:', data, 'Calculated percent:', data.percent);
        
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
        } catch (err) {
          console.warn('Error updating progress UI from worker message:', err);
          // Don't let progress UI errors stop processing
        }
        
        try {
          // Also update the results summary in StreamResultsRenderer
          if (this.resultsRenderer && typeof this.resultsRenderer.updateSummaryStats === 'function') {
            this.resultsRenderer.updateSummaryStats(this.stats);
          }
        } catch (err) {
          console.warn('Error updating results summary from worker message:', err);
          // Continue processing even if summary update fails
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
            console.warn('Error updating status message from worker:', err);
            // Continue processing even if status update fails
          }
        }
        break;
        
      case 'result':
        // Process individual result
        if (data.result) {
          console.log('⚡ Worker result received:', data.result.bundleId);
          
          // Add directly to results array - bypassing buffer since worker has its own batching
          this.results.push(data.result);
          
          // Use special direct render method for worker results
          // to avoid double-counting stats
          if (this.resultsRenderer) {
            this.resultsRenderer.renderBatch([data.result], this.searchTerms);
          }
        }
        break;
        
      case 'complete':
        console.log('⚡ StreamProcessor: Worker complete message received', {
          processedCount: data.processedCount,
          successCount: data.successCount, 
          errorCount: data.errorCount,
          withAppAdsTxtCount: data.withAppAdsTxtCount
        });
        
        // Store final results if provided
        if (data.results && Array.isArray(data.results)) {
          console.log('⚡ StreamProcessor: Storing final results array from worker');
          this.results = data.results;
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
          console.log('⚡ StreamProcessor: Processing complete - terminating worker');
          try {
            this.worker.terminate();
            this.worker = null;
          } catch (err) {
            console.error('⚡ Error terminating worker:', err);
          }
        }
        
        break;
        
      case 'error':
        console.error('⚡ Worker error:', data.message);
        showNotification(`Worker error: ${data.message}`, 'error');
        this.progressUI.showError(`Worker error: ${data.message}`);
        
        // Try to fall back to main thread if worker fails
        try {
          console.warn('⚡ StreamProcessor: Worker failed, trying to fall back to main thread');
          this._processBundleIdsMainThread(this.stats.bundleIds || [], this.searchTerms || []);
        } catch (fallbackError) {
          console.error('⚡ StreamProcessor: Fallback to main thread also failed:', fallbackError);
        }
        break;
        
      default:
        console.warn('⚡ StreamProcessor: Unknown worker message type:', type);
    }
  }
  
  /**
   * Clear all processing indicators and related DOM elements from previous runs
   * @private
   */
  _clearAllProcessingIndicators() {
    console.log('🚀 StreamProcessor: Clearing all processing indicators');
    
    // Get the result container
    const resultElement = document.getElementById('result');
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
    
    // Find and remove all elements
    elementsToRemove.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(element => {
        console.log(`🚀 StreamProcessor: Removing ${selector} element`);
        if (element.parentNode) {
          element.parentNode.removeChild(element);
        }
      });
    });
    
    // We want to keep the results display visible
    // DO NOT hide the results when exporting CSV
    // Leave this commented for future reference
    /*
    const resultsDisplay = resultElement.querySelector('.stream-results-display');
    if (resultsDisplay) {
      resultsDisplay.style.display = 'none';
    }
    */
    
    // Clear any processing messages
    const staticIndicators = resultElement.querySelectorAll(':not(.stream-results-display)');
    staticIndicators.forEach(element => {
      if (element.textContent && (
          element.textContent.includes('Processing') || 
          element.textContent.includes('Sending request') ||
          element.textContent.includes('Worker'))) {
        element.remove();
      }
    });
  }
  
  /**
   * Export results to CSV via streaming
   * @param {string[]} bundleIds - Bundle IDs
   * @param {Object|string[]} searchParams - Search parameters object or legacy search terms
   */
  async exportCsv(bundleIds, searchParams = {}) {
    // Global export tracking timestamp - use a window property to synchronize between modules
    const now = Date.now();
    
    // Set global timestamp here to prevent duplicate exports between modules
    // EventHandler checks but doesn't set this so we avoid double-check issues
    window._lastGlobalExportTime = now; // Set timestamp here first
    this._exportInProgress = true;
    this._lastExportTime = now;
    
    // Log export attempt
    console.log('CSV export initiated at', new Date().toISOString());
    
    if (!bundleIds || !bundleIds.length) {
      showNotification('No bundle IDs to export', 'error');
      return;
    }
    
    // Parse search parameters based on type
    let searchTerms = [];
    let structuredParams = null;
    let searchMode = 'simple'; // Default mode
    
    // Check if searchParams is an object with mode property (unified search format)
    if (searchParams && typeof searchParams === 'object' && searchParams.mode) {
      // Store the search mode
      searchMode = searchParams.mode;
      
      if (searchParams.mode === 'advanced' && searchParams.structuredParams) {
        // Advanced mode: use structuredParams
        structuredParams = searchParams.structuredParams;
        console.log('CSV Export: Using advanced search mode with structuredParams:', structuredParams);
        
        // Ensure structuredParams is an array
        if (!Array.isArray(structuredParams)) {
          structuredParams = [structuredParams];
          console.log('CSV Export: Converted structuredParams to array:', structuredParams);
        }
      } else if (searchParams.mode === 'simple' && searchParams.queries) {
        // Simple mode: use queries as search terms
        searchTerms = searchParams.queries;
        console.log('CSV Export: Using simple search mode with terms:', searchTerms);
      }
    } else if (Array.isArray(searchParams)) {
      // Legacy format: searchParams is just an array of search terms
      searchTerms = searchParams;
      console.log('CSV Export: Using legacy search terms format:', searchTerms);
    }
    
    // Debug check the variables
    console.log('CSV Export: Final parameters:', {
      mode: searchMode,
      searchTerms,
      structuredParams
    });
    
    // Log the actual parameters we'll use
    console.log('CSV Export parameters:', {
      bundleIds: bundleIds.length,
      searchTerms: searchTerms,
      structuredParams: structuredParams
    });
    
    // Get the results container to show progress
    const resultElement = DOMUtils.getElement('result');
    if (!resultElement) return;
    
    try {
      // First clear any existing indicators to prevent duplication
      this._clearAllProcessingIndicators();
      
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
      
      // Create a download link with unique timestamp
      const timestamp = Date.now();
      const downloadLink = document.createElement('a');
      downloadLink.href = `/api/stream/export-csv?ts=${timestamp}`; // Add timestamp to prevent caching
      downloadLink.download = `developer_domains_${new Date().toISOString().slice(0, 10)}.csv`;
      downloadLink.style.display = 'none';
      downloadLink.id = `csv-download-${timestamp}`; // Add unique ID
      
      // Update visual progress indicators
      this.progressUI.updateProgress({
        processed: 0,
        total: bundleIds.length
      });
      this.progressUI.setStatusMessage('Connecting to server...', 'info');
      
      // Set up fetch for streaming response with a unique cache buster
      const response = await fetch(`/api/stream/export-csv?nocache=${timestamp}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        },
        body: JSON.stringify({ 
          bundleIds, 
          searchTerms,
          structuredParams,
          mode: searchMode, // Include the search mode explicitly
          timestamp // Include timestamp in request to prevent duplicate processing
        })
      });
      
      // Log the request payload for debugging
      console.log('CSV Export request payload:', { 
        bundleIds: bundleIds.length, 
        searchTerms, 
        structuredParams,
        mode: searchMode // Show the search mode in logs
      });
      
      if (!response.ok) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }
      
      // Update progress indicators
      this.progressUI.updateProgress({
        processed: Math.floor(bundleIds.length * 0.1), // Show some progress
        total: bundleIds.length
      });
      this.progressUI.setStatusMessage('Processing data on server...', 'info');
      
      // Get the blob from the response
      const blob = await response.blob();
      
      // Update progress to 80%
      this.progressUI.updateProgress({
        processed: Math.floor(bundleIds.length * 0.8),
        total: bundleIds.length
      });
      this.progressUI.setStatusMessage('Creating download file...', 'info');
      
      // Create object URL for the blob
      const url = URL.createObjectURL(blob);
      
      // Update progress to 90%
      this.progressUI.updateProgress({
        processed: Math.floor(bundleIds.length * 0.9),
        total: bundleIds.length
      });
      
      // Set the link's href to the object URL
      downloadLink.href = url;
      console.log(`Initiating download with ID: csv-download-${timestamp}`);
      
      // Append link to body and trigger click
      document.body.appendChild(downloadLink);
      
      // Use a timeout to ensure we don't trigger downloads too quickly
      setTimeout(() => {
        // Verify the link still exists (wasn't already clicked)
        if (document.getElementById(`csv-download-${timestamp}`)) {
          console.log(`Clicking download link: csv-download-${timestamp}`);
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
        console.log('Export timestamps and flags cleared, ready for next export');
      }, 3000);
      
      showNotification('CSV export complete', 'success');
    } catch (err) {
      console.error('CSV export error:', err);
      showNotification(`Export error: ${err.message}`, 'error');
      this.progressUI.showError(`Export error: ${err.message}`);
      // Reset both local and global export timestamps and flags on error
      this._lastExportTime = null;
      window._lastGlobalExportTime = null;
      this._exportInProgress = false;
    }
  }
}

// Export singleton instance
const streamProcessor = new StreamProcessor();
export default streamProcessor;