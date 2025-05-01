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
    
    // Check if the result element already has our UI setup
    if (resultElement.querySelector('#stream-progress-indicator')) {
      console.log('🔄 StreamResultsRenderer: UI already initialized, skipping');
      return;
    }
    
    console.log('🔄 StreamResultsRenderer: Initializing UI with', totalItems, 'items');
    
    // Create initial structure - PROGRESS MONITORING ONLY VERSION (NO REAL-TIME RESULTS)
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
      
      <!-- Enhanced progress display -->
      <div id="stream-progress-indicator" class="progress-indicator" style="display: flex; margin: 15px 0; align-items: center;">
        <div class="progress-bar" style="flex: 1; background: #f0f0f0; border-radius: 4px; height: 20px; overflow: hidden; margin-right: 10px;">
          <div style="width: 0%; height: 100%; background: linear-gradient(90deg, #3498db, #2980b9); transition: width 0.3s ease;"></div>
        </div>
        <span class="progress-text" style="white-space: nowrap; font-weight: bold;">0% (0/${totalItems})</span>
      </div>
      
      <!-- Enhanced debug panel -->
      <div id="debug-information" class="debug-info" style="margin-bottom: 20px; padding: 15px; background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 4px; font-family: monospace; font-size: 13px; white-space: pre-line;">
        <strong>Stream Processing Debug Info:</strong>
        Waiting for server connection...
      </div>
      
      <!-- Results preview notification -->
      <div class="streaming-info-banner worker-processing-indicator" style="margin: 20px 0; padding: 15px; background: #f1f8ff; border: 1px solid #0366d6; border-radius: 4px; text-align: center;">
        <h3 style="margin-top: 0; color: #0366d6;">⚙️ Worker Processing... ${totalItems} bundle IDs</h3>
        <p>Results will be available when processing is complete. You can monitor progress above.</p>
        <p class="processing-note" style="font-style: italic; margin-top: 10px;">For performance reasons, results will be displayed only after all processing is complete.</p>
        <div style="margin-top: 15px; height: 4px; background: linear-gradient(90deg, #0366d6 0%, transparent 50%, #0366d6 100%); background-size: 200% 100%; animation: streaming-animation 1.5s infinite linear; border-radius: 2px;"></div>
      </div>
      
      <!-- Hidden container for accumulating results -->
      <div id="results-container" style="display: none;"></div>
    `;
    
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
    this._setupEventListeners();
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
    
    const summaryElement = this.resultElement.querySelector('.results-summary .summary-stats');
    if (!summaryElement) return;
    
    // Update each stat element
    const processedElement = summaryElement.querySelector('span:nth-child(1) strong');
    const successElement = summaryElement.querySelector('.success-count strong');
    const errorElement = summaryElement.querySelector('.error-count strong');
    const appAdsElement = summaryElement.querySelector('.app-ads-count strong');
    
    if (processedElement) processedElement.textContent = stats.processed || 0;
    if (successElement) successElement.textContent = stats.success || 0;
    if (errorElement) errorElement.textContent = stats.errors || 0;
    if (appAdsElement) appAdsElement.textContent = stats.withAppAds || 0;
    
    // Update progress visualization
    this.updateProgressUI(stats);
  }
  
  /**
   * Update progress visualization in the UI
   * @param {Object} stats - Statistics object containing processed and total counts
   */
  updateProgressUI(stats) {
    if (!this.resultElement) return;
    
    // Update progress bar if available
    const progressBar = this.resultElement.querySelector('#stream-progress-indicator .progress-bar div');
    const progressText = this.resultElement.querySelector('#stream-progress-indicator .progress-text');
    
    if (progressBar && progressText && stats.total > 0) {
      const percent = Math.min(100, Math.round((stats.processed / stats.total) * 100));
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `${percent}% (${stats.processed}/${stats.total})`;
      
      // Update debug information
      const debugInfo = this.resultElement.querySelector('#debug-information');
      if (debugInfo) {
        const currentTime = new Date().toLocaleTimeString();
        const processingRate = stats.processed > 0 && stats.elapsedTime > 0 
          ? (stats.processed / (stats.elapsedTime / 1000)).toFixed(2) 
          : 'calculating...';
          
        debugInfo.innerHTML = `
          <strong>Stream Processing Debug Info:</strong>
          Time: ${currentTime}
          Processed: ${stats.processed} / ${stats.total} (${percent}%)
          Processing rate: ${processingRate} items/sec
          Success: ${stats.success || 0}
          Errors: ${stats.errors || 0}
          Items with app-ads.txt: ${stats.withAppAds || 0}
        `;
      }
      
      // Update download button state when processing is complete
      const downloadBtn = this.resultElement.querySelector('.download-btn');
      if (downloadBtn && stats.processed === stats.total) {
        downloadBtn.disabled = false;
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
    
    console.log('🔄 StreamResultsRenderer: Showing results of processing', results.length, 'items');
    
    // Create a results display element
    const resultsDisplay = document.createElement('div');
    resultsDisplay.className = 'stream-results-display';
    resultsDisplay.innerHTML = `
      <div class="stream-results-header">
        <h3>Processing Results</h3>
        <p>These are the extracted results from your bundle IDs.</p>
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
    `;
    
    // Add to the page
    this.resultElement.appendChild(resultsDisplay);
    
    // Get the tbody element
    const tbody = resultsDisplay.querySelector('#results-final-tbody');
    if (!tbody) return;
    
    // Add each result
    if (results.length > 0) {
      results.forEach(result => {
        const row = document.createElement('tr');
        row.className = result.success ? 'success-row' : 'error-row';
        
        if (result.success) {
          const hasAppAds = result.appAdsTxt?.exists;
          
          row.innerHTML = `
            <td>${DOMUtils.escapeHtml(result.bundleId)}</td>
            <td>${DOMUtils.escapeHtml(getStoreDisplayName(result.storeType))}</td>
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
            <td>${DOMUtils.escapeHtml(result.bundleId)}</td>
            <td colspan="3" class="error-message">
              Error: ${DOMUtils.escapeHtml(result.error || 'Unknown error')}
            </td>
            <td></td>
          `;
        }
        
        tbody.appendChild(row);
      });
    }
    
    // Scroll to the results
    resultsDisplay.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  
  // Update the streaming banner
  const banner = this.resultElement.querySelector('.streaming-info-banner');
  if (banner) {
    banner.innerHTML = `
      <h3 style="margin-top: 0; color: #2ecc71;">✅ Processing Complete</h3>
      <p>All ${stats.total} bundle IDs have been processed successfully.</p>
      <ul style="text-align: left; max-width: 400px; margin: 10px auto;">
        <li><strong>Processed:</strong> ${stats.total}</li>
        <li><strong>Success:</strong> ${stats.success}</li>
        <li><strong>Errors:</strong> ${stats.errors}</li>
        <li><strong>With app-ads.txt:</strong> ${stats.withAppAds}</li>
        <li><strong>Processing Time:</strong> ${(stats.elapsedTime / 1000).toFixed(2)}s</li>
      </ul>
      <div class="action-buttons">
        <button class="results-btn primary" data-action="show-results" style="margin-top: 10px; padding: 8px 16px; background: #2ecc71; color: white; border: none; border-radius: 4px; cursor: pointer;">
          Show Results
        </button>
      </div>
    `;
    
    // Change the banner color to indicate success
    banner.style.background = '#eafaf1';
    banner.style.border = '1px solid #2ecc71';
    
    // Add event listener to the show results button
    const showResultsBtn = banner.querySelector('[data-action="show-results"]');
    if (showResultsBtn) {
      showResultsBtn.addEventListener('click', function() {
        // Dispatch an event to notify that the user wants to see the results
        window.dispatchEvent(new CustomEvent('streaming-show-results', {
          detail: { timestamp: Date.now() }
        }));
      });
    }
  }
  
  // Remove the worker processing indicator
  const workerIndicator = document.querySelector('.worker-processing-indicator');
  if (workerIndicator) {
    workerIndicator.style.display = 'none';
  }
  
  // Update debug panel
  const debugInfo = this.resultElement.querySelector('#debug-information');
  if (debugInfo) {
    const finishTime = new Date().toLocaleTimeString();
    debugInfo.innerHTML = `
      <strong>Stream Processing Complete ✅</strong>
      Completed at: ${finishTime}
      Total time: ${(stats.elapsedTime / 1000).toFixed(2)}s
      Average rate: ${(stats.total / (stats.elapsedTime / 1000)).toFixed(2)} items/sec
      Results: ${stats.success} successes, ${stats.errors} errors, ${stats.withAppAds} with app-ads.txt
    `;
  }
  
  // Ensure the download button is enabled
  const downloadBtn = this.resultElement.querySelector('.download-btn');
  if (downloadBtn) {
    downloadBtn.disabled = false;
  }
  
  // Notify that processing is complete through a custom event
  window.dispatchEvent(new CustomEvent('streaming-processing-complete', {
    detail: {
      stats: stats,
      timestamp: Date.now()
    }
  }));
};

export default streamResultsRenderer;