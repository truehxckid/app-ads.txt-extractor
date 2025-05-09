/**
 * StreamResultsRenderer Module
 * Renders streaming results to the DOM
 */

import DOMUtils from '../dom-utils.js';
import { formatNumber, getStoreDisplayName } from '../../utils/formatting.js';
import { showNotification } from '../../utils/notification.js';
import Sanitizer from '../../utils/sanitizer.js';

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
    window.addEventListener('streaming-show-results', this._handleStreamingShowResults.bind(this));
    
    // Listen for progress updates from StreamProcessor
    window.addEventListener('streaming-progress-update', this._handleStreamingProgressUpdate.bind(this));
  }
  
  /**
   * Get a cached DOM element or query and cache it
   * @param {string} key - Cache key for the element
   * @param {string|Function} selector - CSS selector or selector function
   * @param {boolean} queryAll - Whether to use querySelectorAll
   * @param {Element} context - Optional parent element for scoped queries
   * @returns {Element|NodeList|null} - The requested element(s)
   * @private
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
   * @private
   */
  _clearCache(keys = null) {
    if (keys && Array.isArray(keys) && keys.length > 0) {
      // Clear only specified keys
      keys.forEach(key => {
        if (key in this.domCache) {
          this.domCache[key] = null;
        }
      });
    } else {
      // Clear all cache entries in one operation
      this.domCache = {
        resultElement: this.resultElement, // Preserve main container reference
        resultsContainer: null,
        resultsTable: null,
        resultsTableContainer: null,
        resultsTableBody: null,
        progressIndicators: null,
        workerIndicator: null,
        completionBanner: null,
        paginationControls: null
      };
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
    
    // Initialize UI with provided items count
    
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
    
    // Create worker processing indicator div using the Sanitizer
    const workerIndicator = document.createElement('div');
    workerIndicator.className = 'streaming-info-banner worker-processing-indicator';
    workerIndicator.style.cssText = 'margin: 20px 0; padding: 15px; background: #f1f8ff; border: 1px solid #0366d6; border-radius: 4px; text-align: center;';
    
    // Create child elements safely
    const heading = Sanitizer.createSafeElement('h3', {
      style: 'margin-top: 0; color: #0366d6;'
    }, `⚙️ Worker Processing... 0% complete (0 of ${Sanitizer.sanitizeString(String(totalItems))})`);
    
    const processingText = Sanitizer.createSafeElement('p', {}, 
      'Results will be available when processing is complete.');
    
    const noteText = Sanitizer.createSafeElement('p', {
      class: 'processing-note',
      style: 'font-style: italic; margin-top: 10px;'
    }, 'For performance reasons, results will be displayed only after all processing is complete.');
    
    const progressBarWrapper = Sanitizer.createSafeElement('div', {
      class: 'progress-bar-wrapper',
      style: 'margin-top: 15px; height: 4px; background: #e0e0e0; border-radius: 2px; overflow: hidden;'
    });
    
    const progressBar = Sanitizer.createSafeElement('div', {
      class: 'progress-bar',
      style: 'height: 100%; width: 0%; background: #0366d6; transition: width 0.3s ease;'
    });
    
    // Assemble the elements
    progressBarWrapper.appendChild(progressBar);
    workerIndicator.appendChild(heading);
    workerIndicator.appendChild(processingText);
    workerIndicator.appendChild(noteText);
    workerIndicator.appendChild(progressBarWrapper);
    
    // Cache the worker indicator
    this.domCache.workerIndicator = workerIndicator;
    
    // Create results container
    const resultsContainer = document.createElement('div');
    resultsContainer.id = 'results-container';
    resultsContainer.style.display = 'none';
    
    // Cache the results container
    this.domCache.resultsContainer = resultsContainer;
    
    // Clear the result element's existing content (safely)
    while (this.resultElement.firstChild) {
      this.resultElement.removeChild(this.resultElement.firstChild);
    }
    
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
      
    }
    
    // Clear the DOM cache after cleanup
    this._clearCache();
  }
  
  /**
   * Add event listeners for interactive elements
   * @private
   */
  _setupEventListeners() {
    // All UI events are centralized in EventHandler.js
  }

  /**
   * Handle streaming show results event
   * @param {CustomEvent} event - The event object
   * @private
   */
  _handleStreamingShowResults(event) {
    const appState = window.AppState || {};
    const results = appState.results || [];
    
    // Show the results UI
    this.showResults(results);
  }
  
  /**
   * Handle streaming progress update event
   * @param {CustomEvent} event - The event object containing progress stats
   * @private
   */
  _handleStreamingProgressUpdate(event) {
    if (event.detail && event.detail.stats) {
      // Sync our stats with StreamProcessor's stats
      this._syncWithProcessorStats(event.detail.stats);
    }
  }
  
  _setupEventListeners() {
    // All UI events are centralized in EventHandler.js
  }
  
  /**
   * Synchronize our stats with StreamProcessor's stats
   * @param {Object} processorStats - Stats from StreamProcessor
   * @private
   */
  _syncWithProcessorStats(processorStats) {
    if (!processorStats) return;
    
    // Update our cumulative stats with the processor's stats (which are more accurate)
    this.cumulativeStats.processed = processorStats.processedCount || processorStats.processed || this.cumulativeStats.processed;
    this.cumulativeStats.success = processorStats.successCount || processorStats.success || this.cumulativeStats.success;
    this.cumulativeStats.errors = processorStats.errorCount || processorStats.errors || this.cumulativeStats.errors;
    this.cumulativeStats.withAppAds = processorStats.withAppAdsTxtCount || processorStats.withAppAds || this.cumulativeStats.withAppAds;
    this.cumulativeStats.total = processorStats.totalBundleIds || processorStats.total || this.cumulativeStats.total;
    
    // Update the UI with the synced stats
    this._updateSummaryStats(this.cumulativeStats);
  }
  
  /**
   * Public method to update summary statistics
   * @param {Object} stats - Statistics object
   */
  updateSummaryStats(stats) {
    // Forward to the private implementation
    this._updateSummaryStats(stats);
  }

  /**
   * Update the summary statistics in the UI
   * @param {Object} stats - Statistics object
   * @private
   */
  _updateSummaryStats(stats) {
    if (!this.resultElement) return;
    
    try {
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
            // Use the sanitizer to set text content safely
            Sanitizer.setTextContent(
              workerIndicator.querySelector('h3') || workerIndicator, 
              `⚙️ Worker Processing... ${percent}% complete (${processedCount} of ${totalCount})`
            );
          }
        }
        // Don't revert to "initializing" once we've started showing progress
        else if (!workerIndicator.textContent.includes('%')) {
          // Only show initializing if we haven't started showing percentages yet
          Sanitizer.setTextContent(
            workerIndicator.querySelector('h3') || workerIndicator, 
            `⚙️ Worker Processing... initializing`
          );
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
    } catch (err) {
      // Use standardized error handling with options appropriate for progress updates
      this._handleError(err, 'Error updating summary statistics', {
        // This is a non-critical UI update, so don't show notifications or UI errors
        showNotification: false,
        showInUI: false
      });
    }
  }

  /**
   * Render a batch of results
   * @param {Array} results - Results to render
   * @param {Array} searchTerms - Search terms for highlighting (no longer used)
   * @private
   */
  _renderBatch(results, searchTerms = []) {
    if (!results || !results.length) return;
    
    // Accumulate results and update counter statistics
    
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
      
      // Update summary stats with cumulative counts
      this._updateSummaryStats(updatedStats);
      
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
      // Use the standardized error handler with options appropriate for batch processing
      this._handleError(err, 'Error processing results batch', {
        // This is non-critical UI functionality, so don't show notifications to users
        showNotification: false,
        showInUI: false
      });
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
        Sanitizer.setTextContent(showResultsBtn, 'Hide Results');
      }
    }
    
    // Try to get results from AppState if none provided
    if (!results || !results.length) {
      // Try to get AppState via import
      import('../app-state.js').then(module => {
        const importedAppState = module.default;
        
        if (importedAppState && importedAppState.results && importedAppState.results.length) {
          this._renderResults(importedAppState.results);
          return;
        } else {
          // Fall back to window.AppState
          const windowAppState = window.AppState || {};
          if (windowAppState.results && windowAppState.results.length) {
            this._renderResults(windowAppState.results);
          } else {
            this._renderResults([]);
          }
        }
      }).catch(error => {
        // Handle error with our standardized error handler
        this._handleError(error, 'Failed to load results from AppState', {
          // Don't show notification to user since we'll fall back to empty results
          showNotification: false
        });
        
        // Use provided results or empty array as fallback
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
    try {
      // Filter results for advanced search if needed
      const filteredResults = results.filter(result => {
        // Keep results if:
        // 1. Not using advanced search (no matchesAdvancedSearch property), or
        // 2. Result matches advanced search criteria, or
        // 3. Result doesn't have the matchesAdvancedSearch property (backward compatibility)
        return !('matchesAdvancedSearch' in result) || result.matchesAdvancedSearch === true;
      });
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
      
      // Add results header with search-styled UI - using Sanitizer
      const headerContainer = Sanitizer.createSafeElement('div', { 
        class: 'stream-results-header search-container' 
      });
      
      const resultsSummary = Sanitizer.createSafeElement('div', { 
        class: 'results-summary' 
      });
      
      const summaryText = Sanitizer.createSafeElement('div', { 
        class: 'summary-text' 
      });
      
      const heading = Sanitizer.createSafeElement('h3', {}, 'Processing Results');
      
      const resultCount = Sanitizer.createSafeElement('p', {}, 
        `Showing ${Sanitizer.sanitizeString(String(results.length))} extracted results from your bundle IDs.`
      );
      
      // Build summary section
      summaryText.appendChild(heading);
      summaryText.appendChild(resultCount);
      resultsSummary.appendChild(summaryText);
      headerContainer.appendChild(resultsSummary);
      
      // Create table container
      const tableContainer = Sanitizer.createSafeElement('div', {
        class: 'stream-results-table-container results-table-container'
      });
      
      // Create table
      const table = Sanitizer.createSafeElement('table', {
        class: 'results-table'
      });
      
      // Create table header
      const thead = Sanitizer.createSafeElement('thead', {});
      const headerRow = Sanitizer.createSafeElement('tr', {});
      
      // Add table headers
      const headerLabels = ['Bundle ID', 'Store', 'Domain', 'app-ads.txt', 'Matched Terms', 'Actions'];
      headerLabels.forEach(label => {
        const th = Sanitizer.createSafeElement('th', {}, label);
        headerRow.appendChild(th);
      });
      
      thead.appendChild(headerRow);
      table.appendChild(thead);
      
      // Create table body
      const tbody = Sanitizer.createSafeElement('tbody', {
        id: 'results-final-tbody'
      });
      
      // Add empty state message if no results
      if (results.length === 0) {
        const emptyRow = Sanitizer.createSafeElement('tr', {});
        const emptyCell = Sanitizer.createSafeElement('td', {
          colspan: '6',
          style: 'text-align: center; padding: 20px;'
        }, 'No results found');
        
        emptyRow.appendChild(emptyCell);
        tbody.appendChild(emptyRow);
      }
      
      table.appendChild(tbody);
      tableContainer.appendChild(table);
      
      // Create pagination controls container
      const paginationContainer = Sanitizer.createSafeElement('div', {
        id: 'pagination-controls',
        class: 'pagination-wrapper'
      });
      
      // Add pagination controls (generated separately)
      const paginationControlsFragment = this._generatePaginationControls(results.length, this.pageSize, 1);
      paginationContainer.appendChild(paginationControlsFragment);
      
      // Assemble all components
      headerContainer.appendChild(tableContainer);
      headerContainer.appendChild(paginationContainer);
      resultsDisplay.appendChild(headerContainer);
      
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
    } catch (err) {
      // Use standardized error handler for rendering results
      this._handleError(err, 'Failed to render results', {
        // This is a critical UI function, so show notification and UI error
        showNotification: true,
        showInUI: true
      });
      
      // Create a minimal fallback results display in case of error
      if (this.resultElement) {
        const errorDisplay = Sanitizer.createSafeElement('div', {
          class: 'stream-results-display error-state'
        });
        
        const errorContainer = Sanitizer.createSafeElement('div', {
          class: 'error-message-container'
        });
        
        const errorHeading = Sanitizer.createSafeElement('h3', {}, 'Error Displaying Results');
        
        const errorMessage = Sanitizer.createSafeElement('p', {}, 
          'There was an error displaying the results. You can try downloading the CSV instead.');
        
        const downloadButton = Sanitizer.createSafeElement('button', {
          class: 'primary-btn extract-btn download-csv-btn',
          'data-action': 'download-csv'
        }, 'Download CSV Results');
        
        // Assemble the error display
        errorContainer.appendChild(errorHeading);
        errorContainer.appendChild(errorMessage);
        errorContainer.appendChild(downloadButton);
        errorDisplay.appendChild(errorContainer);
        
        // Add to the page
        this.resultElement.appendChild(errorDisplay);
      }
    }
  }
  
  /**
   * Render a specific page of results
   * @param {Array} results - All results
   * @param {number} page - Page number to render
   * @private
   */
  _renderPage(results, page) {
    if (!results || !results.length) return;
    
    try {
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
        
        const row = Sanitizer.createSafeElement('tr', {
          class: result.success ? 'success-row' : 'error-row'
        });
        
        if (result.success) {
          const hasAppAds = result.appAdsTxt?.exists;
          const hasSearchMatches = hasAppAds && result.appAdsTxt.searchResults && result.appAdsTxt.searchResults.count > 0;
          const searchMatchCount = hasSearchMatches ? result.appAdsTxt.searchResults.count : 0;
          
          // Create cells with safe DOM methods
          
          // Bundle ID cell
          const bundleIdCell = Sanitizer.createSafeElement('td', {}, result.bundleId || '');
          
          // Store type cell
          const storeCell = Sanitizer.createSafeElement('td', {}, getStoreDisplayName(result.storeType || ''));
          
          // Domain cell
          const domainCell = Sanitizer.createSafeElement('td', { class: 'domain-cell' }, result.domain || 'N/A');
          
          // App-ads.txt cell
          const appAdsCell = Sanitizer.createSafeElement('td', { class: 'app-ads-cell' });
          
          // Create app-ads status with inline styles to ensure consistency
          const appAdsStatusSpan = Sanitizer.createSafeElement('span', {
            class: hasAppAds ? 'app-ads-found' : 'app-ads-missing',
            title: hasAppAds ? 'app-ads.txt file found for this domain' : 'No app-ads.txt file found'
          }, hasAppAds ? 'Found' : 'Not found');
          
          if (hasAppAds) {
            appAdsStatusSpan.style.display = 'inline-block';
            appAdsStatusSpan.style.padding = '4px 10px';
            appAdsStatusSpan.style.borderRadius = '4px';
            appAdsStatusSpan.style.backgroundColor = '#4caf50';
            appAdsStatusSpan.style.color = 'white';
            appAdsStatusSpan.style.fontWeight = 'bold';
            appAdsStatusSpan.style.textAlign = 'center';
            appAdsStatusSpan.style.minWidth = '60px';
            appAdsStatusSpan.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
          } else {
            appAdsStatusSpan.style.display = 'inline-block';
            appAdsStatusSpan.style.padding = '4px 10px';
            appAdsStatusSpan.style.borderRadius = '4px';
            appAdsStatusSpan.style.backgroundColor = '#f5f5f5';
            appAdsStatusSpan.style.color = '#666';
            appAdsStatusSpan.style.fontWeight = 'normal';
            appAdsStatusSpan.style.fontStyle = 'italic';
            appAdsStatusSpan.style.textAlign = 'center';
            appAdsStatusSpan.style.minWidth = '60px';
            appAdsStatusSpan.style.border = '1px solid #ddd';
          }
          
          appAdsCell.appendChild(appAdsStatusSpan);
          
          // Search matches cell
          const matchesCell = Sanitizer.createSafeElement('td', { class: 'search-matches-cell' });
          
          if (hasSearchMatches) {
            const matchesSpan = Sanitizer.createSafeElement('span', { class: 'search-matches-found' });
            
            // For multi-term search, show color-coded indicators
            if (result.appAdsTxt.searchResults.termResults) {
              // Process each term result as a separate indicator
              result.appAdsTxt.searchResults.termResults.forEach((termResult, termIndex) => {
                if (termResult.count > 0) {
                  // Limit to 5 color classes (0-4) to match search highlighting
                  const colorClass = `term-match-${termIndex % 5}`;
                  
                  // Use index+1 to represent which search criteria matched (1, 2, 3, etc.)
                  // This shows which criteria number matched rather than the actual ID
                  const displayText = String(termIndex + 1);
                  
                  const termIndicator = Sanitizer.createSafeElement('span', {
                    class: `term-match-indicator ${colorClass}`,
                    title: `${termResult.term || `Term ${termIndex + 1}`} found ${termResult.count} time(s)`
                  }, displayText);
                  termIndicator.style.display = 'inline-flex';
                  termIndicator.style.alignItems = 'center';
                  termIndicator.style.justifyContent = 'center';
                  termIndicator.style.width = '24px';
                  termIndicator.style.height = '24px';
                  termIndicator.style.padding = '0 4px';
                  termIndicator.style.borderRadius = '4px';
                  termIndicator.style.margin = '0 6px 0 0';
                  termIndicator.style.fontWeight = 'var(--font-weight-semibold, 600)';
                  termIndicator.style.color = 'white';
                  termIndicator.style.fontSize = '11px';
                  termIndicator.style.textShadow = '0 1px 1px rgba(0,0,0,0.1)';
                  
                  switch(termIndex % 5) {
                    case 0:
                      termIndicator.style.background = 'linear-gradient(135deg, #4a6bdf, #3957cc)';
                      termIndicator.style.border = '1px solid #3450c0';
                      break;
                    case 1:
                      termIndicator.style.background = 'linear-gradient(135deg, #9c5ad3, #7e40b9)';
                      termIndicator.style.border = '1px solid #7138a8';
                      break;
                    case 2:
                      termIndicator.style.background = 'linear-gradient(135deg, #4caf50, #357a38)';
                      termIndicator.style.border = '1px solid #2e6b31';
                      break;
                    case 3:
                      termIndicator.style.background = 'linear-gradient(135deg, #ff9800, #d68100)';
                      termIndicator.style.border = '1px solid #c27700';
                      break;
                    case 4:
                      termIndicator.style.background = 'linear-gradient(135deg, #e91e63, #c1134e)';
                      termIndicator.style.border = '1px solid #ad1145';
                      break;
                  }
                  
                  // Add directly to the matches span
                  matchesSpan.appendChild(termIndicator);
                }
              });
            } else if (searchMatchCount > 0) {
              // Fallback for single-term search
              matchesSpan.appendChild(document.createTextNode(`${searchMatchCount} matches`));
            } else {
              matchesSpan.appendChild(document.createTextNode('None'));
            }
            
            matchesCell.appendChild(matchesSpan);
          } else {
            const noMatchesSpan = Sanitizer.createSafeElement('span', { class: 'search-matches-missing' }, 'None');
            matchesCell.appendChild(noMatchesSpan);
          }
          
          // Actions cell
          const actionsCell = Sanitizer.createSafeElement('td', {});
          const copyButton = Sanitizer.createSafeElement('button', {
            class: 'table-copy-btn',
            'data-action': 'copy',
            'data-copy': result.domain || '',
            type: 'button',
            title: 'Copy domain to clipboard'
          }, 'Copy');
          actionsCell.appendChild(copyButton);
          
          // Add all cells to the row
          row.appendChild(bundleIdCell);
          row.appendChild(storeCell);
          row.appendChild(domainCell);
          row.appendChild(appAdsCell);
          row.appendChild(matchesCell);
          row.appendChild(actionsCell);
        } else {
          // Error row - create cells with safe DOM methods
          
          // Bundle ID cell
          const bundleIdCell = Sanitizer.createSafeElement('td', {}, result.bundleId || '');
          
          // Error message cell (spans 3 columns)
          const errorCell = Sanitizer.createSafeElement('td', {
            colspan: '3',
            class: 'error-message'
          }, `Error: ${result.error || 'Unknown error'}`);
          
          // Empty cells for consistency
          const naCell = Sanitizer.createSafeElement('td', {}, 'N/A');
          const emptyCell = Sanitizer.createSafeElement('td', {}, '');
          
          // Add all cells to the row
          row.appendChild(bundleIdCell);
          row.appendChild(errorCell);
          row.appendChild(naCell);
          row.appendChild(emptyCell);
        }
        
        fragment.appendChild(row);
      });
      
      // Append the fragment to the DOM (single reflow)
      tbody.appendChild(fragment);
      
      // Update pagination controls using our caching method
      const paginationControls = this._getElement('paginationControls', '#pagination-controls');
      if (paginationControls) {
        // Clear existing content
        while (paginationControls.firstChild) {
          paginationControls.removeChild(paginationControls.firstChild);
        }
        
        // Add new pagination controls
        const paginationControlsFragment = this._generatePaginationControls(
          results.length, 
          this.pageSize, 
          page
        );
        paginationControls.appendChild(paginationControlsFragment);
      }
    } catch (err) {
      // Use standardized error handling for pagination rendering
      this._handleError(err, 'Error rendering results page', {
        // Only show notification for this since it's a user-initiated action
        showNotification: true,
        showInUI: false
      });
      
      // Try to provide a simplified fallback view if possible
      try {
        const tbody = this._getElement('resultsTableBody', '#results-final-tbody');
        if (tbody) {
          // Clear existing content
          while (tbody.firstChild) {
            tbody.removeChild(tbody.firstChild);
          }
          
          // Add a simple error message
          const errorRow = Sanitizer.createSafeElement('tr', {});
          const errorCell = Sanitizer.createSafeElement('td', {
            colspan: '6',
            class: 'error-message',
            style: 'text-align: center; padding: 20px;'
          }, 'Error rendering results. Please try changing pages or refreshing.');
          
          errorRow.appendChild(errorCell);
          tbody.appendChild(errorRow);
        }
      } catch (fallbackError) {
        console.error('Error creating fallback UI:', fallbackError);
      }
    }
  }
  
  /**
   * Generate pagination controls
   * @param {number} totalItems - Total items count
   * @param {number} pageSize - Items per page
   * @param {number} currentPage - Current page number
   * @returns {HTMLElement} - Pagination controls fragment
   * @private
   */
  _generatePaginationControls(totalItems, pageSize, currentPage) {
    // Create document fragment to hold all pagination elements
    const fragment = document.createDocumentFragment();
    
    if (totalItems <= pageSize) {
      return fragment; // No pagination needed
    }
    
    const totalPages = Math.ceil(totalItems / pageSize);
    
    // Main pagination container
    const paginationDiv = Sanitizer.createSafeElement('div', { class: 'pagination' });
    
    // Previous button
    const prevButton = Sanitizer.createSafeElement('button', {
      type: 'button',
      class: currentPage > 1 ? 'pagination-btn button-small' : 'pagination-btn button-small disabled'
    }, '← Previous');
    
    if (currentPage > 1) {
      prevButton.setAttribute('data-action', 'paginate');
      prevButton.setAttribute('data-page', String(currentPage - 1));
    } else {
      prevButton.disabled = true;
    }
    
    paginationDiv.appendChild(prevButton);
    
    // Page numbers container
    const pageNumbersDiv = Sanitizer.createSafeElement('div', { class: 'page-numbers' });
    
    // First page
    if (currentPage > 3) {
      const firstPageBtn = Sanitizer.createSafeElement('button', {
        type: 'button',
        class: 'pagination-btn button-small',
        'data-action': 'paginate',
        'data-page': '1'
      }, '1');
      pageNumbersDiv.appendChild(firstPageBtn);
      
      if (currentPage > 4) {
        const ellipsis = Sanitizer.createSafeElement('span', { class: 'pagination-ellipsis' }, '...');
        pageNumbersDiv.appendChild(ellipsis);
      }
    }
    
    // Pages around current
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);
    
    for (let i = startPage; i <= endPage; i++) {
      const pageBtn = Sanitizer.createSafeElement('button', {
        type: 'button',
        class: i === currentPage ? 'pagination-btn button-small active' : 'pagination-btn button-small'
      }, String(i));
      
      if (i === currentPage) {
        pageBtn.disabled = true;
      } else {
        pageBtn.setAttribute('data-action', 'paginate');
        pageBtn.setAttribute('data-page', String(i));
      }
      
      pageNumbersDiv.appendChild(pageBtn);
    }
    
    // Last page
    if (currentPage < totalPages - 2) {
      if (currentPage < totalPages - 3) {
        const ellipsis = Sanitizer.createSafeElement('span', { class: 'pagination-ellipsis' }, '...');
        pageNumbersDiv.appendChild(ellipsis);
      }
      
      const lastPageBtn = Sanitizer.createSafeElement('button', {
        type: 'button',
        class: 'pagination-btn button-small',
        'data-action': 'paginate',
        'data-page': String(totalPages)
      }, String(totalPages));
      
      pageNumbersDiv.appendChild(lastPageBtn);
    }
    
    paginationDiv.appendChild(pageNumbersDiv);
    
    // Next button
    const nextButton = Sanitizer.createSafeElement('button', {
      type: 'button',
      class: currentPage < totalPages ? 'pagination-btn button-small' : 'pagination-btn button-small disabled'
    }, 'Next →');
    
    if (currentPage < totalPages) {
      nextButton.setAttribute('data-action', 'paginate');
      nextButton.setAttribute('data-page', String(currentPage + 1));
    } else {
      nextButton.disabled = true;
    }
    
    paginationDiv.appendChild(nextButton);
    
    // Add the pagination container to the fragment
    fragment.appendChild(paginationDiv);
    
    // Add page info
    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, totalItems);
    
    const paginationInfo = Sanitizer.createSafeElement('div', { class: 'pagination-info' }, 
      `Showing ${startItem}-${endItem} of ${totalItems} results`);
    
    fragment.appendChild(paginationInfo);
    
    return fragment;
  }
  
  /**
   * Set up event listeners for pagination and hide results button
   * @param {HTMLElement} container - Container element
   * @private
   */
  _setupEventListeners(container) {
    // Safety check - if container is undefined, exit early
    if (!container) {
      return;
    }
    
    // Change Back button to Hide Results
    const backButton = container.querySelector('[data-action="back-to-search"]');
    if (backButton) {
      Sanitizer.setTextContent(backButton, 'Hide Results');
      backButton.setAttribute('data-action', 'hide-results');
      
      // Remove any existing click listeners to prevent duplicate handlers
      const newBackButton = backButton.cloneNode(true);
      backButton.parentNode.replaceChild(newBackButton, backButton);
      
      // Make sure completion banner is visible
      if (this.resultElement) {
        const completionBanner = this.resultElement.querySelector('.streaming-completion-banner');
        if (completionBanner) {
          completionBanner.style.display = 'block';
          
          // Update the Show Results button text
          const showResultsBtn = completionBanner.querySelector('[data-action="show-results"]');
          if (showResultsBtn) {
            Sanitizer.setTextContent(showResultsBtn, 'Show Results');
          }
        } else {
          // If banner doesn't exist, recreate it
          this._createCompletionBanner();
        }
      }
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
    const completionBanner = Sanitizer.createSafeElement('div', {
      class: 'streaming-completion-message streaming-completion-banner'
    });
    
    // Cache the completion banner for future reference
    this.domCache.completionBanner = completionBanner;
    
    // Create banner content structure
    const contentDiv = Sanitizer.createSafeElement('div', {
      class: 'completion-banner-content'
    });
    
    const messageDiv = Sanitizer.createSafeElement('div', {
      class: 'completion-message'
    });
    
    const messageText = Sanitizer.createSafeElement('p', {}, 
      `Completed processing ${this.allResults?.length || 0} bundle IDs`);
    
    const actionButtons = Sanitizer.createSafeElement('div', {
      class: 'action-buttons'
    });
    
    const showResultsButton = Sanitizer.createSafeElement('button', {
      class: 'primary-btn extract-btn',
      'data-action': 'show-results'
    }, 'Show Results');
    
    // Assemble the banner
    messageDiv.appendChild(messageText);
    actionButtons.appendChild(showResultsButton);
    
    contentDiv.appendChild(messageDiv);
    contentDiv.appendChild(actionButtons);
    
    completionBanner.appendChild(contentDiv);
    
    // Add to the result element
    this.resultElement.prepend(completionBanner);
    
    // Set up styles to match other buttons
    const buttonElements = completionBanner.querySelectorAll('button');
    buttonElements.forEach(button => {
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
   * Standardized error handling method
   * @param {Error} error - The error that occurred
   * @param {string} context - Context description for the error
   * @param {Object} options - Additional options for error handling
   * @param {boolean} options.logToConsole - Whether to log to console (default: true)
   * @param {boolean} options.showNotification - Whether to show UI notification (default: true)
   * @param {boolean} options.showInUI - Whether to show in result area (default: false)
   * @returns {boolean} Always returns false to indicate error
   * @private
   */
  _handleError(error, context = 'Error', options = {}) {
    // Set default options
    const settings = {
      logToConsole: true,
      showNotification: true,
      showInUI: false,
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
    if (settings.showInUI && this.resultElement) {
      DOMUtils.showError('result', errorMessage);
    }
    
    // Always return false to indicate error
    return false;
  }
  
}

// Create and export a singleton instance
const streamResultsRenderer = new StreamResultsRenderer();
/**
 * Update UI to reflect streaming completion
 * @param {Object} stats - Final statistics object
 * @private
 */
streamResultsRenderer._updateCompletionStatus = function(stats) {
  if (!this.resultElement) return;
  
  try {
    // Create a streaming completion banner
    const completionBanner = Sanitizer.createSafeElement('div', {
      class: 'streaming-completion-message streaming-completion-banner'
    });
    
    // Cache the completion banner for future reference
    this.domCache.completionBanner = completionBanner;
    
    // Format time in a readable way
    const timeInSeconds = stats.elapsedTime / 1000;
    const timeDisplay = timeInSeconds >= 60 
      ? `${(timeInSeconds / 60).toFixed(1)} minutes` 
      : `${timeInSeconds.toFixed(1)} seconds`;
    
    // Create banner content structure
    const contentDiv = Sanitizer.createSafeElement('div', {
      class: 'completion-banner-content'
    });
    
    const messageDiv = Sanitizer.createSafeElement('div', {
      class: 'completion-message'
    });
    
    const messageText = Sanitizer.createSafeElement('p', {}, 
      `Completed processing ${stats.total} bundle IDs (${stats.errors} errors) in ${timeDisplay}`);
    
    const actionButtons = Sanitizer.createSafeElement('div', {
      class: 'action-buttons'
    });
    
    const downloadButton = Sanitizer.createSafeElement('button', {
      class: 'primary-btn extract-btn download-csv-btn',
      'data-action': 'download-csv',
      id: 'main-download-csv-btn'
    }, 'Download CSV Results');
    
    const showResultsButton = Sanitizer.createSafeElement('button', {
      class: 'primary-btn extract-btn',
      'data-action': 'show-results'
    }, 'Show Results');
    
    // Assemble the banner
    messageDiv.appendChild(messageText);
    
    actionButtons.appendChild(downloadButton);
    actionButtons.appendChild(showResultsButton);
    
    contentDiv.appendChild(messageDiv);
    contentDiv.appendChild(actionButtons);
    
    completionBanner.appendChild(contentDiv);
    
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
    const buttonElements = completionBanner.querySelectorAll('button');
    buttonElements.forEach(button => {
      button.style.marginLeft = '5px';
      button.style.marginRight = '5px';
    });
    
    // NOTE: We're not directly attaching an event listener to show/hide buttons anymore.
    // Instead, the buttons have data-action="show-results" or data-action="hide-results"
    // which are handled by the global event handler in event-handler.js
    
    // CSV export event handling is centralized in EventHandler
  } catch (err) {
    // Use standardized error handling for completion status updates
    this._handleError(err, 'Failed to update completion status', {
      // This is visible to users but not critical to functionality
      showInUI: false
    });
  }
};

export default streamResultsRenderer;