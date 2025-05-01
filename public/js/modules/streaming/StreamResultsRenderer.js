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
    
    // Create minimal structure with just the worker info banner - 
    // Progress bars and stats are handled by the VisualIndicators module
    resultElement.innerHTML = `
      <!-- Results preview notification -->
      <div class="streaming-info-banner worker-processing-indicator" style="margin: 20px 0; padding: 15px; background: #f1f8ff; border: 1px solid #0366d6; border-radius: 4px; text-align: center;">
        <h3 style="margin-top: 0; color: #0366d6;">⚙️ Worker Processing... ${totalItems} bundle IDs</h3>
        <p>Results will be available when processing is complete.</p>
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
    
    // Update worker processing indicator
    const workerIndicator = this.resultElement.querySelector('.worker-processing-indicator h3');
    if (workerIndicator && stats.total > 0) {
      const percent = Math.min(100, Math.round((stats.processed / stats.total) * 100));
      workerIndicator.textContent = `⚙️ Worker Processing... ${percent}% complete (${stats.processed} of ${stats.total})`;
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
    
    // Replace any existing results section or add to the page
    const existingResults = this.resultElement.querySelector('.stream-results-display');
    if (existingResults) {
      existingResults.parentNode.replaceChild(resultsDisplay, existingResults);
    } else {
      this.resultElement.appendChild(resultsDisplay);
    }
    
    // Get the tbody element
    const tbody = resultsDisplay.querySelector('#results-final-tbody');
    if (!tbody) return;
    
    // Add each result
    if (results && results.length > 0) {
      results.forEach(result => {
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
  
  // Create a new completion banner to replace the worker progress indicator
  const completionBanner = document.createElement('div');
  completionBanner.className = 'streaming-completion-banner';
  completionBanner.style.cssText = 'margin: 20px 0; padding: 15px; background: #eafaf1; border: 1px solid #2ecc71; border-radius: 4px; text-align: center;';
  
  // Format time in a readable way
  const timeInSeconds = stats.elapsedTime / 1000;
  const timeDisplay = timeInSeconds >= 60 
    ? `${(timeInSeconds / 60).toFixed(1)} minutes` 
    : `${timeInSeconds.toFixed(1)} seconds`;
    
  completionBanner.innerHTML = `
    <h3 style="margin-top: 0; color: #2ecc71;">✅ Processing Complete</h3>
    <p>All ${stats.total} bundle IDs have been processed in ${timeDisplay}.</p>
    <div class="action-buttons">
      <button class="results-btn primary" data-action="show-results" style="margin-top: 10px; padding: 8px 16px; background: #2ecc71; color: white; border: none; border-radius: 4px; cursor: pointer;">
        Show Results
      </button>
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
  
  // Add event listener to the show results button
  const showResultsBtn = completionBanner.querySelector('[data-action="show-results"]');
  if (showResultsBtn) {
    showResultsBtn.addEventListener('click', () => {
      // Import AppState directly to ensure we get the latest results
      import('../app-state.js').then(module => {
        const appState = module.default;
        // Show the results immediately
        this.showResults(appState?.results || []);
        
        // Remove the banner after showing results
        completionBanner.style.display = 'none';
      }).catch(error => {
        console.error('Error importing AppState for showing results:', error);
        // Fallback to window.AppState
        this.showResults(window.AppState?.results || []);
        completionBanner.style.display = 'none';
      });
    });
  }
};

export default streamResultsRenderer;