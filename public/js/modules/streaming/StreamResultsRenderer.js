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
    
    // Listen for stream completion events to show results
    window.addEventListener('streaming-show-results', (event) => {
      console.log('🔄 StreamResultsRenderer: Received show-results event');
      const appState = window.AppState || {};
      const results = appState.results || [];
      
      // Show the results UI
      this.showResults(results);
    });
  }
  
  /**
   * Initialize UI for displaying results
   * @param {HTMLElement} container - Container element
   * @param {number} totalItems - Total items to process
   * @param {boolean} hasSearchTerms - Whether the query includes search terms
   */
  initializeUI(container, totalItems, hasSearchTerms) {
    this.hasSearchTerms = hasSearchTerms;
    
    // Get or find container element
    const resultElement = container || document.getElementById('result');
    if (!resultElement) return;
    
    this.resultElement = resultElement;
    
    // Perform thorough cleanup of all existing elements
    this._cleanupPreviousElements();
    
    console.log('🔄 StreamResultsRenderer: Initializing UI with', totalItems, 'items');
    
    // First check if we already have any progress indicators
    // Remove all existing visual-indicators-container to avoid overlap
    const existingProgressIndicators = document.querySelectorAll('.visual-indicators-container');
    existingProgressIndicators.forEach(indicator => {
      if (indicator && indicator.parentNode) {
        indicator.parentNode.removeChild(indicator);
      }
    });
    
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
    
    // Create results container
    const resultsContainer = document.createElement('div');
    resultsContainer.id = 'results-container';
    resultsContainer.style.display = 'none';
    
    // Clear the result element's existing content
    resultElement.innerHTML = '';
    
    // Add our new elements
    resultElement.appendChild(workerIndicator);
    resultElement.appendChild(resultsContainer);
    
    // Add animation styles
    const style = document.createElement('style');
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
    
    // Show the result element
    resultElement.style.display = 'block';
    
    // Add event listeners for toggles
    this._setupEventListeners(resultElement);
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
    
    // Find and remove all these elements
    elementsToRemove.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(element => {
        if (element && element.parentNode) {
          console.log(`🔄 StreamResultsRenderer: Removing ${selector} element`);
          element.parentNode.removeChild(element);
        }
      });
    });
    
    // Clear any progress messages or indicators without specific classes
    if (this.resultElement) {
      // Find any elements that might contain progress-related text
      const allElements = this.resultElement.querySelectorAll('*');
      allElements.forEach(element => {
        if (element.textContent && (
          element.textContent.includes('Processing') || 
          element.textContent.includes('Sending request') ||
          element.textContent.includes('Worker')) &&
          !element.classList.contains('stream-results-display')) {
          console.log('🔄 StreamResultsRenderer: Removing text-matched element');
          element.remove();
        }
      });
    }
  }
  
  /**
   * Add event listeners for interactive elements
   * @private
   */
  _setupEventListeners() {
    // Use event delegation on document
    document.addEventListener('click', (event) => {
      // Check if the clicked element has a data-action attribute
      const action = event.target.dataset?.action || event.target.closest('[data-action]')?.dataset.action;
      
      if (!action) return;
      
      // Handle toggle-ads action (show app-ads.txt details)
      if (action === 'toggle-ads') {
        const targetId = event.target.dataset.target || event.target.closest('[data-target]').dataset.target;
        const targetElement = document.getElementById(targetId);
        
        if (targetElement) {
          const isExpanded = targetElement.style.display !== 'none';
          targetElement.style.display = isExpanded ? 'none' : 'block';
          
          // Update button text and aria attributes
          const button = event.target.closest('[data-action="toggle-ads"]');
          if (button) {
            button.textContent = isExpanded ? 'Show app-ads.txt' : 'Hide app-ads.txt';
            button.setAttribute('aria-expanded', !isExpanded);
          }
        }
      }
      
      // Handle toggle-matches action (show search matches)
      if (action === 'toggle-matches') {
        const targetId = event.target.dataset.target || event.target.closest('[data-target]').dataset.target;
        const targetElement = document.getElementById(targetId);
        
        if (targetElement) {
          const isExpanded = targetElement.style.display !== 'none';
          targetElement.style.display = isExpanded ? 'none' : 'block';
          
          // Update button text and aria attributes
          const button = event.target.closest('[data-action="toggle-matches"]');
          if (button) {
            button.textContent = isExpanded ? 'Show matches' : 'Hide matches';
            button.setAttribute('aria-expanded', !isExpanded);
          }
        }
      }
      
      // Handle copy action
      if (action === 'copy') {
        const text = event.target.dataset.copy || event.target.closest('[data-copy]').dataset.copy;
        if (text) {
          navigator.clipboard.writeText(text)
            .then(() => {
              // Show a small notification
              const button = event.target.closest('[data-action="copy"]');
              if (button) {
                const originalText = button.textContent;
                button.textContent = 'Copied!';
                setTimeout(() => {
                  button.textContent = originalText;
                }, 1500);
              }
            })
            .catch(err => {
              console.error('Failed to copy text:', err);
            });
        }
      }
      
      // Handle tab switching
      if (action === 'tab-switch') {
        const tabId = event.target.dataset.tab || event.target.closest('[data-tab]').dataset.tab;
        if (tabId) {
          // Hide all tab contents
          const tabContents = document.querySelectorAll('.search-tab-content');
          tabContents.forEach(tab => {
            tab.classList.remove('active');
            tab.setAttribute('aria-hidden', 'true');
          });
          
          // Deactivate all tab buttons
          const tabButtons = document.querySelectorAll('.search-tab');
          tabButtons.forEach(btn => {
            btn.classList.remove('active');
            btn.setAttribute('aria-selected', 'false');
          });
          
          // Activate the selected tab
          const targetTab = document.getElementById(tabId);
          if (targetTab) {
            targetTab.classList.add('active');
            targetTab.setAttribute('aria-hidden', 'false');
          }
          
          // Activate the selected tab button
          const button = event.target.closest('[data-tab]');
          if (button) {
            button.classList.add('active');
            button.setAttribute('aria-selected', 'true');
          }
        }
      }
    });
  }
  
  /**
   * Update the summary statistics in the UI
   * @param {Object} stats - Statistics object
   * @private
   */
  updateSummaryStats(stats) {
  if (!this.resultElement) return;
  
  // Update worker processing indicator
  const workerIndicator = this.resultElement.querySelector('.worker-processing-indicator h3');
  if (workerIndicator) {
    // Fix for NaN% issue - ensure both values are valid numbers
    let percent = 0;
    const processedCount = typeof stats.processed === 'number' ? stats.processed : 0;
    const totalCount = typeof stats.total === 'number' && stats.total > 0 ? stats.total : this.stats?.totalBundleIds || 0;
    
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
    
    // Always update the progress bar if it exists
    const progressBar = this.resultElement.querySelector('.worker-processing-indicator .progress-bar');
    if (progressBar && percent > 0) {
      progressBar.style.width = `${percent}%`;
    }
  }
}

  /**
   * Render a batch of results
   * @param {Array} results - Results to render
   * @param {Array} searchTerms - Search terms for highlighting
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
      
      // Update summary stats with the new counts
      this.updateSummaryStats({
        processed: results.length,
        success: successCount,
        errors: errorCount,
        withAppAds: withAppAds,
        // Don't update the total here as it might overwrite the correct total
      });
      
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
    
    // Make sure completion banner stays visible when showing results
    const completionBanner = this.resultElement.querySelector('.streaming-completion-banner');
    if (completionBanner) {
      completionBanner.style.display = 'block';
      
      // Update Show Results button text
      const showResultsBtn = completionBanner.querySelector('[data-action="show-results"]');
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
    
    // Store the full results for pagination
    this.allResults = results;
    
    // Set up pagination variables
    this.pageSize = 50;
    this.currentPage = 1;
    this.totalPages = Math.ceil(results.length / this.pageSize);
    
    // Create a results display element
    const resultsDisplay = document.createElement('div');
    resultsDisplay.className = 'stream-results-display';
    
    // Add hide results button with streamlined actions
    resultsDisplay.innerHTML = `
      <div class="stream-results-header">
        <div class="results-header-top" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
          <h3>Processing Results</h3>
          <div class="action-buttons" style="display: flex; gap: 10px;">
            <button class="extract-btn" data-action="hide-results">Hide Results</button>
            <button class="extract-btn" data-action="stream-download-csv">Download CSV</button>
          </div>
        </div>
        <p>Showing ${results.length} extracted results from your bundle IDs.</p>
      </div>
      
      <div class="stream-results-table-container" style="margin-top: 20px; overflow-x: auto;">
        <table class="results-table" style="width: 100%; border-collapse: collapse; border: 1px solid #e0e0e0;">
          <thead>
            <tr>
              <th>Bundle ID</th>
              <th>Store</th>
              <th>Domain</th>
              <th>app-ads.txt</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="results-final-tbody">
            ${results.length === 0 ? '<tr><td colspan="5" style="text-align: center; padding: 20px;">No results found</td></tr>' : ''}
          </tbody>
        </table>
      </div>
      
      <!-- Pagination Controls -->
      <div id="pagination-controls" style="margin-top: 20px; text-align: center;">
        ${this._generatePaginationControls(results.length, this.pageSize, 1)}
      </div>
    `;
    
    // Replace any existing results section or add to the page
    const existingResults = this.resultElement.querySelector('.stream-results-display');
    if (existingResults) {
      existingResults.parentNode.replaceChild(resultsDisplay, existingResults);
    } else {
      this.resultElement.appendChild(resultsDisplay);
    }
    
    // Set up event listeners for pagination and back button
    this._setupEventListeners(resultsDisplay);
    
    // Render the first page of results
    this._renderPage(results, 1);
    
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
    
    // Get the tbody element
    const tbody = document.getElementById('results-final-tbody');
    if (!tbody) return;
    
    // Clear existing rows
    tbody.innerHTML = '';
    
    // Add results for this page
    pageResults.forEach(result => {
      if (!result) return; // Skip null/undefined results
      
      const row = document.createElement('tr');
      row.className = result.success ? 'success-row' : 'error-row';
      
      if (result.success) {
        const hasAppAds = result.appAdsTxt?.exists;
        
        row.innerHTML = `
          <td>${DOMUtils.escapeHtml(result.bundleId || '')}</td>
          <td>${DOMUtils.escapeHtml(getStoreDisplayName(result.storeType || ''))}</td>
          <td class="domain-cell">${DOMUtils.escapeHtml(result.domain || 'N/A')}</td>
          <td class="app-ads-cell">
            ${hasAppAds 
              ? '<span class="app-ads-found">Found</span>' 
              : '<span class="app-ads-missing">Not found</span>'}
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
          <td></td>
        `;
      }
      
      tbody.appendChild(row);
    });
    
    // Update pagination controls
    const paginationControls = document.getElementById('pagination-controls');
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
    let paginationHTML = '<div class="pagination" style="display: flex; justify-content: center; gap: 5px; align-items: center;">';
    
    // Previous button
    if (currentPage > 1) {
      paginationHTML += `<button class="pagination-btn" data-action="paginate" data-page="${currentPage - 1}" style="padding: 5px 10px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;">← Previous</button>`;
    } else {
      paginationHTML += `<button class="pagination-btn disabled" style="padding: 5px 10px; border: 1px solid #ddd; border-radius: 4px; opacity: 0.5; cursor: not-allowed;">← Previous</button>`;
    }
    
    // Page numbers
    paginationHTML += '<div class="page-numbers" style="display: flex; gap: 5px;">';
    
    // First page
    if (currentPage > 3) {
      paginationHTML += `<button class="pagination-btn" data-action="paginate" data-page="1" style="padding: 5px 10px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;">1</button>`;
      
      if (currentPage > 4) {
        paginationHTML += '<span class="pagination-ellipsis" style="align-self: center;">...</span>';
      }
    }
    
    // Pages around current
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);
    
    for (let i = startPage; i <= endPage; i++) {
      if (i === currentPage) {
        paginationHTML += `<button class="pagination-btn active" data-page="${i}" style="padding: 5px 10px; border: 1px solid #3498db; background: #3498db; color: white; border-radius: 4px;">${i}</button>`;
      } else {
        paginationHTML += `<button class="pagination-btn" data-action="paginate" data-page="${i}" style="padding: 5px 10px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;">${i}</button>`;
      }
    }
    
    // Last page
    if (currentPage < totalPages - 2) {
      if (currentPage < totalPages - 3) {
        paginationHTML += '<span class="pagination-ellipsis" style="align-self: center;">...</span>';
      }
      
      paginationHTML += `<button class="pagination-btn" data-action="paginate" data-page="${totalPages}" style="padding: 5px 10px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;">${totalPages}</button>`;
    }
    
    paginationHTML += '</div>';
    
    // Next button
    if (currentPage < totalPages) {
      paginationHTML += `<button class="pagination-btn" data-action="paginate" data-page="${currentPage + 1}" style="padding: 5px 10px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;">Next →</button>`;
    } else {
      paginationHTML += `<button class="pagination-btn disabled" style="padding: 5px 10px; border: 1px solid #ddd; border-radius: 4px; opacity: 0.5; cursor: not-allowed;">Next →</button>`;
    }
    
    paginationHTML += '</div>';
    
    // Add page info
    paginationHTML += `
      <div class="pagination-info" style="margin-top: 10px; font-size: 14px; color: #666;">
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
    
    // Pagination buttons and Download CSV
    if (container) {
      container.addEventListener('click', (event) => {
        const target = event.target;
        // Handle pagination
        if (target && target.dataset && target.dataset.action === 'paginate') {
          const page = parseInt(target.dataset.page, 10);
          if (!isNaN(page) && page > 0) {
            this._renderPage(this.allResults, page);
          }
        }
        
        // Handle CSV export buttons (both in results view and completion banner)
        if (target && target.dataset && (target.dataset.action === 'download-csv' || target.dataset.action === 'stream-download-csv')) {
          // Import streaming processor
          import('./StreamProcessor.js').then(module => {
            const StreamProcessor = module.default;
            // Get bundle IDs and search terms
            const AppState = window.AppState || {};
            const bundleIds = AppState.bundleIds || [];
            const searchTerms = AppState.searchTerms || [];
            
            // Call export CSV function
            if (StreamProcessor && typeof StreamProcessor.exportCsv === 'function') {
              StreamProcessor.exportCsv(bundleIds, searchTerms);
            }
          }).catch(error => {
            console.error('Error importing StreamProcessor for CSV export:', error);
          });
        }
      });
    }
  }
  
  /**
   * Create a completion banner
   * @private
   */
  _createCompletionBanner() {
    const completionBanner = document.createElement('div');
    completionBanner.className = 'streaming-completion-message streaming-completion-banner';
    completionBanner.style.cssText = 'margin: 20px 0; padding: 10px 15px; background: #eafaf1; border: 1px solid #2ecc71; border-radius: 4px; text-align: center;';
    
    completionBanner.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div>
          <p style="margin: 0; color: #2ecc71; font-weight: 500;">Completed processing ${this.allResults?.length || 0} bundle IDs</p>
        </div>
        <div class="action-buttons" style="display: flex; gap: 10px;">
          <button class="extract-btn" data-action="stream-download-csv">
            Download CSV
          </button>
          <button class="extract-btn" data-action="show-results">
            Show Results
          </button>
        </div>
      </div>
    `;
    
    // Add to the result element
    this.resultElement.prepend(completionBanner);
    
    // Add event listeners for both buttons
    const showResultsBtn = completionBanner.querySelector('[data-action="show-results"]');
    const downloadBtn = completionBanner.querySelector('[data-action="stream-download-csv"]');
    
    // Set up styles to match other buttons
    const actionButtons = completionBanner.querySelectorAll('button');
    actionButtons.forEach(button => {
      button.style.marginLeft = '5px';
      button.style.marginRight = '5px';
    });
    
    // Show/Hide results button event listener
    if (showResultsBtn) {
      showResultsBtn.addEventListener('click', () => {
        // Check if results are already displayed
        const resultsDisplay = this.resultElement.querySelector('.stream-results-display');
        const isResultsDisplayVisible = resultsDisplay && resultsDisplay.style.display !== 'none';
        
        // Toggle the display state
        if (isResultsDisplayVisible) {
          // Hide results
          resultsDisplay.style.display = 'none';
          showResultsBtn.textContent = 'Show Results';
        } else {
          // Show results - keep completion banner visible
          if (resultsDisplay) {
            resultsDisplay.style.display = 'block';
            resultsDisplay.scrollIntoView({ behavior: 'smooth', block: 'start' });
            showResultsBtn.textContent = 'Hide Results';
          } else {
            // If results don't exist yet, render them
            this._renderResults(this.allResults || []);
            showResultsBtn.textContent = 'Hide Results';
          }
        }
      });
    }
    
    // We don't need to add the event listener here anymore
    // The event is now handled globally in the EventHandler via data-action="stream-download-csv"
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
  
  // Create a simple green success message instead of a full banner
  const completionBanner = document.createElement('div');
  completionBanner.className = 'streaming-completion-message streaming-completion-banner';
  completionBanner.style.cssText = 'margin: 20px 0; padding: 10px 15px; background: #eafaf1; border: 1px solid #2ecc71; border-radius: 4px; text-align: center;';
  
  // Format time in a readable way
  const timeInSeconds = stats.elapsedTime / 1000;
  const timeDisplay = timeInSeconds >= 60 
    ? `${(timeInSeconds / 60).toFixed(1)} minutes` 
    : `${timeInSeconds.toFixed(1)} seconds`;
    
  completionBanner.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between;">
      <div>
        <p style="margin: 0; color: #2ecc71; font-weight: 500;">Completed processing ${stats.total} bundle IDs (${stats.errors} errors) in ${timeDisplay}</p>
      </div>
      <div class="action-buttons" style="display: flex; gap: 10px;">
        <button class="extract-btn" data-action="stream-download-csv">
          Download CSV
        </button>
        <button class="extract-btn" data-action="show-results">
          Show Results
        </button>
      </div>
    </div>
  `;
  
  // First hide the worker processing indicator
  const workerIndicator = this.resultElement.querySelector('.worker-processing-indicator');
  if (workerIndicator) {
    // Replace it with the completion banner
    workerIndicator.parentNode.replaceChild(completionBanner, workerIndicator);
  } else {
    // If for some reason we can't find it, just append the banner
    this.resultElement.appendChild(completionBanner);
  }
  
  // Add event listeners for both buttons
  const showResultsBtn = completionBanner.querySelector('[data-action="show-results"]');
  const downloadBtn = completionBanner.querySelector('[data-action="stream-download-csv"]');
  
  // Set up styles to match other buttons
  const actionButtons = completionBanner.querySelectorAll('button');
  actionButtons.forEach(button => {
    button.style.marginLeft = '5px';
    button.style.marginRight = '5px';
  });
  
  // Show/Hide results button event listener
  if (showResultsBtn) {
    showResultsBtn.addEventListener('click', () => {
      // Check if results are already displayed
      const resultsDisplay = this.resultElement.querySelector('.stream-results-display');
      const isResultsDisplayVisible = resultsDisplay && resultsDisplay.style.display !== 'none';
      
      if (isResultsDisplayVisible) {
        // Hide results
        resultsDisplay.style.display = 'none';
        showResultsBtn.textContent = 'Show Results';
      } else {
        // Import AppState directly to ensure we get the latest results
        import('../app-state.js').then(module => {
          const appState = module.default;
          
          // Show the results immediately - keep banner visible
          this.showResults(appState?.results || []);
          
          // Update button text
          showResultsBtn.textContent = 'Hide Results';
        }).catch(error => {
          console.error('Error importing AppState for showing results:', error);
          // Fallback to window.AppState
          this.showResults(window.AppState?.results || []);
          showResultsBtn.textContent = 'Hide Results';
        });
      }
    });
  }
  
  // We don't need to add the event listener here anymore
  // The event is now handled globally in the EventHandler via data-action="stream-download-csv"
};

export default streamResultsRenderer;