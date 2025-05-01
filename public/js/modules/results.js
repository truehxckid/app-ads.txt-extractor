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
      const VisualIndicators = await import('./visual-indicators.js').then(module => module.default);
      if (VisualIndicators) {
        VisualIndicators.clearIndicators();
      }
      
      // Initialize visual indicators
      if (VisualIndicators && typeof VisualIndicators.initialize === 'function') {
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
      
      // Update visual indicators after receiving response
      if (VisualIndicators) {
        VisualIndicators.updateProgress({
          processed: response.totalProcessed || bundleIds.length,
          success: response.successCount || 0,
          errors: response.errorCount || 0,
          withAppAds: response.results.filter(r => r.success && r.appAdsTxt?.exists).length,
          total: bundleIds.length
        });
        VisualIndicators.setStatusMessage('Processing complete, rendering results...', 'success');
      }
      
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
      if (VisualIndicators) {
        VisualIndicators.complete({
          processed: response.totalProcessed || bundleIds.length,
          success: response.successCount || 0,
          errors: response.errorCount || 0,
          withAppAds: response.results.filter(r => r.success && r.appAdsTxt?.exists).length,
          total: bundleIds.length
        });
      }
      
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
      try {
        const VisualIndicators = await import('./visual-indicators.js').then(module => module.default);
        if (VisualIndicators) {
          VisualIndicators.showError(`Error: ${errorMessage}`);
        }
      } catch (indicatorError) {
        console.warn('Failed to display error in visual indicators:', indicatorError);
      }
      
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
      const VisualIndicators = await import('./visual-indicators.js').then(module => module.default);
      if (VisualIndicators) {
        VisualIndicators.clearIndicators();
      }
      
      // Initialize visual indicators for pagination
      const resultElement = DOMUtils.getElement('result');
      if (VisualIndicators && typeof VisualIndicators.initialize === 'function') {
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
      if (VisualIndicators) {
        VisualIndicators.updateProgress({
          processed: AppState.pageSize, 
          total: response.pagination?.totalItems || bundleIds.length
        });
        VisualIndicators.setStatusMessage(`Page ${page} loaded successfully`, 'success');
      }
      
      // Update app state with new results
      AppState.setResults(response.results, response.pagination);
      
      // Display the results
      this.displayResults(response);
      
      // Complete visual indicators
      if (VisualIndicators) {
        VisualIndicators.complete({
          processed: AppState.pageSize,
          total: response.pagination?.totalItems || bundleIds.length
        });
      }
      
    } catch (err) {
      console.error('Error loading page:', err);
      showNotification(`Error: ${err.message}`, 'error');
      DOMUtils.showError('result', err.message);
      
      // Show error in visual indicators
      try {
        const VisualIndicators = await import('./visual-indicators.js').then(module => module.default);
        if (VisualIndicators) {
          VisualIndicators.showError(`Error loading page: ${err.message}`);
        }
      } catch (indicatorError) {
        console.warn('Failed to display error in visual indicators:', indicatorError);
      }
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