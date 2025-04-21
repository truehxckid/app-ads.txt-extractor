/**
 * Template Engine Module
 * Generates HTML templates for the application
 */

import DOMUtils from './dom-utils.js';
import { formatNumber, getStoreDisplayName } from '../utils/formatting.js';

/**
 * Template Engine Class
 */
class TemplateEngineManager {
  /**
   * Generate results summary
   * @param {Object} data - Summary data
   * @returns {string} - HTML for results summary
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
          <span>Total: <strong>${formatNumber(totalProcessed)}</strong></span>
          <span class="success-count">Success: <strong>${formatNumber(success)}</strong></span>
          <span class="error-count">Errors: <strong>${formatNumber(error)}</strong></span>
          <span class="app-ads-count">With app-ads.txt: <strong>${formatNumber(withAppAds)}</strong></span>
    `;
    
    if (searchTermsText) {
      html += `<span class="search-results-count">With matches for "${DOMUtils.escapeHtml(searchTermsText)}": <strong>${formatNumber(withSearchMatches)}</strong></span>`;
    }
    
    html += `
        </div>
        <div class="action-buttons">
          <button class="download-btn" data-action="download-all-csv">Download All Results</button>
          <button class="download-btn" data-action="download-csv">Download Current Page</button>
        </div>
      </div>
    `;
    
    return html;
  }
  
  /**
   * Generate results table
   * @param {Array} results - Results data
   * @param {string} searchTermText - Search term text
   * @returns {string} - HTML for results table and detail sections
   */
  generateResultsTable(results, searchTermText) {
    // Check if results are empty
    if (!results || results.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-state-icon">📊</div>
          <h3 class="empty-state-title">No results to display</h3>
          <p class="empty-state-description">Enter bundle IDs and click "Extract All Developer Domains" to get started.</p>
        </div>
      `;
    }
    
    // Start building table
    let tableHtml = `
      <div class="results-table-container">
        <table class="results-table">
          <thead>
            <tr>
              <th scope="col">Bundle ID</th>
              <th scope="col">Store</th>
              <th scope="col">Domain</th>
              <th scope="col">App-ads.txt</th>
    `;
    
    // Add search matches header if needed
    if (searchTermText) {
      tableHtml += `<th scope="col">Search Matches</th>`;
    }
    
    // Add actions header
    tableHtml += `<th scope="col">Actions</th></tr></thead><tbody>`;
    
    // For details sections
    let detailsHtml = '';
    let detailsCounter = 0;
    
    // Process results
    for (const result of results) {
      if (result.success) {
        const hasAppAds = result.appAdsTxt?.exists;
        const detailsId = hasAppAds ? `app-ads-details-${detailsCounter++}` : '';
        
        // Check if there are search matches
        const hasSearchMatches = hasAppAds && result.appAdsTxt.searchResults && result.appAdsTxt.searchResults.count > 0;
        const searchMatchCount = hasSearchMatches ? result.appAdsTxt.searchResults.count : 0;
        
        tableHtml += `
          <tr class="success-row ${hasAppAds ? 'has-app-ads' : ''} ${hasSearchMatches ? 'has-search-matches' : ''}">
            <td>${DOMUtils.escapeHtml(result.bundleId)}</td>
            <td>${DOMUtils.escapeHtml(getStoreDisplayName(result.storeType))}</td>
            <td class="domain-cell">${DOMUtils.escapeHtml(result.domain || 'N/A')}</td>
            <td class="app-ads-cell">
        `;
        
        if (hasAppAds) {
          tableHtml += `
            <span class="app-ads-found">Found</span>
            <button class="toggle-app-ads" data-action="toggle-ads" data-target="${detailsId}" 
              type="button" aria-expanded="false" aria-controls="${detailsId}">
              Show app-ads.txt
            </button>
          `;
        } else {
          tableHtml += `<span class="app-ads-missing">Not found</span>`;
        }
        
        tableHtml += `</td>`;
        
        // Search matches cell (if search terms provided)
        if (searchTermText) {
          tableHtml += `<td class="search-matches-cell">`;
          
          if (hasSearchMatches) {
            tableHtml += `<span class="search-matches-found">`;
            
            // For multi-term search, show color-coded indicators
            if (result.appAdsTxt.searchResults.termResults) {
              // Generate colored indicators for each term
              result.appAdsTxt.searchResults.termResults.forEach((termResult, termIndex) => {
                if (termResult.count > 0) {
                  const colorClass = `term-match-${termIndex % 5}`;
                  tableHtml += `<span class="term-match-indicator ${colorClass}">${termResult.count}</span> `;
                }
              });
            } else {
              // Fallback for single-term search
              tableHtml += `${searchMatchCount} matches`;
            }
            
            tableHtml += `</span>`;
            
            if (searchMatchCount > 0) {
              const targetId = `search-${detailsId}`;
              tableHtml += `
                <button class="toggle-search-matches" data-action="toggle-matches" data-target="${targetId}" 
                  type="button" aria-expanded="false" aria-controls="${targetId}">
                  Show matches
                </button>
              `;
            }
          } else {
            tableHtml += `<span class="search-matches-missing">No matches</span>`;
          }
          
          tableHtml += `</td>`;
        }
        
        // Actions cell
        tableHtml += `
          <td>
            <button class="table-copy-btn" data-action="copy" data-copy="${result.domain || ''}" 
              type="button" title="Copy domain to clipboard">Copy</button>
          </td>
        </tr>
        `;
        
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
                  <td class="search-match-content">${this.highlightSearchTerms(
                    line.content, 
                    (result.appAdsTxt.searchResults.terms || [searchTermText])
                  )}</td>
                </tr>
              `).join('');
            
            // Search terms legend
            const searchTermsForLegend = result.appAdsTxt.searchResults.terms || [searchTermText];
            const legendHtml = this.generateSearchTermLegend(searchTermsForLegend);
            
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
                        <td class="search-match-content">${this.highlightSearchTerms(
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
        tableHtml += `
          <tr class="error-row">
            <td>${DOMUtils.escapeHtml(result.bundleId)}</td>
            <td class="error-message" colspan="${searchTermText ? 4 : 3}">
              Error: ${DOMUtils.escapeHtml(result.error || 'Unknown error')}
            </td>
            <td></td>
          </tr>
        `;
      }
    }
    
    // Close table
    tableHtml += `
        </tbody>
      </table>
    </div>
    `;
    
    // Add details container
    if (detailsHtml) {
      tableHtml += `<div class="details-container">${detailsHtml}</div>`;
    }
    
    return tableHtml;
  }
  
  /**
   * Highlight search terms in text
   * @param {string} text - Text to highlight
   * @param {string[]} terms - Search terms
   * @returns {string} - Highlighted HTML
   */
  highlightSearchTerms(text, terms) {
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
   * Generate search term legend
   * @param {string[]} terms - Search terms
   * @returns {string} - HTML for search term legend
   */
  generateSearchTermLegend(terms) {
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

// Export singleton instance
const templateEngine = new TemplateEngineManager();
export default templateEngine;