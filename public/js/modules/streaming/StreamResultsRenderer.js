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
    
    // Create initial structure
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
      <div id="streamProgress" class="progress-indicator" style="display: flex; margin-bottom: 15px; align-items: center;">
        <div class="progress-bar" style="flex: 1; background: #f0f0f0; border-radius: 4px; height: 20px; overflow: hidden; margin-right: 10px;">
          <div style="width: 0%; height: 100%; background: linear-gradient(90deg, #3498db, #2980b9); transition: width 0.3s ease;"></div>
        </div>
        <span class="progress-text" style="white-space: nowrap; font-weight: bold;">0%</span>
      </div>
      
      <!-- Enhanced debug panel -->
      <div id="debug-information" class="debug-info" style="margin-bottom: 20px; padding: 15px; background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 4px; font-family: monospace; font-size: 13px; white-space: pre-line;">
        <strong>Stream Processing Debug Info:</strong>
        Waiting for server connection...
      </div>
      
      <div class="results-table-container">
        <table class="results-table">
          <thead>
            <tr>
              <th scope="col">Bundle ID</th>
              <th scope="col">Store</th>
              <th scope="col">Domain</th>
              <th scope="col">App-ads.txt</th>
              ${hasSearchTerms ? '<th scope="col">Search Matches</th>' : ''}
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody id="results-tbody">
          </tbody>
        </table>
      </div>
      <div class="details-container" id="details-container"></div>
    `;
    
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
   * Render a batch of results
   * @param {Array} results - Results to render
   * @param {Array} searchTerms - Search terms for highlighting
   */
  renderBatch(results, searchTerms = []) {
    if (!results || !results.length) return;
    
    const tbody = document.getElementById('results-tbody');
    const detailsContainer = document.getElementById('details-container');
    
    if (!tbody) return;
    
    // Create a document fragment for batch DOM updates
    const fragment = document.createDocumentFragment();
    const tempDiv = document.createElement('div');
    
    // Process all results
    results.forEach(result => {
      // Create row HTML
      const rowHtml = this._createResultRow(result, searchTerms);
      tempDiv.innerHTML = rowHtml;
      
      // Append row from temp div to fragment
      while (tempDiv.firstChild) {
        fragment.appendChild(tempDiv.firstChild);
      }
      
      // If detailed app-ads.txt info was provided, add to details container
      if (result.success && result.appAdsTxt?.exists && detailsContainer) {
        const detailsId = `app-ads-details-${results.indexOf(result) + 1}`;
        this._addAppAdsDetails(result, detailsId, searchTerms);
      }
    });
    
    // Update the DOM in a single operation
    tbody.appendChild(fragment);
  }
  
  /**
   * Create a result row HTML
   * @param {Object} result - Result object
   * @param {Array} searchTerms - Search terms
   * @returns {string} - HTML for table row
   * @private
   */
  _createResultRow(result, searchTerms = []) {
    if (result.success) {
      const hasAppAds = result.appAdsTxt?.exists;
      const detailsId = hasAppAds ? `app-ads-details-${Date.now()}-${Math.random().toString(36).substring(2, 7)}` : '';
      
      // Check if there are search matches
      const hasSearchMatches = hasAppAds && result.appAdsTxt.searchResults && 
                              result.appAdsTxt.searchResults.count > 0;
      const searchMatchCount = hasSearchMatches ? result.appAdsTxt.searchResults.count : 0;
      
      let html = `
        <tr class="success-row ${hasAppAds ? 'has-app-ads' : ''} ${hasSearchMatches ? 'has-search-matches' : ''}">
          <td>${DOMUtils.escapeHtml(result.bundleId)}</td>
          <td>${DOMUtils.escapeHtml(getStoreDisplayName(result.storeType))}</td>
          <td class="domain-cell">${DOMUtils.escapeHtml(result.domain || 'N/A')}</td>
          <td class="app-ads-cell">
      `;
      
      if (hasAppAds) {
        html += `
          <span class="app-ads-found">Found</span>
          <button class="toggle-app-ads" data-action="toggle-ads" data-target="${detailsId}" 
            type="button" aria-expanded="false" aria-controls="${detailsId}">
            Show app-ads.txt
          </button>
        `;
      } else {
        html += `<span class="app-ads-missing">Not found</span>`;
      }
      
      html += `</td>`;
      
      // Search matches cell if search terms provided
      if (this.hasSearchTerms) {
        html += `<td class="search-matches-cell">`;
        
        if (hasSearchMatches) {
          html += `<span class="search-matches-found">`;
          
          // For multi-term search, show color-coded indicators
          if (result.appAdsTxt.searchResults.termResults) {
            // Generate colored indicators for each term
            result.appAdsTxt.searchResults.termResults.forEach((termResult, termIndex) => {
              if (termResult.count > 0) {
                const colorClass = `term-match-${termIndex % 5}`;
                html += `<span class="term-match-indicator ${colorClass}">${termResult.count}</span> `;
              }
            });
          } else {
            // Fallback for single-term search
            html += `${searchMatchCount} matches`;
          }
          
          html += `</span>`;
          
          if (searchMatchCount > 0) {
            const targetId = `search-${detailsId}`;
            html += `
              <button class="toggle-search-matches" data-action="toggle-matches" data-target="${targetId}" 
                type="button" aria-expanded="false" aria-controls="${targetId}">
                Show matches
              </button>
            `;
          }
        } else {
          html += `<span class="search-matches-missing">No matches</span>`;
        }
        
        html += `</td>`;
      }
      
      // Actions cell
      html += `
        <td>
          <button class="table-copy-btn" data-action="copy" data-copy="${result.domain || ''}" 
            type="button" title="Copy domain to clipboard">Copy</button>
        </td>
      </tr>
      `;
      
      return html;
    } else {
      // Error row
      return `
        <tr class="error-row">
          <td>${DOMUtils.escapeHtml(result.bundleId)}</td>
          <td class="error-message" colspan="${this.hasSearchTerms ? 4 : 3}">
            Error: ${DOMUtils.escapeHtml(result.error || 'Unknown error')}
          </td>
          <td></td>
        </tr>
      `;
    }
  }
  
  /**
   * Add app-ads.txt details to the details container
   * @param {Object} result - Result object
   * @param {string} detailsId - Custom details ID
   * @param {Array} searchTerms - Search terms array
   * @private
   */
  _addAppAdsDetails(result, detailsId, searchTerms = []) {
    const detailsContainer = document.getElementById('details-container');
    if (!detailsContainer) return;
    
    // Limit content length for better performance
    const contentText = result.appAdsTxt.content && result.appAdsTxt.content.length > 10000 
      ? result.appAdsTxt.content.substring(0, 10000) + '...\n(truncated for performance)' 
      : (result.appAdsTxt.content || 'Content not available in streaming mode');
    
    // Create a document fragment for better performance
    const tempDiv = document.createElement('div');
    
    tempDiv.innerHTML = `
      <div id="${detailsId}" class="app-ads-details" style="display:none;">
        <h4>app-ads.txt for ${DOMUtils.escapeHtml(result.domain)}</h4>
        <div class="app-ads-url"><strong>URL:</strong> <a href="${DOMUtils.escapeHtml(result.appAdsTxt.url)}" target="_blank" rel="noopener noreferrer">${DOMUtils.escapeHtml(result.appAdsTxt.url)}</a></div>
        <div class="app-ads-stats">
          <strong>Stats:</strong> 
          ${result.appAdsTxt.analyzed.totalLines} lines, 
          ${result.appAdsTxt.analyzed.validLines} valid entries
        </div>
        <div class="app-ads-content">
          <pre>${DOMUtils.escapeHtml(contentText)}</pre>
        </div>
      </div>
    `;
    
    // Add search matches section if there are matches
    const hasSearchMatches = result.appAdsTxt.searchResults && 
                            result.appAdsTxt.searchResults.count > 0;
    
    if (hasSearchMatches) {
      // Create tabs for search results if multiple terms are available
      const hasMultipleTerms = result.appAdsTxt.searchResults.termResults && 
                              result.appAdsTxt.searchResults.termResults.length > 1;
      
      let tabsHtml = '<div class="search-matches-tabs" role="tablist">';
      let tabContentsHtml = '';
      
      // "All Matches" tab (always present)
      const allTabId = `all-${detailsId}`;
      tabsHtml += `<button class="search-tab active" data-action="tab-switch" data-tab="${allTabId}" role="tab" aria-selected="true" aria-controls="${allTabId}" id="tab-${allTabId}">All Matches</button>`;
      
      // Generate the all matches tab content
      const allMatchingLinesHtml = result.appAdsTxt.searchResults.matchingLines
        .slice(0, 100) // Limit to 100 matches for performance
        .map(line => `
          <tr>
            <td>${line.lineNumber}</td>
            <td class="search-match-content">${this._highlightSearchTerms(
              line.content, 
              result.appAdsTxt.searchResults.terms || searchTerms
            )}</td>
          </tr>
        `).join('');
      
      // Search terms legend
      const searchTermsForLegend = result.appAdsTxt.searchResults.terms || searchTerms;
      const legendHtml = this._generateSearchTermLegend(searchTermsForLegend);
      
      tabContentsHtml += `
        <div id="${allTabId}" class="search-tab-content active" role="tabpanel" aria-labelledby="tab-${allTabId}">
          <div class="search-matches-count">
            <strong>Total matches:</strong> ${result.appAdsTxt.searchResults.count}
            ${legendHtml}
          </div>
          <div class="search-matches-list">
            <table class="search-matches-table">
              <thead>
                <tr>
                  <th scope="col">Line #</th>
                  <th scope="col">Content</th>
                </tr>
              </thead>
              <tbody>
                ${allMatchingLinesHtml}
                ${result.appAdsTxt.searchResults.matchingLines.length > 100 ? 
                  `<tr><td colspan="2">(${result.appAdsTxt.searchResults.matchingLines.length - 100} more matches not shown for performance)</td></tr>` : ''}
              </tbody>
            </table>
          </div>
        </div>
      `;
      
      // Add per-term tabs if available
      if (hasMultipleTerms) {
        result.appAdsTxt.searchResults.termResults.forEach((termResult, termIndex) => {
          if (termResult.count > 0) {
            const termTabId = `term-${termIndex}-${detailsId}`;
            const colorClass = `term-match-${termIndex % 5}`;
            
            tabsHtml += `<button class="search-tab ${colorClass}" data-action="tab-switch" data-tab="${termTabId}" role="tab" aria-selected="false" aria-controls="${termTabId}" id="tab-${termTabId}">${DOMUtils.escapeHtml(termResult.term)}</button>`;
            
            // Generate the term-specific tab content
            const termMatchingLinesHtml = termResult.matchingLines
              .slice(0, 100) // Limit to 100 matches for performance
              .map(line => `
                <tr>
                  <td>${line.lineNumber}</td>
                  <td class="search-match-content">${this._highlightSearchTerms(
                    line.content, 
                    [termResult.term]
                  )}</td>
                </tr>
              `).join('');
            
            tabContentsHtml += `
              <div id="${termTabId}" class="search-tab-content" role="tabpanel" aria-labelledby="tab-${termTabId}" aria-hidden="true">
                <div class="search-matches-count">
                  <strong>Matches for "${DOMUtils.escapeHtml(termResult.term)}":</strong> ${termResult.count}
                </div>
                <div class="search-matches-list">
                  <table class="search-matches-table">
                    <thead>
                      <tr>
                        <th scope="col">Line #</th>
                        <th scope="col">Content</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${termMatchingLinesHtml}
                      ${termResult.matchingLines.length > 100 ? 
                        `<tr><td colspan="2">(${termResult.matchingLines.length - 100} more matches not shown for performance)</td></tr>` : ''}
                    </tbody>
                  </table>
                </div>
              </div>
            `;
          }
        });
      }
      
      tabsHtml += '</div>'; // Close tabs container
      
      tempDiv.innerHTML += `
        <div id="search-${detailsId}" class="search-matches-details" style="display:none;">
          <h4>Search Matches in ${DOMUtils.escapeHtml(result.domain)}</h4>
          ${tabsHtml}
          ${tabContentsHtml}
        </div>
      `;
    }
    
    // Add to details container using document fragment for better performance
    const fragment = document.createDocumentFragment();
    while (tempDiv.firstChild) {
      fragment.appendChild(tempDiv.firstChild);
    }
    
    detailsContainer.appendChild(fragment);
  }
  
  /**
   * Highlight search terms in text
   * @param {string} text - Text to highlight
   * @param {string[]} terms - Search terms
   * @returns {string} - Highlighted HTML
   * @private
   */
  _highlightSearchTerms(text, terms) {
    if (!text || !terms || !terms.length) {
      return DOMUtils.escapeHtml(text);
    }
    
    let escapedText = DOMUtils.escapeHtml(text);
    
    // Create positions array to avoid overlapping highlights
    const positions = [];
    
    terms.forEach((term, termIndex) => {
      if (!term) return;
      
      const termLower = term.toLowerCase();
      let textLower = text.toLowerCase();
      let lastIndex = 0;
      let startIndex;
      
      while ((startIndex = textLower.indexOf(termLower, lastIndex)) !== -1) {
        positions.push({
          start: startIndex,
          end: startIndex + term.length,
          termIndex: termIndex % 5 // Limit to 5 different colors
        });
        
        lastIndex = startIndex + termLower.length;
      }
    });
    
    // Sort positions by start index (descending) to avoid index shifts during replacement
    positions.sort((a, b) => b.start - a.start);
    
    // Apply highlights
    positions.forEach(pos => {
      const before = escapedText.substring(0, pos.start);
      const match = escapedText.substring(pos.start, pos.end);
      const after = escapedText.substring(pos.end);
      
      escapedText = `${before}<span class="search-highlight term-match-${pos.termIndex}">${match}</span>${after}`;
    });
    
    return escapedText;
  }
  
  /**
   * Generate search term legend for display
   * @param {string[]} terms - Search terms
   * @returns {string} - HTML for search term legend
   * @private
   */
  _generateSearchTermLegend(terms) {
    if (!terms || !terms.length) return '';
    
    let html = '<div class="search-terms-legend"><strong>Search terms:</strong> ';
    
    terms.forEach((term, index) => {
      const colorClass = `term-match-${index % 5}`;
      html += `<span class="search-highlight ${colorClass}">${DOMUtils.escapeHtml(term)}</span> `;
    });
    
    html += '</div>';
    return html;
  }
}

export default StreamResultsRenderer;