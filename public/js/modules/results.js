/**
 * Results Manager Module
 * Handles processing and displaying results
 */

import AppState from './app-state.js';
import Api from './api.js';
import DOMUtils from './dom-utils.js';
import TemplateEngine from './template.js';
import PaginationManager from './pagination.js';
import { showNotification } from '../utils/notification.js';
import VisualIndicators from './visual-indicators.js';

/**
 * Results Manager Class
 */
class ResultsManager {
  /**
   * Process bundle IDs
   * @param {string[]} bundleIds - Array of bundle IDs
   * @param {string[]} searchTerms - Array of search terms
   */
  async processBundleIds(bundleIds, searchTerms = []) {
    const startTime = Date.now();
    
    try {
      // Clear previous results
      const resultElement = DOMUtils.getElement('result');
      const debugElement = DOMUtils.getElement('debugInfo');
      
      // Show loading state
      if (resultElement) {
        DOMUtils.showLoading('result', 'Processing...');
      }
      
      // Clear previous visual indicators before initializing new ones
      VisualIndicators.clearIndicators();
      
      // Initialize visual indicators
      if (typeof VisualIndicators.initialize === 'function') {
        VisualIndicators.initialize({
          totalItems: bundleIds.length,
          containerSelector: resultElement,
          showDetails: true,
          animate: true
        });
        VisualIndicators.setStatusMessage('Starting extraction process...', 'info');
      }
      
      // Show debug info if in debug mode
      if (debugElement && AppState.debugMode) {
        debugElement.innerHTML = '<div class="debug-info"><h3>Debug Information</h3><p>Sending request to server...</p></div>';
        debugElement.style.display = 'block';
      }
      
      // Store search terms in app state
      AppState.setSearchTerms(searchTerms);
      
      // Update visual indicators before API call
      if (VisualIndicators) {
        VisualIndicators.updateProgress({processed: 0, total: bundleIds.length});
        VisualIndicators.setStatusMessage('Sending request to server...', 'info');
      }
      
      // Call API with pagination parameters
      const response = await Api.extractDomains(
        bundleIds, 
        searchTerms,
        1, // Start with page 1
        AppState.pageSize
      );
      
      // Add defensive check for streaming response format
      if (response.isStreaming) {
        console.log('⚡ ResultsManager: Detected streaming response, delegating to StreamProcessor');
        
        // Show a notification about streaming
        showNotification('Using streaming mode for processing large dataset', 'info');
        
        // When we have a streaming response, don't do normal processing - 
        // instead import and initialize the StreamProcessor module
        try {
          // Show a basic "preparing" message while we initialize streaming
          if (resultElement) {
            if (!resultElement.querySelector('.streaming-mode-indicator')) {
              resultElement.innerHTML = `
                <div class="streaming-mode-indicator">
                  <h3>Streaming Mode Active</h3>
                  <p>Processing ${bundleIds.length} bundle IDs via streaming API.</p>
                  <p>Preparing streaming pipeline...</p>
                  <div class="streaming-animation"></div>
                </div>
              `;
              resultElement.style.display = 'block';
              
              // Insert CSS for the streaming indicator
              if (!document.querySelector('style#streaming-animation-style')) {
                const style = document.createElement('style');
                style.id = 'streaming-animation-style';
                style.textContent = `
                  .streaming-mode-indicator {
                    background: #f1f8ff;
                    border: 1px solid #0366d6;
                    padding: 20px;
                    border-radius: 8px;
                    text-align: center;
                    margin: 20px 0;
                  }
                  .streaming-animation {
                    height: 4px;
                    background: linear-gradient(90deg, #0366d6 0%, transparent 50%, #0366d6 100%);
                    background-size: 200% 100%;
                    animation: streaming-animation 1.5s infinite linear;
                    border-radius: 2px;
                    margin-top: 15px;
                  }
                  @keyframes streaming-animation {
                    0% { background-position: 100% 0; }
                    100% { background-position: 0 0; }
                  }
                `;
                document.head.appendChild(style);
              }
            }
          }
          
          // We need to handle the actual response object correctly:
          // For streaming, we don't want to parse JSON - instead we want to 
          // pass the raw response to StreamProcessor
          if (response.response && response.response.body) {
            console.log('⚡ ResultsManager: Importing StreamProcessor to handle streaming response');
            
            // Dynamically import the stream processor (doesn't need to be async/await since we're in an async func)
            import('./streaming/StreamProcessor.js')
              .then(module => {
                const StreamProcessor = module.default;
                
                if (StreamProcessor && typeof StreamProcessor.initialize === 'function') {
                  console.log('⚡ ResultsManager: Calling StreamProcessor.initialize()');
                  if (!StreamProcessor.initialized) {
                    StreamProcessor.initialize();
                  }
                }
                
                if (StreamProcessor && typeof StreamProcessor.processBundleIds === 'function') {
                  console.log('⚡ ResultsManager: Calling StreamProcessor.processBundleIds()');
                  return StreamProcessor.processBundleIds(bundleIds, searchTerms);
                } else {
                  console.error('⚡ ResultsManager: StreamProcessor.processBundleIds is not a function');
                  throw new Error('StreamProcessor does not have processBundleIds method');
                }
              })
              .catch(err => {
                console.error('⚡ ResultsManager: Error handling stream response:', err);
                showNotification(`Error initializing stream processor: ${err.message}`, 'error');
              });
          } else {
            console.log('⚡ ResultsManager: No streaming response body available, falling back to normal processing');
          }
        } catch (err) {
          console.error('⚡ ResultsManager: Error in streaming delegation:', err);
          showNotification(`Streaming error: ${err.message}`, 'error');
        }
        
        // Return early - either StreamProcessor will handle it or we'll show an error
        return;
      }
      
      // Safety check for response.results (to prevent "Cannot read properties of undefined (reading 'filter')" error)
      if (!response.results || !Array.isArray(response.results)) {
        console.error('⚡ ResultsManager: response.results is not an array:', response);
        response.results = [];
      }
      
      // Update visual indicators after receiving response
      const withAppAds = Array.isArray(response.results) ? 
        response.results.filter(r => r.success && r.appAdsTxt?.exists).length : 0;
        
      VisualIndicators.updateProgress({
        processed: response.totalProcessed || bundleIds.length,
        success: response.successCount || 0,
        errors: response.errorCount || 0,
        withAppAds: withAppAds,
        total: bundleIds.length
      });
      VisualIndicators.setStatusMessage('Processing complete, rendering results...', 'success');
      
      // Store results in app state
      AppState.setResults(response.results, response.pagination);
      
      // Update debug info if in debug mode
      if (debugElement && AppState.debugMode) {
        const debugHtml = `
          <div class="debug-info">
            <h3>Debug Information</h3>
            <p><strong>Total processed:</strong> ${response.totalProcessed}</p>
            <p><strong>Success count:</strong> ${response.successCount}</p>
            <p><strong>Error count:</strong> ${response.errorCount}</p>
            <p><strong>Processing time:</strong> ${response.processingTime}</p>
            <p><strong>Cache hits:</strong> ${response.cacheStats?.hits || 0}</p>
            <p><strong>Cache misses:</strong> ${response.cacheStats?.misses || 0}</p>
            <p><strong>Cache hit rate:</strong> ${response.cacheStats?.hitRate || '0%'}</p>
            <p><strong>Pagination:</strong> Page ${response.pagination?.currentPage || 1} of ${response.pagination?.totalPages || 1}</p>
          </div>
        `;
        
        debugElement.innerHTML = debugHtml;
      }
      
      // Display results
      this.displayResults(response);
      
      // Complete visual indicators
      // Safety check for response.results (to prevent "Cannot read properties of undefined (reading 'filter')" error)
      const withAppAdsComplete = Array.isArray(response.results) ? 
        response.results.filter(r => r.success && r.appAdsTxt?.exists).length : 0;
        
      VisualIndicators.complete({
        processed: response.totalProcessed || bundleIds.length,
        success: response.successCount || 0,
        errors: response.errorCount || 0,
        withAppAds: withAppAdsComplete,
        total: bundleIds.length
      });
      
      // Final completion notification
      const processingTime = Date.now() - startTime;
      const message = `Completed processing ${response.totalProcessed} bundle IDs (${response.errorCount} errors) in ${processingTime}ms`;
      showNotification(message, 'success');
      
    } catch (err) {
      console.error('Error processing bundle IDs:', err);
      
      // Show error message
      const errorMessage = err.message || 'An unknown error occurred';
      showNotification(`Error: ${errorMessage}`, 'error');
      
      // Update result area with error
      DOMUtils.showError('result', errorMessage);
      
      // Show error in visual indicators
      VisualIndicators.showError(`Error: ${errorMessage}`);
      
      // Update debug info if in debug mode
      const debugElement = DOMUtils.getElement('debugInfo');
      if (debugElement && AppState.debugMode) {
        debugElement.innerHTML = `
          <div class="debug-info">
            <h3>Debug Information</h3>
            <p><strong>Error:</strong> ${DOMUtils.escapeHtml(errorMessage)}</p>
            <p><strong>Stack:</strong> ${DOMUtils.escapeHtml(err.stack || 'No stack trace available')}</p>
          </div>
        `;
      }
    } finally {
      // Reset processing state
      AppState.setProcessing(false);
    }
  }
  
