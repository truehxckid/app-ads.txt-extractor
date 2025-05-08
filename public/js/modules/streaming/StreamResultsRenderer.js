/**
 * StreamResultsRenderer Module
 * Renders streaming results to the DOM
 */

import DOMUtils from '../dom-utils.js';
import { formatNumber, getStoreDisplayName } from '../../utils/formatting.js';

/**
 * Stream Results Renderer Class
 * Handles rendering and display of streaming results
 */
class StreamResultsRenderer {
  constructor() {
    this.hasSearchTerms = false;
    this.animationFrameId = null;
    this.resultElement = null;
    
    // Progress tracking
    this.cumulativeStats = {
      processed: 0,
      success: 0,
      errors: 0,
      withAppAds: 0,
      total: 0
    };
    
    // DOM caching to reduce redundant queries
    this.domCache = {
      // Result elements
      resultElement: null,
      resultsContainer: null,
      resultsTable: null,
      resultsTableContainer: null,
      resultsTableBody: null,
      
      // Indicators and banners
      progressIndicators: null,
      workerIndicator: null,
      completionBanner: null,
      
      // Pagination
      paginationControls: null
    };
    
    // Listen for stream completion events to show results
    window.addEventListener('streaming-show-results', (event) => {
      console.log('🔄 StreamResultsRenderer: Received show-results event');
      const appState = window.AppState || {};
      const results = appState.results || [];
      
      // Show the results UI
      this.showResults(results);
    });
    
    // Listen for progress updates from StreamProcessor
    window.addEventListener('streaming-progress-update', (event) => {
      if (event.detail && event.detail.stats) {
        console.log('🔄 StreamResultsRenderer: Received progress update from StreamProcessor', event.detail.stats);
        // Sync our stats with StreamProcessor's stats
        this.syncWithProcessorStats(event.detail.stats);
      }
    });
  }
  
  /**
   * Get a cached DOM element or query and cache it
   * @param {string} key - Cache key for the element
   * @param {string|Function} selector - CSS selector or selector function
   * @param {boolean} queryAll - Whether to use querySelectorAll
   * @param {Element} context - Optional parent element for scoped queries
   * @returns {Element|NodeList|null} - The requested element(s)
   */
  _getElement(key, selector, queryAll = false, context = document) {
    // Return cached element if available
    if (this.domCache[key] !== undefined && this.domCache[key] !== null) {
      return this.domCache[key];
    }
    
    // Query element based on selector type
    if (typeof selector === 'string') {
      if (selector.startsWith('#') && !queryAll && context === document) {
        // Optimize for ID selectors
        this.domCache[key] = document.getElementById(selector.substring(1));
      } else {
        // Use standard query methods
        this.domCache[key] = queryAll 
          ? context.querySelectorAll(selector)
          : context.querySelector(selector);
      }
    } else if (typeof selector === 'function') {
      // Execute selector function
      this.domCache[key] = selector();
    }
    
    return this.domCache[key];
  }
  
  /**
   * Clear specific DOM cache entries
   * @param {Array} keys - Keys to clear (or all if not specified)
   */
  _clearCache(keys = null) {
    if (keys) {
      keys.forEach(key => {
        this.domCache[key] = null;
      });
    } else {
      // Clear all cache entries
      Object.keys(this.domCache).forEach(key => {
        this.domCache[key] = null;
      });
    }
  }
  
