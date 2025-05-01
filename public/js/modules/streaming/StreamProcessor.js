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
import StreamDebugger from './StreamDebugger.js';

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
    
    // Initialize components
    this.progressUI = new StreamProgressUI();
    this.dataParser = new StreamDataParser(this.decoder);
    this.resultsRenderer = new StreamResultsRenderer();
    this.debugger = new StreamDebugger();
    
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
    
    // Initialize UI components
    this.resultsRenderer.initializeUI(resultElement, bundleIds.length, searchTerms.length > 0);
    
    // Initialize progress UI
    const progressInitSuccess = this.progressUI.initialize({
      totalItems: bundleIds.length,
      container: resultElement,
      showDetails: true,
      animate: true
    });
    
    if (!progressInitSuccess) {
      console.error('Failed to initialize progress UI, creating fallback');
      this.progressUI.createFallback(resultElement, bundleIds.length);
    } else {
      this.progressUI.setStatusMessage('Starting streaming process...', 'info');
    }
    
    try {
      // If worker is available and initialized, use it
      if (this.worker) {
        console.log('Using Web Worker for streaming processing');
        this.progressUI.setStatusMessage('Processing with Web Worker...', 'info');
        
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
      this.progressUI.setStatusMessage('Processing on main thread...', 'info');
      return await this._processBundleIdsMainThread(bundleIds, searchTerms);
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
   * @returns {Promise<boolean>} - Success status
   * @private
   */
  async _processBundleIdsMainThread(bundleIds, searchTerms = []) {
    try {
      // Add a cache-busting parameter to avoid cached responses
      const timestamp = Date.now();
      console.log(`Starting stream fetch with timestamp ${timestamp}`);
      
      // Create debug panel
      this.debugger.initialize('Stream Debug');
      
      // Force UI update now that we have a stream
      this.progressUI.forceUpdate(this.stats);
      
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
    this.progressUI.updateProgress({
      processed: this.stats.processedCount,
      success: this.stats.successCount,
      errors: this.stats.errorCount,
      withAppAds: this.stats.withAppAdsTxtCount,
      total: this.stats.totalBundleIds,
      startTime: this.stats.startTime
    });
    
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
        
        // Clear buffer and reset rendering state
        this.resultBuffer = [];
        this.lastRenderTime = Date.now();
        this.isRendering = false;
        
        // Schedule next batch if there are more results
        if (this.resultBuffer.length > 0) {
          this.animationFrameId = requestAnimationFrame(() => this._scheduleRender());
        } else {
          this.animationFrameId = null;
        }
      });
    }
  }
  
  /**
   * Finalize UI after streaming is complete
   * @private
   */
  _finalizeUI() {
    // Update progress UI one last time
    this.progressUI.updateProgress(this.stats);
    
    // Enable download button
    const downloadBtn = document.querySelector('[data-action="download-csv"]');
    if (downloadBtn) {
      downloadBtn.disabled = false;
    }
    
    // Set results in app state
    AppState.setResults(this.results);
    
    // Complete visual indicators
    const processingTime = Date.now() - this.stats.startTime;
    this.progressUI.complete({
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
    this.progressUI.setStatusMessage(
      `Completed processing ${this.stats.processedCount} bundle IDs (${this.stats.errorCount} errors) in ${timeDisplay}`,
      'success'
    );
    
    // Show completion notification
    const message = `Completed processing ${this.stats.processedCount} bundle IDs (${this.stats.errorCount} errors) in ${timeDisplay}`;
    showNotification(message, 'success');
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
        this.resultsRenderer.initializeUI(null, data.totalBundleIds, data.hasSearchTerms);
        break;
        
      case 'progress':
        // Update stats from worker
        this.stats.processedCount = data.processedCount;
        this.stats.successCount = data.successCount;
        this.stats.errorCount = data.errorCount;
        this.stats.withAppAdsTxtCount = data.withAppAdsTxtCount;
        
        // Update progress UI
        this.progressUI.updateProgress(this.stats);
        
        // Update status message periodically
        if (this.stats.processedCount % 10 === 0) {
          const percent = this.stats.totalBundleIds > 0 
            ? Math.round((this.stats.processedCount / this.stats.totalBundleIds) * 100)
            : 0;
          
          this.progressUI.setStatusMessage(
            `Worker processing... ${percent}% complete (${this.stats.processedCount} of ${this.stats.totalBundleIds})`,
            'info'
          );
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
        this.progressUI.showError(`Worker error: ${data.message}`);
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
      this.progressUI.initialize({
        totalItems: bundleIds.length,
        container: resultElement,
        showDetails: false,
        animate: true
      });
      
      // Set initial status message
      this.progressUI.setStatusMessage('Preparing CSV export stream...', 'info');
      showNotification('Starting CSV export stream...', 'info');
      
      // Create a download link
      const downloadLink = document.createElement('a');
      downloadLink.href = `/api/stream/export-csv?ts=${Date.now()}`; // Add timestamp to prevent caching
      downloadLink.download = `developer_domains_${new Date().toISOString().slice(0, 10)}.csv`;
      downloadLink.style.display = 'none';
      
      // Update visual progress indicators
      this.progressUI.updateProgress({
        processed: 0,
        total: bundleIds.length
      });
      this.progressUI.setStatusMessage('Connecting to server...', 'info');
      
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
      
      // Append link to body and trigger click
      document.body.appendChild(downloadLink);
      downloadLink.click();
      
      // Clean up
      setTimeout(() => {
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(url);
      }, 100);
      
      // Complete the indicators
      this.progressUI.complete({
        processed: bundleIds.length,
        total: bundleIds.length
      });
      this.progressUI.setStatusMessage('CSV export complete! Download starting...', 'success');
      
      showNotification('CSV export complete', 'success');
    } catch (err) {
      console.error('CSV export error:', err);
      showNotification(`Export error: ${err.message}`, 'error');
      this.progressUI.showError(`Export error: ${err.message}`);
    }
  }
}

// Export singleton instance
const streamProcessor = new StreamProcessor();
export default streamProcessor;