  /**
   * Load a specific page of results
   * @param {number} page - Page number to load
   */
  async loadPage(page) {
    try {
      // Show loading state
      AppState.setProcessing(true);
      DOMUtils.showLoading('result', `Loading page ${page}...`);
      
      // Get bundle IDs and search terms from state or inputs
      const bundleIds = DOMUtils.getTextareaLines('bundleIds');
      const searchTerms = AppState.searchTerms.length > 0 ? 
        AppState.searchTerms : DOMUtils.getSearchTerms();
      
      // Clear previous visual indicators before initializing new ones
      VisualIndicators.clearIndicators();
      
      // Initialize visual indicators for pagination
      const resultElement = DOMUtils.getElement('result');
      if (typeof VisualIndicators.initialize === 'function') {
        VisualIndicators.initialize({
          totalItems: bundleIds.length,
          containerSelector: resultElement,
          showDetails: false,
          animate: true
        });
        VisualIndicators.setStatusMessage(`Loading page ${page}...`, 'info');
      }
      
      // Fetch the specific page
      const response = await Api.extractDomains(
        bundleIds,
        searchTerms,
        page,
        AppState.pageSize
      );
      
      // Update visual indicators
      VisualIndicators.updateProgress({
        processed: AppState.pageSize, 
        total: response.pagination?.totalItems || bundleIds.length
      });
      VisualIndicators.setStatusMessage(`Page ${page} loaded successfully`, 'success');
      
      // Update app state with new results
      AppState.setResults(response.results, response.pagination);
      
      // Display the results
      this.displayResults(response);
      
      // Complete visual indicators
      VisualIndicators.complete({
        processed: AppState.pageSize,
        total: response.pagination?.totalItems || bundleIds.length
      });
      
    } catch (err) {
      console.error('Error loading page:', err);
      showNotification(`Error: ${err.message}`, 'error');
      DOMUtils.showError('result', err.message);
      
      // Show error in visual indicators
      VisualIndicators.showError(`Error loading page: ${err.message}`);
    } finally {
      AppState.setProcessing(false);
    }
  }
  
