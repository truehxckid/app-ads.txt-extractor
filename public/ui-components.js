// ui-components.js - User interface components and templates
window.UIComponents = (function() {
  'use strict';
  
  // Utility functions
  const DOMUtils = window.DOMUtils;
  
  return {
    /**
     * Show notification to user
     * @param {string} message - Notification message
     * @param {string} type - Notification type (success, error, info)
     * @param {number} duration - Duration in ms
     */
    showNotification(message, type = 'info', duration = 3000) {
      // Remove any existing notifications
      const existingNotification = document.querySelector('.notification');
      if (existingNotification) {
        existingNotification.remove();
      }
      
      const notification = DOMUtils.createElement('div', {
        className: `notification notification-${type}`,
        role: 'alert',
        'aria-live': 'assertive'
      }, message);
      
      document.body.appendChild(notification);
      
      // Show notification with animation
      setTimeout(() => notification.classList.add('show'), 10);
      
      // Remove notification after duration
      setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
      }, duration);
    },
    
    /**
     * Show error boundary for critical errors
     * @param {string} message - Error message
     */
    showErrorBoundary(message) {
      const errorBoundary = document.getElementById('errorBoundary');
      if (!errorBoundary) return;
      
      // Add error details
      const errorMessage = errorBoundary.querySelector('p');
      if (errorMessage) {
        errorMessage.textContent = message || 'Something went wrong. Please refresh the page.';
      }
      
      // Show error boundary
      errorBoundary.style.display = 'block';
      
      // Show modal backdrop
      const modalBackdrop = document.getElementById('modalBackdrop');
      if (modalBackdrop) {
        modalBackdrop.style.display = 'block';
      }
      
      // Hide main content
      const mainContent = document.querySelector('main');
      if (mainContent) {
        mainContent.style.display = 'none';
      }
      
      // Focus the error boundary
      errorBoundary.setAttribute('tabindex', '-1');
      errorBoundary.focus();
    },
    
    /**
     * Hide error boundary
     */
    hideErrorBoundary() {
      const errorBoundary = document.getElementById('errorBoundary');
      if (!errorBoundary) return;
      
      errorBoundary.style.display = 'none';
      
      // Hide modal backdrop
      const modalBackdrop = document.getElementById('modalBackdrop');
      if (modalBackdrop) {
        modalBackdrop.style.display = 'none';
      }
      
      // Show main content
      const mainContent = document.querySelector('main');
      if (mainContent) {
        mainContent.style.display = 'block';
      }
    },
    
    /**
     * Generate results summary
     * @param {Object} data - Summary data
     * @returns {string} HTML
     */
    generateResultsSummary(data) {
      const {
        totalProcessed,
        success,
        error,
        withAppAds,
        withSearchMatches,
        searchTermsText
      } = data;
      
      let html = `
        <div class="results-summary">
          <div class="summary-stats">
            <span>Total: <strong>${totalProcessed}</strong></span>
            <span class="success-count">Success: <strong>${success}</strong></span>
            <span class="error-count">Errors: <strong>${error}</strong></span>
            <span class="app-ads-count">With app-ads.txt: <strong>${withAppAds}</strong></span>
      `;
      
      if (searchTermsText) {
        html += `<span class="search-results-count">With matches for "${DOMUtils.escapeHtml(searchTermsText)}": <strong>${withSearchMatches}</strong></span>`;
      }
      
      html += `
          </div>
          <button class="download-btn" data-action="download-csv">Download CSV</button>
        </div>
      `;
      
      return html;
    },
    
    /**
     * Generate results table
     * @param {Array} results - Results data
     * @param {string} searchTermText - Search term text
     * @returns {HTMLElement} Table wrapper element
     */
    generateResultsTable(results, searchTermText) {
      // Check if results are empty
      if (!results || results.length === 0) {
        const emptyStateTemplate = document.getElementById('empty-state-template');
        if (emptyStateTemplate) {
          const emptyState = document.importNode(emptyStateTemplate.content, true);
          const wrapper = DOMUtils.createElement('div', { className: 'results-wrapper' });
          wrapper.appendChild(emptyState);
          return wrapper;
        }
      }
      
      const fragment = document.createDocumentFragment();
      const tableContainer = DOMUtils.createElement('div', { className: 'results-table-container' });
      const table = DOMUtils.createElement('table', { className: 'results-table' });
      
      // Create table header
      const thead = DOMUtils.createElement('thead');
      const headerRow = DOMUtils.createElement('tr');
      
      // Add header cells
      ['Bundle ID', 'Store', 'Domain', 'App-ads.txt'].forEach(title => {
        headerRow.appendChild(DOMUtils.createElement('th', { scope: 'col' }, title));
      });
      
      // Add search matches header if needed
      if (searchTermText) {
        headerRow.appendChild(DOMUtils.createElement('th', { scope: 'col' }, 'Search Matches'));
      }
      
      // Add actions header
      headerRow.appendChild(DOMUtils.createElement('th', { scope: 'col' }, 'Actions'));
      
      thead.appendChild(headerRow);
      table.appendChild(thead);
      
      // Create table body
      const tbody = DOMUtils.createElement('tbody');
      
      // For details sections
      let detailsHtml = '';
      let detailsCounter = 0;
      
      // Process results in chunks using a more efficient approach
      const CHUNK_SIZE = 50;
      const totalChunks = Math.ceil(results.length / CHUNK_SIZE);
      
      for (let chunk = 0; chunk < totalChunks; chunk++) {
        const startIdx = chunk * CHUNK_SIZE;
        const endIdx = Math.min((chunk + 1) * CHUNK_SIZE, results.length);
        
        for (let i = startIdx; i < endIdx; i++) {
          const result = results[i];
          
          if (result.success) {
            const hasAppAds = result.appAdsTxt?.exists;
            const detailsId = hasAppAds ? `app-ads-details-${detailsCounter++}` : '';
            
            // Check if there are search matches
            const hasSearchMatches = hasAppAds && result.appAdsTxt.searchResults && 
                                  result.appAdsTxt.searchResults.count > 0;
            const searchMatchCount = hasSearchMatches ? result.appAdsTxt.searchResults.count : 0;
            
            const row = DOMUtils.createElement('tr', {
              className: `success-row ${hasAppAds ? 'has-app-ads' : ''} ${hasSearchMatches ? 'has-search-matches' : ''}`
            });
            
            // Bundle ID cell
            row.appendChild(DOMUtils.createElement('td', {}, result.bundleId));
            
            // Store cell
            row.appendChild(DOMUtils.createElement('td', {}, DOMUtils.getStoreDisplayName(result.storeType)));
            
            // Domain cell
            row.appendChild(DOMUtils.createElement('td', { className: 'domain-cell' }, result.domain || 'N/A'));
            
            // App-ads.txt cell
            const appAdsCell = DOMUtils.createElement('td', { className: 'app-ads-cell' });
            
            if (hasAppAds) {
              const foundSpan = DOMUtils.createElement('span', { className: 'app-ads-found' }, 'Found');
              appAdsCell.appendChild(foundSpan);
              appAdsCell.appendChild(document.createTextNode(' '));
              
              const toggleBtn = DOMUtils.createElement('button', {
                className: 'toggle-app-ads',
                dataset: { action: 'toggle-ads', target: detailsId },
                type: 'button',
                'aria-expanded': 'false',
                'aria-controls': detailsId
              }, 'Show app-ads.txt');
              
              appAdsCell.appendChild(toggleBtn);
            } else {
              const missingSpan = DOMUtils.createElement('span', { className: 'app-ads-missing' }, 'Not found');
              appAdsCell.appendChild(missingSpan);
            }
            
            row.appendChild(appAdsCell);
            
            // Search matches cell (if search terms provided)
            if (searchTermText) {
              const matchesCell = DOMUtils.createElement('td', { className: 'search-matches-cell' });
              
              if (hasSearchMatches) {
                const matchesSpan = DOMUtils.createElement('span', { className: 'search-matches-found' });
                
                // For multi-term search, show color-coded indicators
                if (result.appAdsTxt.searchResults.termResults) {
                  // Generate colored indicators for each term
                  let matchHtml = '';
                  result.appAdsTxt.searchResults.termResults.forEach((termResult, termIndex) => {
                    if (termResult.count > 0) {
                      const colorClass = `term-match-${termIndex % 5}`;
                      matchHtml += `<span class="term-match-indicator ${colorClass}">${termResult.count}</span> `;
                    }
                  });
                  matchesSpan.innerHTML = matchHtml;
                } else {
                  // Fallback for single-term search
                  matchesSpan.textContent = `${searchMatchCount} matches`;
                }
                
                matchesCell.appendChild(matchesSpan);
                
                if (searchMatchCount > 0) {
                  matchesCell.appendChild(document.createTextNode(' '));
                  
                  const targetId = `search-${detailsId}`;
                  const showMatchesBtn = DOMUtils.createElement('button', {
                    className: 'toggle-search-matches',
                    dataset: { action: 'toggle-matches', target: targetId },
                    type: 'button',
                    'aria-expanded': 'false',
                    'aria-controls': targetId
                  }, 'Show matches');
                  
                  matchesCell.appendChild(showMatchesBtn);
                }
              } else {
                const noMatchesSpan = DOMUtils.createElement('span', 
                  { className: 'search-matches-missing' }, 'No matches');
                matchesCell.appendChild(noMatchesSpan);
              }
              
              row.appendChild(matchesCell);
            }
            
            // Actions cell
            const actionsCell = DOMUtils.createElement('td');
            const copyBtn = DOMUtils.createElement('button', {
              className: 'table-copy-btn',
              dataset: { action: 'copy', copy: result.domain || '' },
              type: 'button',
              title: 'Copy domain to clipboard'
            }, 'Copy');
            
            actionsCell.appendChild(copyBtn);
            row.appendChild(actionsCell);
            
            tbody.appendChild(row);
            
            // Add app-ads.txt details section (hidden by default)
            if (hasAppAds) {
              // Limit content length for better performance
              const contentText = result.appAdsTxt.content.length > 10000 
                ? result.appAdsTxt.content.substring(0, 10000) + '...\n(truncated for performance)' 
                : result.appAdsTxt.content;
              
              detailsHtml += `
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
                      <td class="search-match-content">${DOMUtils.highlightMultipleSearchTerms(
                        line.content, 
                        (result.appAdsTxt.searchResults.terms || window.AppState?.searchTerms)
                      )}</td>
                    </tr>
                  `).join('');
                
                // Search terms legend
                const searchTermsForLegend = result.appAdsTxt.searchResults.terms || 
                                         window.AppState?.searchTerms;
                const legendHtml = DOMUtils.generateSearchTermLegend(searchTermsForLegend);
                
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
                            <td class="search-match-content">${DOMUtils.highlightMultipleSearchTerms(
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
                
                detailsHtml += `
                  <div id="search-${detailsId}" class="search-matches-details" style="display:none;">
                    <h4>Search Matches in ${DOMUtils.escapeHtml(result.domain)}</h4>
                    ${tabsHtml}
                    ${tabContentsHtml}
                  </div>
                `;
              }
            }
          } else {
            // Error row
            const row = DOMUtils.createElement('tr', { className: 'error-row' });
            
            // Bundle ID cell
            row.appendChild(DOMUtils.createElement('td', {}, result.bundleId));
            
            // Error message (spans multiple columns)
            const errorCell = DOMUtils.createElement('td', {
              className: 'error-message',
              colSpan: searchTermText ? 4 : 3
            }, `Error: ${result.error || 'Unknown error'}`);
            
            row.appendChild(errorCell);
            
            // Empty actions cell
            row.appendChild(DOMUtils.createElement('td', {}));
            
            tbody.appendChild(row);
          }
        }
      }
      
      table.appendChild(tbody);
      tableContainer.appendChild(table);
      fragment.appendChild(tableContainer);
      
      // Add details sections
      const detailsContainer = DOMUtils.createElement('div', { className: 'details-container' });
      detailsContainer.innerHTML = detailsHtml;
      fragment.appendChild(detailsContainer);
      
      // Create wrapper div for everything
      const wrapper = DOMUtils.createElement('div', { className: 'results-wrapper' });
      wrapper.appendChild(fragment);
      
      return wrapper;
    }
  };
})();