  /**
   * Initialize UI for displaying results
   * @param {HTMLElement} container - Container element
   * @param {number} totalItems - Total items to process
   * @param {boolean} hasSearchTerms - Whether the query includes search terms
   */
  initializeUI(container, totalItems, hasSearchTerms) {
    this.hasSearchTerms = hasSearchTerms;
    
    // Clear cache for a fresh start
    this._clearCache();
    
    // Get or find container element using caching
    if (container) {
      this.domCache.resultElement = container;
      this.resultElement = container;
    } else {
      this.resultElement = this._getElement('resultElement', '#result');
    }
    
    if (!this.resultElement) return;
    
    // Perform thorough cleanup of all existing elements
    this._cleanupPreviousElements();
    
    console.log('🔄 StreamResultsRenderer: Initializing UI with', totalItems, 'items');
    
    // First check if we already have any progress indicators
    // Remove all existing visual-indicators-container to avoid overlap
    const existingProgressIndicators = this._getElement('progressIndicators', 
      '.visual-indicators-container', true);
    
    if (existingProgressIndicators) {
      Array.from(existingProgressIndicators).forEach(indicator => {
        if (indicator && indicator.parentNode) {
          indicator.parentNode.removeChild(indicator);
        }
      });
    }
    
    // Create worker processing indicator div
    const workerIndicator = document.createElement('div');
    workerIndicator.className = 'streaming-info-banner worker-processing-indicator';
    workerIndicator.style.cssText = 'margin: 20px 0; padding: 15px; background: #f1f8ff; border: 1px solid #0366d6; border-radius: 4px; text-align: center;';
    workerIndicator.innerHTML = `
      <h3 style="margin-top: 0; color: #0366d6;">⚙️ Worker Processing... 0% complete (0 of ${totalItems})</h3>
      <p>Results will be available when processing is complete.</p>
      <p class="processing-note" style="font-style: italic; margin-top: 10px;">For performance reasons, results will be displayed only after all processing is complete.</p>
      <div class="progress-bar-wrapper" style="margin-top: 15px; height: 4px; background: #e0e0e0; border-radius: 2px; overflow: hidden;">
        <div class="progress-bar" style="height: 100%; width: 0%; background: #0366d6; transition: width 0.3s ease;"></div>
      </div>
    `;
    
    // Cache the worker indicator
    this.domCache.workerIndicator = workerIndicator;
    
    // Create results container
    const resultsContainer = document.createElement('div');
    resultsContainer.id = 'results-container';
    resultsContainer.style.display = 'none';
    
    // Cache the results container
    this.domCache.resultsContainer = resultsContainer;
    
    // Clear the result element's existing content
    this.resultElement.innerHTML = '';
    
    // Add our new elements
    this.resultElement.appendChild(workerIndicator);
    this.resultElement.appendChild(resultsContainer);
    
    // Add animation styles (only once)
    if (!document.getElementById('stream-renderer-styles')) {
      const style = document.createElement('style');
      style.id = 'stream-renderer-styles';
      style.textContent = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes streaming-animation {
          0% { background-position: 100% 0; }
          100% { background-position: 0 0; }
        }
      `;
      document.head.appendChild(style);
    }
    
    // Show the result element
    this.resultElement.style.display = 'block';
    
    // Add event listeners for toggles
    this._setupEventListeners(this.resultElement);
  }
  
  /**
   * Clean up all existing elements from previous searches
   * @private
   */
  _cleanupPreviousElements() {
    console.log('🔄 StreamResultsRenderer: Cleaning up previous elements');
    
    // Remove all indicators and processing elements
    const elementsToRemove = [
      '.worker-processing-indicator', 
      '.streaming-info-banner',
      '.stream-results-display',
      '.results-table-container',
      '.streaming-completion-banner',
      '.visual-indicators-container',
      '.progress-indicator',
      '.processing-indicator',
      '#results-container',
      '#streamProgress'
    ];
    
    // Create a selector for all elements to remove at once (more efficient)
    const combinedSelector = elementsToRemove.join(', ');
    
    // Use a single query to find all elements to remove (faster than multiple queries)
    const elements = document.querySelectorAll(combinedSelector);
    
    // Keep count for logging
    let removedCount = 0;
    
    // Remove all matched elements
    elements.forEach(element => {
      if (element && element.parentNode) {
        element.parentNode.removeChild(element);
        removedCount++;
      }
    });
    
    console.log(`🔄 StreamResultsRenderer: Removed ${removedCount} elements`);
    
    // Clear any progress messages or indicators without specific classes
    if (this.resultElement) {
      // Find any elements that might contain progress-related text
      const textQuery = element => 
        element.textContent && 
        (element.textContent.includes('Processing') || 
         element.textContent.includes('Sending request') ||
         element.textContent.includes('Worker')) &&
        !element.classList.contains('stream-results-display');
      
      // Use more efficient approach - collect elements first, then remove
      const textElements = Array.from(this.resultElement.querySelectorAll('*'))
        .filter(textQuery);
      
      // Remove collected elements
      textElements.forEach(element => {
        element.remove();
      });
      
      console.log(`🔄 StreamResultsRenderer: Removed ${textElements.length} text-matched elements`);
    }
    
    // Clear the DOM cache after cleanup
    this._clearCache();
  }
  
  /**
   * Add event listeners for interactive elements
   * @private
   */
  _setupEventListeners() {
    // REMOVED redundant event listeners - All actions with data-action 
    // are now handled by the central EventHandler in event-handler.js
    
    // Previously this method had duplicate handlers for:
    // - toggle-ads
    // - toggle-matches
    // - copy
    // - tab-switch
    
    // These are now all handled by the main event handler 
    // through a single document click event listener in EventHandler.js
  }
  
  /**
   * Synchronize our stats with StreamProcessor's stats
   * @param {Object} processorStats - Stats from StreamProcessor
   */
  syncWithProcessorStats(processorStats) {
    if (!processorStats) return;
    
    // Update our cumulative stats with the processor's stats (which are more accurate)
    this.cumulativeStats.processed = processorStats.processedCount || processorStats.processed || this.cumulativeStats.processed;
    this.cumulativeStats.success = processorStats.successCount || processorStats.success || this.cumulativeStats.success;
    this.cumulativeStats.errors = processorStats.errorCount || processorStats.errors || this.cumulativeStats.errors;
    this.cumulativeStats.withAppAds = processorStats.withAppAdsTxtCount || processorStats.withAppAds || this.cumulativeStats.withAppAds;
    this.cumulativeStats.total = processorStats.totalBundleIds || processorStats.total || this.cumulativeStats.total;
    
    console.log('🔄 StreamResultsRenderer: Synced with processor stats', this.cumulativeStats);
    
    // Update the UI with the synced stats
    this.updateSummaryStats(this.cumulativeStats);
  }
  
  /**
   * Update the summary statistics in the UI
   * @param {Object} stats - Statistics object
   * @private
   */
  updateSummaryStats(stats) {
    if (!this.resultElement) return;
    
    // Store stats for reference
    this.stats = this.stats || {};
    Object.assign(this.stats, stats);
    
    // Also update cumulative total if provided
    if (stats.total && stats.total > 0) {
      this.cumulativeStats.total = stats.total;
    }
    
    // Get cached indicator header or query it once
    const workerIndicator = this._getElement('workerIndicatorHeader', 
      () => {
        const indicator = this.domCache.workerIndicator;
        return indicator ? indicator.querySelector('h3') : 
          this.resultElement.querySelector('.worker-processing-indicator h3');
      });
      
    if (workerIndicator) {
      // Fix for NaN% issue - ensure both values are valid numbers
      let percent = 0;
      // Use cumulative stats or provided stats, preferring cumulative
      const processedCount = this.cumulativeStats.processed || stats.processed || 0;
      const totalCount = this.cumulativeStats.total || stats.total || this.stats?.totalBundleIds || 0;
      
      // Only calculate percent if total is valid
      if (totalCount > 0) {
        percent = Math.min(100, Math.round((processedCount / totalCount) * 100));
        
        // Only update the text if we have valid data
        // Check if we're not going backwards from a previous valid state
        if (!workerIndicator.textContent.includes('initializing')) {
          workerIndicator.textContent = `⚙️ Worker Processing... ${percent}% complete (${processedCount} of ${totalCount})`;
        }
      }
      // Don't revert to "initializing" once we've started showing progress
      else if (!workerIndicator.textContent.includes('%')) {
        // Only show initializing if we haven't started showing percentages yet
        workerIndicator.textContent = `⚙️ Worker Processing... initializing`;
      }
      
      // Get cached progress bar or query it once
      const progressBar = this._getElement('workerProgressBar', 
        () => {
          const indicator = this.domCache.workerIndicator;
          return indicator ? indicator.querySelector('.progress-bar') : 
            this.resultElement.querySelector('.worker-processing-indicator .progress-bar');
        });
        
      // Always update the progress bar if it exists
      if (progressBar && percent > 0) {
        progressBar.style.width = `${percent}%`;
      }
    }
  }

  /**
   * Render a batch of results
   * @param {Array} results - Results to render
   * @param {Array} searchTerms - Search terms for highlighting (no longer used)
   */
  renderBatch(results, searchTerms = []) {
    if (!results || !results.length) return;
    
    console.log('🔄 StreamResultsRenderer: Received batch of', results.length, 'results');
    
    // Instead of trying to render results in real-time, we'll just accumulate them
    // and update the counter statistics
    
    try {
      // Count number of results with app-ads.txt
      const withAppAds = results.filter(r => r.success && r.appAdsTxt?.exists).length;
      
      // Update the statistics in the UI
      const successCount = results.filter(r => r.success).length;
      const errorCount = results.filter(r => !r.success).length;
      
      // Update cumulative stats
      this.cumulativeStats.processed += results.length;
      this.cumulativeStats.success += successCount;
      this.cumulativeStats.errors += errorCount;
      this.cumulativeStats.withAppAds += withAppAds;
      
      // Use the cumulative stats for UI updates
      const updatedStats = {
        processed: this.cumulativeStats.processed,
        success: this.cumulativeStats.success,
        errors: this.cumulativeStats.errors,
        withAppAds: this.cumulativeStats.withAppAds,
        total: this.cumulativeStats.total || this.stats?.totalBundleIds || 0
      };
      
      console.log('🔄 StreamResultsRenderer: Cumulative stats:', updatedStats);
      
      // Update summary stats with the cumulative counts
      this.updateSummaryStats(updatedStats);
      
      // Dispatch a custom event to notify that results were processed
      if (window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('streaming-results-processed', {
          detail: { 
            count: results.length, 
            timestamp: Date.now(),
            successCount,
            errorCount,
            withAppAds
          }
        }));
      }
    } catch (err) {
      console.error('🔄 Error processing results batch:', err);
    }
  }
  
  /**
   * Show the results after processing is complete
   * @param {Array} results - Results to display
   */
  showResults(results) {
    if (!this.resultElement) return;
    
    // Make sure completion banner stays visible when showing results - use cached version if available
    const completionBanner = this._getElement('completionBanner', '.streaming-completion-banner');
    if (completionBanner) {
      completionBanner.style.display = 'block';
      
      // Update Show Results button text - cache the button too for potential future use
      const showResultsBtn = this._getElement('showResultsBtn', 
        () => completionBanner.querySelector('[data-action="show-results"]'));
      if (showResultsBtn) {
        showResultsBtn.textContent = 'Hide Results';
      }
    }
    
    // Try to get results from AppState if none provided
    if (!results || !results.length) {
      console.log('🔄 StreamResultsRenderer: No results provided, trying to get from AppState');
      
      // Try to get AppState via import
      import('../app-state.js').then(module => {
        console.log('🔄 Imported AppState:', module.default);
        const importedAppState = module.default;
        
        if (importedAppState && importedAppState.results && importedAppState.results.length) {
          console.log('🔄 Found results in imported AppState:', importedAppState.results.length);
          this._renderResults(importedAppState.results);
          return;
        } else {
          console.log('🔄 No results in imported AppState, trying window.AppState');
          // Fall back to window.AppState
          const windowAppState = window.AppState || {};
          if (windowAppState.results && windowAppState.results.length) {
            console.log('🔄 Found results in window.AppState:', windowAppState.results.length);
            this._renderResults(windowAppState.results);
          } else {
            console.log('🔄 No results in window.AppState, rendering empty results');
            this._renderResults([]);
          }
        }
      }).catch(error => {
        console.error('🔄 Error importing AppState:', error);
        this._renderResults(results || []);
      });
    } else {
      // If results are provided, render them directly
      this._renderResults(results);
    }
  }
  
  /**
   * Render results to the UI
   * @param {Array} results - Results to display
   * @private
   */
  _renderResults(results) {
    console.log('🔄 StreamResultsRenderer: Rendering', results.length, 'results');
    
    // Filter results for advanced search if needed
    const filteredResults = results.filter(result => {
      // Keep results if:
      // 1. Not using advanced search (no matchesAdvancedSearch property), or
      // 2. Result matches advanced search criteria, or
      // 3. Result doesn't have the matchesAdvancedSearch property (backward compatibility)
      return !('matchesAdvancedSearch' in result) || result.matchesAdvancedSearch === true;
    });
    
    console.log('🔄 StreamResultsRenderer: Filtered to', filteredResults.length, 'results after advanced search filtering');
    
    // Store the full results for pagination
    this.allResults = filteredResults;
    
    // Set up pagination variables
    this.pageSize = 50;
    this.currentPage = 1;
    this.totalPages = Math.ceil(filteredResults.length / this.pageSize);
    
    // Create a results display element
    const resultsDisplay = document.createElement('div');
    resultsDisplay.className = 'stream-results-display';
    
    // Cache the results display
    this.domCache.resultsDisplay = resultsDisplay;
    
    // Add results header with search-styled UI
    resultsDisplay.innerHTML = `
      <div class="stream-results-header search-container">
        <div class="results-summary">
          <div class="summary-text">
            <h3>Processing Results</h3>
            <p>Showing ${results.length} extracted results from your bundle IDs.</p>
          </div>
        </div>
        
        <div class="stream-results-table-container results-table-container">
          <table class="results-table">
            <thead>
              <tr>
                <th>Bundle ID</th>
                <th>Store</th>
                <th>Domain</th>
                <th>app-ads.txt</th>
                <th>Matched Terms</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="results-final-tbody">
              ${results.length === 0 ? '<tr><td colspan="6" style="text-align: center; padding: 20px;">No results found</td></tr>' : ''}
            </tbody>
          </table>
        </div>
        
        <!-- Pagination Controls -->
        <div id="pagination-controls" class="pagination-wrapper">
          ${this._generatePaginationControls(results.length, this.pageSize, 1)}
        </div>
      </div>
    `;
    
    // Get references to the table elements and cache them for future use
    this.domCache.resultsTableContainer = resultsDisplay.querySelector('.results-table-container');
    this.domCache.resultsTable = resultsDisplay.querySelector('.results-table');
    this.domCache.resultsTableBody = resultsDisplay.querySelector('#results-final-tbody');
    this.domCache.paginationControls = resultsDisplay.querySelector('#pagination-controls');
    
    // Replace any existing results section or add to the page
    const existingResults = this._getElement('existingResultsDisplay', '.stream-results-display');
    if (existingResults) {
      existingResults.parentNode.replaceChild(resultsDisplay, existingResults);
    } else {
      this.resultElement.appendChild(resultsDisplay);
    }
    
    // Set up event listeners for pagination and back button
    this._setupEventListeners(resultsDisplay);
    
    // Render the first page of results
    this._renderPage(filteredResults, 1);
    
    // Scroll to the results
    resultsDisplay.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  
  /**
   * Render a specific page of results
   * @param {Array} results - All results
   * @param {number} page - Page number to render
   * @private
   */
  _renderPage(results, page) {
    if (!results || !results.length) return;
    
    // Update current page
    this.currentPage = page;
    
    // Calculate slice indices
    const startIndex = (page - 1) * this.pageSize;
    const endIndex = Math.min(startIndex + this.pageSize, results.length);
    
    // Get results for this page
    const pageResults = results.slice(startIndex, endIndex);
    
    // Get the tbody element using our caching method
    const tbody = this._getElement('resultsTableBody', '#results-final-tbody');
    if (!tbody) return;
    
    // Performance optimization: Use DocumentFragment for batch DOM operations
    const fragment = document.createDocumentFragment();
    
    // Clear existing rows more efficiently
    while (tbody.firstChild) {
      tbody.removeChild(tbody.firstChild);
    }
    
    // Add results for this page to the fragment
    pageResults.forEach(result => {
      if (!result) return; // Skip null/undefined results
      
      const row = document.createElement('tr');
      row.className = result.success ? 'success-row' : 'error-row';
      
      if (result.success) {
        const hasAppAds = result.appAdsTxt?.exists;
        const hasSearchMatches = hasAppAds && result.appAdsTxt.searchResults && result.appAdsTxt.searchResults.count > 0;
        const searchMatchCount = hasSearchMatches ? result.appAdsTxt.searchResults.count : 0;
        
        // Create matched terms cell content
        let matchedTermsHtml = '';
        if (hasSearchMatches) {
          matchedTermsHtml += '<span class="search-matches-found">';
          
          // For multi-term search, show color-coded indicators
          if (result.appAdsTxt.searchResults.termResults) {
            // Generate colored indicators for each term - showing term numbers (1-based index)
            result.appAdsTxt.searchResults.termResults.forEach((termResult, termIndex) => {
              if (termResult.count > 0) {
                const colorClass = `term-match-${termIndex % 5}`;
                matchedTermsHtml += `<span class="term-match-indicator ${colorClass}">${termIndex + 1}</span> `;
              }
            });
          } else if (searchMatchCount > 0) {
            // Fallback for single-term search
            matchedTermsHtml += `${searchMatchCount} matches`;
          } else {
            matchedTermsHtml += 'None';
          }
          
          matchedTermsHtml += '</span>';
        } else {
          matchedTermsHtml = '<span class="search-matches-missing">None</span>';
        }
        
        row.innerHTML = `
          <td>${DOMUtils.escapeHtml(result.bundleId || '')}</td>
          <td>${DOMUtils.escapeHtml(getStoreDisplayName(result.storeType || ''))}</td>
          <td class="domain-cell">${DOMUtils.escapeHtml(result.domain || 'N/A')}</td>
          <td class="app-ads-cell">
            ${hasAppAds 
              ? '<span class="app-ads-found">Found</span>' 
              : '<span class="app-ads-missing">Not found</span>'}
          </td>
          <td class="search-matches-cell">
            ${matchedTermsHtml}
          </td>
          <td>
            <button class="table-copy-btn" data-action="copy" data-copy="${result.domain || ''}" 
              type="button" title="Copy domain to clipboard">Copy</button>
          </td>
        `;
      } else {
        row.innerHTML = `
          <td>${DOMUtils.escapeHtml(result.bundleId || '')}</td>
          <td colspan="3" class="error-message">
            Error: ${DOMUtils.escapeHtml(result.error || 'Unknown error')}
          </td>
          <td>N/A</td>
          <td></td>
        `;
      }
      
      fragment.appendChild(row);
    });
    
    // Append the fragment to the DOM (single reflow)
    tbody.appendChild(fragment);
    
    // Update pagination controls using our caching method
    const paginationControls = this._getElement('paginationControls', '#pagination-controls');
    if (paginationControls) {
      paginationControls.innerHTML = this._generatePaginationControls(
        results.length, 
        this.pageSize, 
        page
      );
    }
  }
  
  /**
   * Generate pagination controls HTML
   * @param {number} totalItems - Total items count
   * @param {number} pageSize - Items per page
   * @param {number} currentPage - Current page number
   * @returns {string} - Pagination HTML
   * @private
   */
  _generatePaginationControls(totalItems, pageSize, currentPage) {
    if (totalItems <= pageSize) {
      return ''; // No pagination needed
    }
    
    const totalPages = Math.ceil(totalItems / pageSize);
    let paginationHTML = '<div class="pagination">';
    
    // Previous button
    if (currentPage > 1) {
      paginationHTML += `<button type="button" class="pagination-btn button-small" data-action="paginate" data-page="${currentPage - 1}">← Previous</button>`;
    } else {
      paginationHTML += `<button type="button" class="pagination-btn button-small disabled" disabled>← Previous</button>`;
    }
    
    // Page numbers
    paginationHTML += '<div class="page-numbers">';
    
    // First page
    if (currentPage > 3) {
      paginationHTML += `<button type="button" class="pagination-btn button-small" data-action="paginate" data-page="1">1</button>`;
      
      if (currentPage > 4) {
        paginationHTML += '<span class="pagination-ellipsis">...</span>';
      }
    }
    
    // Pages around current
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);
    
    for (let i = startPage; i <= endPage; i++) {
      if (i === currentPage) {
        paginationHTML += `<button type="button" class="pagination-btn button-small active" disabled>${i}</button>`;
      } else {
        paginationHTML += `<button type="button" class="pagination-btn button-small" data-action="paginate" data-page="${i}">${i}</button>`;
      }
    }
    
    // Last page
    if (currentPage < totalPages - 2) {
      if (currentPage < totalPages - 3) {
        paginationHTML += '<span class="pagination-ellipsis">...</span>';
      }
      
      paginationHTML += `<button type="button" class="pagination-btn button-small" data-action="paginate" data-page="${totalPages}">${totalPages}</button>`;
    }
    
    paginationHTML += '</div>';
    
    // Next button
    if (currentPage < totalPages) {
      paginationHTML += `<button type="button" class="pagination-btn button-small" data-action="paginate" data-page="${currentPage + 1}">Next →</button>`;
    } else {
      paginationHTML += `<button type="button" class="pagination-btn button-small disabled" disabled>Next →</button>`;
    }
    
    paginationHTML += '</div>';
    
    // Add page info
    paginationHTML += `
      <div class="pagination-info">
        Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, totalItems)} of ${totalItems} results
      </div>
    `;
    
    return paginationHTML;
  }
  
  /**
   * Set up event listeners for pagination and hide results button
   * @param {HTMLElement} container - Container element
   * @private
   */
  _setupEventListeners(container) {
    // Safety check - if container is undefined, exit early
    if (!container) {
      console.warn('StreamResultsRenderer: No container provided to _setupEventListeners');
      return;
    }
    
    // Change Back button to Hide Results
    const backButton = container.querySelector('[data-action="back-to-search"]');
    if (backButton) {
      backButton.textContent = 'Hide Results';
      backButton.setAttribute('data-action', 'hide-results');
      
      backButton.addEventListener('click', () => {
        // Hide results but keep completion banner visible
        container.style.display = 'none';
        
        // Make sure completion banner is visible
        if (this.resultElement) {
          const completionBanner = this.resultElement.querySelector('.streaming-completion-banner');
          if (completionBanner) {
            completionBanner.style.display = 'block';
            
            // Update the Show Results button text
            const showResultsBtn = completionBanner.querySelector('[data-action="show-results"]');
            if (showResultsBtn) {
              showResultsBtn.textContent = 'Show Results';
            }
          } else {
            // If banner doesn't exist, recreate it
            this._createCompletionBanner();
          }
        }
      });
    }
    
    // NOTE: Pagination clicks (data-action="pagination") should be handled by the
    // central EventHandler in event-handler.js. However, the EventHandler currently
    // delegates this to StreamResultsRenderer's handlePaginationClick method.
    //
    // A cleaner approach would be to expose a public method for changing pages
    // and have the EventHandler call that method.
  }
  
  /**
   * Create a completion banner
   * @private
   */
  _createCompletionBanner() {
    // Check if we already have a cached banner
    if (this.domCache.completionBanner) {
      // If the banner exists but was removed from DOM, we can reuse it
      if (!this.domCache.completionBanner.isConnected) {
        this.resultElement.prepend(this.domCache.completionBanner);
        return;
      }
    }
    
    // Create a new banner if needed
    const completionBanner = document.createElement('div');
    completionBanner.className = 'streaming-completion-message streaming-completion-banner';
    
    // Cache the completion banner for future reference
    this.domCache.completionBanner = completionBanner;
    
    completionBanner.innerHTML = `
      <div class="completion-banner-content">
        <div class="completion-message">
          <p>Completed processing ${this.allResults?.length || 0} bundle IDs</p>
        </div>
        <div class="action-buttons">
          <button class="extract-btn" data-action="show-results">
            Show Results
          </button>
        </div>
      </div>
    `;
    
    // Add to the result element
    this.resultElement.prepend(completionBanner);
    
    // Set up styles to match other buttons
    const actionButtons = completionBanner.querySelectorAll('button');
    actionButtons.forEach(button => {
      button.style.marginLeft = '5px';
      button.style.marginRight = '5px';
    });
    
    // NOTE: We're not directly attaching an event listener to show/hide buttons anymore.
    // Instead, the buttons have data-action="show-results" or data-action="hide-results"
    // which are handled by the global event handler in event-handler.js
    
    // We don't need to add the event listener here anymore
    // The event is now handled globally in the EventHandler via data-action="download-csv"
  }
  
  /**
   * Placeholder for the removed real-time rendering functionality
   * These methods have been removed as we're no longer rendering results in real-time
   * 
   * The following methods were part of the real-time rendering:
   * - _createResultRow: Created HTML for a single result row
   * - _addAppAdsDetails: Added app-ads.txt details to the DOM
   * - _highlightSearchTerms: Highlighted search terms in content
   * - _generateSearchTermLegend: Generated a legend for search terms
   * 
   * Now we just accumulate results and update counters, with full display handled
   * after all processing is complete.
   */
}

// Create and export a singleton instance
const streamResultsRenderer = new StreamResultsRenderer();
/**
 * Update UI to reflect streaming completion
 * @param {Object} stats - Final statistics object
 */
streamResultsRenderer.updateCompletionStatus = function(stats) {
  if (!this.resultElement) return;
  
  console.log('🔄 StreamResultsRenderer: Processing complete, updating UI with stats:', stats);
  
  // Create a streaming completion banner
  const completionBanner = document.createElement('div');
  completionBanner.className = 'streaming-completion-message streaming-completion-banner';
  
  // Cache the completion banner for future reference
  this.domCache.completionBanner = completionBanner;
  
  // Format time in a readable way
  const timeInSeconds = stats.elapsedTime / 1000;
  const timeDisplay = timeInSeconds >= 60 
    ? `${(timeInSeconds / 60).toFixed(1)} minutes` 
    : `${timeInSeconds.toFixed(1)} seconds`;
    
  completionBanner.innerHTML = `
    <div class="completion-banner-content">
      <div class="completion-message">
        <p>Completed processing ${stats.total} bundle IDs (${stats.errors} errors) in ${timeDisplay}</p>
      </div>
      <div class="action-buttons">
        <button class="download-btn extract-btn" data-action="download-csv" id="main-download-csv-btn">
          Download CSV Results
        </button>
        <button class="extract-btn" data-action="show-results">
          Show Results
        </button>
      </div>
    </div>
  `;
  
  // First hide the worker processing indicator using cached element
  const workerIndicator = this._getElement('workerIndicator', '.worker-processing-indicator');
  if (workerIndicator) {
    // Replace it with the completion banner
    workerIndicator.parentNode.replaceChild(completionBanner, workerIndicator);
  } else {
    // If for some reason we can't find it, just append the banner
    this.resultElement.appendChild(completionBanner);
  }
  
  // Set up styles to match other buttons
  const actionButtons = completionBanner.querySelectorAll('button');
  actionButtons.forEach(button => {
    button.style.marginLeft = '5px';
    button.style.marginRight = '5px';
  });
  
  // NOTE: We're not directly attaching an event listener to show/hide buttons anymore.
  // Instead, the buttons have data-action="show-results" or data-action="hide-results"
  // which are handled by the global event handler in event-handler.js
  
  // CSV export event handling is centralized in EventHandler
};

export default streamResultsRenderer;