  /**
   * Display results in the UI
   * @param {Object} data - Results data from API
   */
  displayResults(data) {
    const resultElement = DOMUtils.getElement('result');
    if (!resultElement) return;
    
    // Early return for streaming response
    if (data.isStreaming) {
      console.log('⚡ ResultsManager.displayResults: Detected streaming response, skipping display');
      return;
    }
    
    // Safety check for data.results (to prevent "Cannot read properties of undefined (reading 'filter')" error)
    if (!data.results || !Array.isArray(data.results)) {
      console.error('⚡ ResultsManager.displayResults: data.results is not an array:', data);
      data.results = [];
    }
    
    // Calculate statistics
    const successResults = data.results.filter(r => r.success);
    const withAppAds = successResults.filter(r => r.appAdsTxt?.exists).length;
    
    // Calculate search matches if search terms provided
    let withSearchMatches = 0;
    let searchTermsText = '';
    
    if (AppState.searchTerms && AppState.searchTerms.length > 0) {
      withSearchMatches = successResults.filter(r => 
        r.appAdsTxt?.exists && r.appAdsTxt.searchResults?.count > 0
      ).length;
      
      searchTermsText = AppState.searchTerms.join(', ');
    }
    
    // Generate summary HTML
    const summaryData = {
      totalProcessed: data.totalProcessed || data.pagination?.totalItems || data.results.length,
      success: data.successCount || successResults.length,
      error: data.errorCount || (data.results.length - successResults.length),
      withAppAds,
      withSearchMatches,
      searchTermsText
    };
    
    // Create fragments for each section
    const summaryHtml = TemplateEngine.generateResultsSummary(summaryData);
    const tableHtml = TemplateEngine.generateResultsTable(data.results, searchTermsText);
    const paginationHtml = PaginationManager.renderPagination(data.pagination);
    
    // Clear previous content - don't preserve visual indicators from this method
    // (they should be managed by visual-indicators.js)
    resultElement.innerHTML = '';
    
    // Add summary
    const summaryElement = document.createElement('div');
    summaryElement.innerHTML = summaryHtml;
    resultElement.appendChild(summaryElement);
    
    // Add table
    const tableElement = document.createElement('div');
    tableElement.innerHTML = tableHtml;
    resultElement.appendChild(tableElement);
    
    // Add pagination if available
    if (paginationHtml) {
      const paginationElement = document.createElement('div');
      paginationElement.innerHTML = paginationHtml;
      resultElement.appendChild(paginationElement);
    }
    
    // Make sure the result section is visible
    resultElement.style.display = 'block';
    
    // Scroll to top of results if needed
    if (data.pagination && data.pagination.currentPage > 1) {
      resultElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

// Export singleton instance
const resultsManager = new ResultsManager();
export default resultsManager;