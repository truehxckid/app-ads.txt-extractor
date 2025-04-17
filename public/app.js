/**
 * App Developer Domain Extractor - Enhanced Client
 * Features:
 * - Modular architecture with component-based approach
 * - Enhanced error handling and feedback
 * - Improved accessibility and keyboard navigation
 * - Optimized performance for large datasets
 * - Enhanced search capabilities
 */

(function() {
  'use strict';
  
  // App state management
  const AppState = {
    isProcessing: false,
    debugMode: false,
    darkMode: false,
    results: [],
    searchTerms: [],
    
    toggleDebugMode() {
      this.debugMode = !this.debugMode;
      document.getElementById('debugInfo').style.display = this.debugMode ? 'block' : 'none';
      return this.debugMode;
    },
    
    setProcessing(isProcessing) {
      this.isProcessing = isProcessing;
      updateUIProcessingState(isProcessing);
    },
    
    resetState() {
      this.results = [];
      this.isProcessing = false;
    }
  };
  
  // DOM Element cache for performance
  const DOMElements = {};
  
  // Utility functions
  const Utilities = {
    /**
     * Safely get DOM element with caching for performance
     * @param {string} id - Element ID
     * @returns {HTMLElement} DOM element
     */
    getElement(id) {
      if (!DOMElements[id]) {
        DOMElements[id] = document.getElementById(id);
        if (!DOMElements[id]) {
          console.error(`Element not found: ${id}`);
        }
      }
      return DOMElements[id];
    },
    
    /**
     * Create DOM element with attributes and content
     * @param {string} tag - HTML tag name
     * @param {Object} attrs - Element attributes
     * @param {string|HTMLElement|HTMLElement[]} content - Element content
     * @returns {HTMLElement} Created element
     */
    createElement(tag, attrs = {}, content = null) {
      const element = document.createElement(tag);
      
      // Set attributes
      Object.entries(attrs).forEach(([key, value]) => {
        if (key === 'className') {
          element.className = value;
        } else if (key === 'dataset') {
          Object.entries(value).forEach(([dataKey, dataValue]) => {
            element.dataset[dataKey] = dataValue;
          });
        } else {
          element.setAttribute(key, value);
        }
      });
      
      // Set content
      if (content !== null) {
        if (typeof content === 'string') {
          element.textContent = content;
        } else if (Array.isArray(content)) {
          content.forEach(child => {
            if (child instanceof HTMLElement) {
              element.appendChild(child);
            } else if (typeof child === 'string') {
              element.appendChild(document.createTextNode(child));
            }
          });
        } else if (content instanceof HTMLElement) {
          element.appendChild(content);
        }
      }
      
      return element;
    },
    
    /**
     * Safely escape HTML to prevent XSS
     * @param {string} str - String to escape
     * @returns {string} Escaped string
     */
    escapeHtml(str) {
      if (!str || typeof str !== 'string') return '';
      
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    },
    
    /**
     * Highlight search terms in text
     * @param {string} text - Text to highlight
     * @param {string[]} terms - Search terms to highlight
     * @returns {string} Highlighted HTML
     */
    highlightMultipleSearchTerms(text, terms) {
      if (!text || !terms || !terms.length) return this.escapeHtml(text);
      
      let escapedText = this.escapeHtml(text);
      
      // Create a map of positions to avoid overlapping highlights
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
    },
    
    /**
     * Generate HTML for search term legend
     * @param {string[]} terms - Search terms
     * @returns {string} Legend HTML
     */
    generateSearchTermLegend(terms) {
      if (!terms || !terms.length) return '';
      
      let html = '<div class="search-terms-legend"><strong>Search terms:</strong> ';
      
      terms.forEach((term, index) => {
        const colorClass = `term-match-${index % 5}`;
        html += `<span class="search-highlight ${colorClass}">${this.escapeHtml(term)}</span> `;
      });
      
      html += '</div>';
      return html;
    },
    
    /**
     * Copy text to clipboard
     * @param {string} text - Text to copy
     * @returns {Promise<boolean>} Success status
     */
    async copyToClipboard(text) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return true;
        } else {
          // Fallback for older browsers
          const textArea = document.createElement('textarea');
          textArea.value = text;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          textArea.style.top = '-999999px';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          const success = document.execCommand('copy');
          textArea.remove();
          return success;
        }
      } catch (err) {
        console.error('Failed to copy text:', err);
        return false;
      }
    },
    
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
      
      const notification = this.createElement('div', {
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
     * Format large numbers with commas
     * @param {number} num - Number to format
     * @returns {string} Formatted number
     */
    formatNumber(num) {
      return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },
    
    /**
     * Get store display name
     * @param {string} storeType - Store type identifier
     * @returns {string} Display name
     */
    getStoreDisplayName(storeType) {
      const storeNames = {
        'googleplay': 'Google Play',
        'appstore': 'App Store',
        'amazon': 'Amazon',
        'roku': 'Roku',
        'samsung': 'Samsung',
        'unknown': 'Unknown'
      };
      
      return storeNames[storeType] || 'Unknown';
    },
    
    /**
     * Detect store type from bundle ID format
     * @param {string} bundleId - Bundle ID
     * @returns {string} Store type
     */
    detectStoreType(bundleId) {
      if (!bundleId || typeof bundleId !== 'string') return 'unknown';
      
      const trimmedId = bundleId.trim();
      
      if (/^[a-f0-9]{32}:[a-f0-9]{32}$/i.test(trimmedId)) return 'roku';
      if (/^B[0-9A-Z]{9,10}$/i.test(trimmedId)) return 'amazon';
      if (/^(id)?\d+$/.test(trimmedId)) return /^\d{4,6}$/.test(trimmedId) ? 'roku' : 'appstore';
      if (/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(trimmedId)) return 'googleplay';
      if (/^[a-zA-Z0-9]{4,}$/.test(trimmedId) && !trimmedId.includes('.')) return 'roku';
      if (/^G\d{10,15}$/i.test(trimmedId)) return 'samsung';
      
      return 'unknown';
    },
    
    /**
     * Parse CSV data with header detection
     * @param {string} csvData - CSV data
     * @returns {Object} Parsed CSV data
     */
    parseCSV(csvData) {
      const lines = csvData.split(/\r\n|\n|\r/).filter(line => line.trim());
      
      if (lines.length === 0) {
        throw new Error('CSV file is empty');
      }
      
      // Detect delimiter by checking first line
      const firstLine = lines[0];
      let delimiter = ',';
      
      if (firstLine.includes('\t')) {
        delimiter = '\t';
      } else if (firstLine.includes(';')) {
        delimiter = ';';
      }
      
      // Parse header
      const header = firstLine.split(delimiter).map(col => col.trim());
      
      // Detect if first row is header (check if all fields are text-like)
      const hasHeader = !header.some(field => /^\d+$/.test(field));
      
      const startRow = hasHeader ? 1 : 0;
      const results = [];
      
      // If no header, generate column names
      const columnNames = hasHeader ? 
        header : Array.from({ length: header.length }, (_, i) => `Column${i + 1}`);
      
      // Parse data rows
      for (let i = startRow; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Split by delimiter and handle quoted fields
        const fields = this.splitCSVLine(line, delimiter);
        
        if (fields.length > 0) {
          const row = {};
          fields.forEach((field, index) => {
            if (index < columnNames.length) {
              row[columnNames[index]] = field.trim();
            }
          });
          results.push(row);
        }
      }
      
      return {
        data: results,
        header: columnNames,
        hasHeader,
        rowCount: results.length,
        delimiter
      };
    },
    
    /**
     * Split CSV line handling quotes properly
     * @param {string} line - CSV line
     * @param {string} delimiter - Delimiter
     * @returns {string[]} Fields
     */
    splitCSVLine(line, delimiter = ',') {
      const fields = [];
      let currentField = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
          // Check if it's an escaped quote
          if (i + 1 < line.length && line[i + 1] === '"') {
            currentField += '"';
            i++; // Skip the next quote
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === delimiter && !inQuotes) {
          fields.push(currentField);
          currentField = '';
        } else {
          currentField += char;
        }
      }
      
      // Add the last field
      fields.push(currentField);
      
      return fields;
    }
  };
  
  // Template module for generating HTML
  const TemplateEngine = {
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
        html += `<span class="search-results-count">With matches for "${Utilities.escapeHtml(searchTermsText)}": <strong>${withSearchMatches}</strong></span>`;
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
          const wrapper = Utilities.createElement('div', { className: 'results-wrapper' });
          wrapper.appendChild(emptyState);
          return wrapper;
        }
      }
      const fragment = document.createDocumentFragment();
      const tableContainer = Utilities.createElement('div', { className: 'results-table-container' });
      const table = Utilities.createElement('table', { className: 'results-table' });
      
      // Create table header
      const thead = Utilities.createElement('thead');
      const headerRow = Utilities.createElement('tr');
      
      // Add header cells
      ['Bundle ID', 'Store', 'Domain', 'App-ads.txt'].forEach(title => {
        headerRow.appendChild(Utilities.createElement('th', { scope: 'col' }, title));
      });
      
      // Add search matches header if needed
      if (searchTermText) {
        headerRow.appendChild(Utilities.createElement('th', { scope: 'col' }, 'Search Matches'));
      }
      
      // Add actions header
      headerRow.appendChild(Utilities.createElement('th', { scope: 'col' }, 'Actions'));
      
      thead.appendChild(headerRow);
      table.appendChild(thead);
      
      // Create table body
      const tbody = Utilities.createElement('tbody');
      
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
            const hasSearchMatches = hasAppAds && result.appAdsTxt.searchResults && result.appAdsTxt.searchResults.count > 0;
            const searchMatchCount = hasSearchMatches ? result.appAdsTxt.searchResults.count : 0;
            
            const row = Utilities.createElement('tr', {
              className: `success-row ${hasAppAds ? 'has-app-ads' : ''} ${hasSearchMatches ? 'has-search-matches' : ''}`
            });
            
            // Bundle ID cell
            row.appendChild(Utilities.createElement('td', {}, result.bundleId));
            
            // Store cell
            row.appendChild(Utilities.createElement('td', {}, Utilities.getStoreDisplayName(result.storeType)));
            
            // Domain cell
            row.appendChild(Utilities.createElement('td', { className: 'domain-cell' }, result.domain || 'N/A'));
            
            // App-ads.txt cell
            const appAdsCell = Utilities.createElement('td', { className: 'app-ads-cell' });
            
            if (hasAppAds) {
              const foundSpan = Utilities.createElement('span', { className: 'app-ads-found' }, 'Found');
              appAdsCell.appendChild(foundSpan);
              appAdsCell.appendChild(document.createTextNode(' '));
              
              const toggleBtn = Utilities.createElement('button', {
                className: 'toggle-app-ads',
                dataset: { action: 'toggle-ads', target: detailsId },
                type: 'button',
                'aria-expanded': 'false',
                'aria-controls': detailsId
              }, 'Show app-ads.txt');
              
              appAdsCell.appendChild(toggleBtn);
            } else {
              const missingSpan = Utilities.createElement('span', { className: 'app-ads-missing' }, 'Not found');
              appAdsCell.appendChild(missingSpan);
            }
            
            row.appendChild(appAdsCell);
            
            // Search matches cell (if search terms provided)
            if (searchTermText) {
              const matchesCell = Utilities.createElement('td', { className: 'search-matches-cell' });
              
              if (hasSearchMatches) {
                const matchesSpan = Utilities.createElement('span', { className: 'search-matches-found' });
                
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
                  const showMatchesBtn = Utilities.createElement('button', {
                    className: 'toggle-search-matches',
                    dataset: { action: 'toggle-matches', target: targetId },
                    type: 'button',
                    'aria-expanded': 'false',
                    'aria-controls': targetId
                  }, 'Show matches');
                  
                  matchesCell.appendChild(showMatchesBtn);
                }
              } else {
                const noMatchesSpan = Utilities.createElement('span', { className: 'search-matches-missing' }, 'No matches');
                matchesCell.appendChild(noMatchesSpan);
              }
              
              row.appendChild(matchesCell);
            }
            
            // Actions cell
            const actionsCell = Utilities.createElement('td');
            const copyBtn = Utilities.createElement('button', {
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
                  <h4>app-ads.txt for ${Utilities.escapeHtml(result.domain)}</h4>
                  <div class="app-ads-url"><strong>URL:</strong> <a href="${Utilities.escapeHtml(result.appAdsTxt.url)}" target="_blank" rel="noopener noreferrer">${Utilities.escapeHtml(result.appAdsTxt.url)}</a></div>
                  <div class="app-ads-stats">
                    <strong>Stats:</strong> 
                    ${result.appAdsTxt.analyzed.totalLines} lines, 
                    ${result.appAdsTxt.analyzed.validLines} valid entries
                </div>
                  <div class="app-ads-content">
                    <pre>${Utilities.escapeHtml(contentText)}</pre>
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
                      <td class="search-match-content">${Utilities.highlightMultipleSearchTerms(
                        line.content, 
                        (result.appAdsTxt.searchResults.terms || AppState.searchTerms)
                      )}</td>
                    </tr>
                  `).join('');
                
                // Search terms legend
                const searchTermsForLegend = result.appAdsTxt.searchResults.terms || AppState.searchTerms;
                const legendHtml = Utilities.generateSearchTermLegend(searchTermsForLegend);
                
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
                      
                      tabsHtml += `<button class="search-tab ${colorClass}" data-action="tab-switch" data-tab="${termTabId}" role="tab" aria-selected="false" aria-controls="${termTabId}" id="tab-${termTabId}">${Utilities.escapeHtml(termResult.term)}</button>`;
                      
                      // Generate the term-specific tab content
                      const termMatchingLinesHtml = termResult.matchingLines
                        .slice(0, 100) // Limit to 100 matches for performance
                        .map(line => `
                          <tr>
                            <td>${line.lineNumber}</td>
                            <td class="search-match-content">${Utilities.highlightMultipleSearchTerms(
                              line.content, 
                              [termResult.term]
                            )}</td>
                          </tr>
                        `).join('');
                      
                      tabContentsHtml += `
                        <div id="${termTabId}" class="search-tab-content" role="tabpanel" aria-labelledby="tab-${termTabId}" aria-hidden="true">
                          <div class="search-matches-count">
                            <strong>Matches for "${Utilities.escapeHtml(termResult.term)}":</strong> ${termResult.count}
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
                    <h4>Search Matches in ${Utilities.escapeHtml(result.domain)}</h4>
                    ${tabsHtml}
                    ${tabContentsHtml}
                  </div>
                `;
              }
            }
          } else {
            // Error row
            const row = Utilities.createElement('tr', { className: 'error-row' });
            
            // Bundle ID cell
            row.appendChild(Utilities.createElement('td', {}, result.bundleId));
            
            // Error message (spans multiple columns)
            const errorCell = Utilities.createElement('td', {
              className: 'error-message',
              colSpan: searchTermText ? 4 : 3
            }, `Error: ${result.error || 'Unknown error'}`);
            
            row.appendChild(errorCell);
            
            // Empty actions cell
            row.appendChild(Utilities.createElement('td', {}));
            
            tbody.appendChild(row);
          }
        }
      }
      
      table.appendChild(tbody);
      tableContainer.appendChild(table);
      fragment.appendChild(tableContainer);
      
      // Add details sections
      const detailsContainer = Utilities.createElement('div', { className: 'details-container' });
      detailsContainer.innerHTML = detailsHtml;
      fragment.appendChild(detailsContainer);
      
      // Create wrapper div for everything
      const wrapper = Utilities.createElement('div', { className: 'results-wrapper' });
      wrapper.appendChild(fragment);
      
      return wrapper;
    }
  };
  
  // API module for server communication
  const API = {
    /**
     * Extract developer domains from bundle IDs
     * @param {string[]} bundleIds - Array of bundle IDs
     * @param {string[]} searchTerms - Array of search terms
     * @returns {Promise<Object>} API response
     */
    async extractDomains(bundleIds, searchTerms = []) {
      try {
        const response = await fetch('/api/extract-multiple', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ bundleIds, searchTerms })
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Server error: ${response.status} ${response.statusText}`);
        }
        
        return await response.json();
      } catch (err) {
        console.error('API request failed:', err);
        throw err;
      }
    }
  };
  
  // Event handling module
  const EventHandler = {
    /**
     * Initialize all event listeners
     */
    init() {
      // Theme toggle
      document.getElementById('themeToggle').addEventListener('click', this.handleThemeToggle);
      
      // Extract button
      document.getElementById('extractBtn').addEventListener('click', this.handleExtractButtonClick);
      
      // File upload
      document.getElementById('csvFile').addEventListener('change', this.handleFileUpload);
      
      // Global click handler for dynamic elements
      document.addEventListener('click', this.handleDocumentClick);
      
      // Global keyboard shortcuts
      document.addEventListener('keydown', this.handleKeydown);
      
      // Initialize search terms container - Don't handle the "Add Search Term" button here
      // This is now handled by fix-errors.js
    },
    
    /**
     * Handle theme toggle button click
     * @param {Event} event - Click event
     */
    handleThemeToggle(event) {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const newTheme = isDark ? 'light' : 'dark';
      
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
      
      // Update button state for accessibility
      const button = event.target.closest('button');
      if (button) {
        button.setAttribute('aria-pressed', !isDark);
        button.setAttribute('aria-label', `Toggle ${isDark ? 'dark' : 'light'} mode`);
      }
    },
    
    /**
     * Handle extract button click
     * @param {Event} event - Click event
     */
    handleExtractButtonClick(event) {
      // Prevent double submission
      if (AppState.isProcessing) return;
      
      const bundleIdsTextarea = document.getElementById('bundleIds');
      const bundleIdsText = bundleIdsTextarea?.value || '';
      const bundleIds = bundleIdsText
        .split('\n')
        .map(id => id.trim())
        .filter(Boolean);
      
      // Get search terms
      const searchTerms = Array.from(document.querySelectorAll('.search-term-input'))
        .map(input => input.value.trim())
        .filter(Boolean);
      
      AppState.searchTerms = searchTerms;
      
      if (bundleIds.length === 0) {
        Utilities.showNotification('Please enter at least one bundle ID', 'error');
        bundleIdsTextarea?.focus();
        return;
      }
      
      // Show progress indicator and disable extract button
      AppState.setProcessing(true);
      
      // Process the bundleIds
      processBundleIds(bundleIds, searchTerms);
    },
    
    /**
     * Handle file upload
     * @param {Event} event - Change event
     */
    handleFileUpload(event) {
      const fileInput = event.target;
      const file = fileInput.files?.[0];
      
      if (!file) return;
      
      // Display file name
      const fileNameDisplay = document.getElementById('fileNameDisplay');
      if (fileNameDisplay) {
        fileNameDisplay.textContent = file.name;
      }
      
      // Show progress
      const progressDiv = document.getElementById('fileUploadProgress');
      const progressBar = progressDiv?.querySelector('.progress-bar');
      const progressText = progressDiv?.querySelector('.progress-text');
      
      if (progressDiv) {
        progressDiv.style.display = 'block';
        if (progressBar) progressBar.style.width = '0%';
        if (progressText) progressText.textContent = 'Reading file...';
      }
      
      // Read file
      const reader = new FileReader();
      
      reader.onload = function(e) {
        try {
          const content = e.target.result;
          
          // Update progress
          if (progressBar) progressBar.style.width = '50%';
          if (progressText) progressText.textContent = 'Parsing data...';
          
          // Parse CSV
          const parsedContent = Utilities.parseCSV(content);
          
          // Find the bundle ID column
          let bundleIdColumn = null;
          
          // Look for columns that might contain bundle IDs
          const possibleColumns = ['bundle', 'bundle_id', 'bundleid', 'bundle id', 'id', 'app id', 'app_id', 'appid'];
          
          for (const colName of parsedContent.header) {
            const lowerColName = colName.toLowerCase();
            if (possibleColumns.some(name => lowerColName.includes(name))) {
              bundleIdColumn = colName;
              break;
            }
          }
          
          // If no obvious column found, use first column
          if (!bundleIdColumn && parsedContent.header.length > 0) {
            bundleIdColumn = parsedContent.header[0];
          }
          
          // Extract bundle IDs
          const bundleIds = [];
          
          if (bundleIdColumn) {
            parsedContent.data.forEach(row => {
              const bundleId = row[bundleIdColumn]?.trim();
              if (bundleId) {
                bundleIds.push(bundleId);
              }
            });
          }
          
          // Update progress
          if (progressBar) progressBar.style.width = '100%';
          if (progressText) progressText.textContent = `Found ${bundleIds.length} bundle IDs`;
          
          // Fill textarea with bundle IDs
          const bundleIdsTextarea = document.getElementById('bundleIds');
          if (bundleIdsTextarea) {
            bundleIdsTextarea.value = bundleIds.join('\n');
          }
          
          // Hide progress after a delay
          setTimeout(() => {
            if (progressDiv) progressDiv.style.display = 'none';
          }, 2000);
          
          // Show notification
          Utilities.showNotification(`Successfully imported ${bundleIds.length} bundle IDs`, 'success');
          
        } catch (err) {
          console.error('Error parsing CSV:', err);
          Utilities.showNotification(`Error parsing CSV: ${err.message}`, 'error');
          
          // Hide progress
          if (progressDiv) progressDiv.style.display = 'none';
        }
      };
      
      reader.onerror = function() {
        console.error('Error reading file');
        Utilities.showNotification('Error reading file', 'error');
        
        // Hide progress
        if (progressDiv) progressDiv.style.display = 'none';
      };
      
      reader.readAsText(file);
    },
    
    /**
     * Handle document click events (delegation)
     * @param {Event} event - Click event
     */
    handleDocumentClick(event) {
      const target = event.target;
      const action = target.dataset.action || target.closest('[data-action]')?.dataset.action;
      
      if (!action) return;
      
      switch (action) {
        case 'copy':
          EventHandler.handleCopyButtonClick(target);
          break;
        case 'toggle-ads':
          EventHandler.handleToggleAdsClick(target);
          break;
        case 'toggle-matches':
          EventHandler.handleToggleMatchesClick(target);
          break;
        case 'tab-switch':
          EventHandler.handleTabSwitch(target);
          break;
        case 'download-csv':
          EventHandler.handleDownloadCSV();
          break;
        // Removed handlers for add-term and remove-term as they're now in fix-errors.js
      }
    },
    
    /**
     * Handle keyboard shortcuts
     * @param {KeyboardEvent} event - Keydown event
     */
    handleKeydown(event) {
      // Ctrl+D for debug mode
      if (event.ctrlKey && event.key === 'd') {
        event.preventDefault();
        const isDebug = AppState.toggleDebugMode();
        Utilities.showNotification(`Debug mode ${isDebug ? 'enabled' : 'disabled'}`, 'info');
      }
    },
    
    /**
     * Handle copy button click
     * @param {HTMLElement} button - Copy button
     */
    async handleCopyButtonClick(button) {
      const textToCopy = button.dataset.copy || button.closest('[data-copy]')?.dataset.copy;
      
      if (!textToCopy) return;
      
      try {
        const success = await Utilities.copyToClipboard(textToCopy);
        
        if (success) {
          // Change button text temporarily
          const originalText = button.textContent;
          button.textContent = 'Copied!';
          
          setTimeout(() => {
            button.textContent = originalText;
          }, 1500);
          
          Utilities.showNotification(`Copied ${textToCopy} to clipboard`, 'success', 1500);
        } else {
          throw new Error('Copy failed');
        }
      } catch (err) {
        console.error('Error copying to clipboard:', err);
        Utilities.showNotification('Failed to copy to clipboard', 'error');
      }
    },
    
    /**
     * Handle toggle app-ads.txt button click
     * @param {HTMLElement} button - Toggle button
     */
    handleToggleAdsClick(button) {
      const targetId = button.dataset.target;
      if (!targetId) return;
      
      const targetElement = document.getElementById(targetId);
      if (!targetElement) return;
      
      const isVisible = targetElement.style.display !== 'none';
      
      // Toggle visibility
      targetElement.style.display = isVisible ? 'none' : 'block';
      
      // Update button text
      button.textContent = isVisible ? 'Show app-ads.txt' : 'Hide app-ads.txt';
      
      // Update aria attributes
      button.setAttribute('aria-expanded', !isVisible);
      
      // Scroll into view if showing
      if (!isVisible) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    },
    
    /**
     * Handle toggle search matches button click
     * @param {HTMLElement} button - Toggle button
     */
    handleToggleMatchesClick(button) {
      const targetId = button.dataset.target;
      console.log('Toggle matches clicked, target ID:', targetId);
      
      if (!targetId) {
        console.error('No target ID found on button');
        return;
      }
      
      const targetElement = document.getElementById(targetId);
      console.log('Target element found:', !!targetElement);
      
      if (!targetElement) {
        console.error('Target element not found for ID:', targetId);
        return;
      }
      
      const isVisible = targetElement.style.display !== 'none';
      console.log('Is currently visible:', isVisible);
      
      // Toggle visibility
      targetElement.style.display = isVisible ? 'none' : 'block';
      console.log('New display value:', targetElement.style.display);
      
      // Update button text
      button.textContent = isVisible ? 'Show matches' : 'Hide matches';
      
      // Update aria attributes
      button.setAttribute('aria-expanded', !isVisible);
      
      // Scroll into view if showing
      if (!isVisible) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        // Focus the first tab if available
        const firstTab = targetElement.querySelector('.search-tab');
        if (firstTab) {
          firstTab.focus();
        }
      }
    },
    
    /**
     * Handle search results tab switching
     * @param {HTMLElement} tab - Tab element
     */
    handleTabSwitch(tab) {
      const tabId = tab.dataset.tab;
      if (!tabId) return;
      
      const tabContentElement = document.getElementById(tabId);
      if (!tabContentElement) return;
      
      // Get all tabs and content in this tab group
      const tabsContainer = tab.closest('.search-matches-tabs');
      if (!tabsContainer) return;
      
      // Get all tabs
      const allTabs = tabsContainer.querySelectorAll('.search-tab');
      
      // Get all content elements by searching for siblings of tabContentElement with the same class
      const allContents = tabContentElement.parentElement.querySelectorAll('.search-tab-content');
      
      // Deactivate all tabs and content
      allTabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      
      allContents.forEach(c => {
        c.classList.remove('active');
        c.setAttribute('aria-hidden', 'true');
      });
      
      // Activate the clicked tab and its content
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      
      tabContentElement.classList.add('active');
      tabContentElement.setAttribute('aria-hidden', 'false');
    },
    
    /**
     * Handle download CSV button click
     */
    handleDownloadCSV() {
      downloadResultsAsCsv(AppState.results);
    }
  };
  
  // ==========================================
  // Main Processing Functions
  // ==========================================
  
  /**
   * Process bundle IDs
   * @param {string[]} bundleIds - Array of bundle IDs
   * @param {string[]} searchTerms - Array of search terms
   */
  async function processBundleIds(bundleIds, searchTerms = []) {
    try {
      const resultElement = document.getElementById('result');
      const debugElement = document.getElementById('debugInfo');
      
      // Clear previous results
      if (resultElement) {
        resultElement.innerHTML = '<div class="loading">Processing...</div>';
        resultElement.style.display = 'block';
      }
      
      // Show debug info if in debug mode
      if (debugElement && AppState.debugMode) {
        debugElement.innerHTML = '<div class="debug-info"><h3>Debug Information</h3><p>Sending request to server...</p></div>';
        debugElement.style.display = 'block';
      }
      
      // Call API
      const response = await API.extractDomains(bundleIds, searchTerms);
      
      // Save results in app state
      AppState.results = response.results || [];
      
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
          </div>
        `;
        
        debugElement.innerHTML = debugHtml;
      }
      
      // Calculate statistics
      const successResults = AppState.results.filter(r => r.success);
      const withAppAds = successResults.filter(r => r.appAdsTxt?.exists).length;
      
      // Calculate search matches if search terms provided
      let withSearchMatches = 0;
      let searchTermsText = '';
      
      if (searchTerms && searchTerms.length > 0) {
        withSearchMatches = successResults.filter(r => 
          r.appAdsTxt?.exists && r.appAdsTxt.searchResults?.count > 0
        ).length;
        
        searchTermsText = searchTerms.join(', ');
      }
      
      // Generate summary HTML
      const summaryData = {
        totalProcessed: response.totalProcessed || bundleIds.length,
        success: successResults.length,
        error: AppState.results.length - successResults.length,
        withAppAds,
        withSearchMatches,
        searchTermsText
      };
      
      // Generate HTML
      const summaryHtml = TemplateEngine.generateResultsSummary(summaryData);
      
      // Create table
      const tableWrapper = TemplateEngine.generateResultsTable(AppState.results, searchTermsText);
      
      // Update results
      if (resultElement) {
        resultElement.innerHTML = summaryHtml;
        resultElement.appendChild(tableWrapper);
      }
      
      // Final completion notification
      const message = `Completed extracting ${successResults.length} domains (${response.errorCount} errors)`;
      Utilities.showNotification(message, 'success');
      
    } catch (err) {
      console.error('Error processing bundle IDs:', err);
      
      // Show error message
      const errorMessage = err.message || 'An unknown error occurred';
      Utilities.showNotification(`Error: ${errorMessage}`, 'error');
      
      // Update result area with error
      const resultElement = document.getElementById('result');
      if (resultElement) {
        resultElement.innerHTML = `
          <div class="error">
            <strong>Error:</strong> ${Utilities.escapeHtml(errorMessage)}
          </div>
        `;
      }
      
      // Update debug info if in debug mode
      const debugElement = document.getElementById('debugInfo');
      if (debugElement && AppState.debugMode) {
        debugElement.innerHTML = `
          <div class="debug-info">
            <h3>Debug Information</h3>
            <p><strong>Error:</strong> ${Utilities.escapeHtml(errorMessage)}</p>
            <p><strong>Stack:</strong> ${Utilities.escapeHtml(err.stack || 'No stack trace available')}</p>
          </div>
        `;
      }
    } finally {
      // Reset processing state
      AppState.setProcessing(false);
    }
  }
  
  /**
   * Update UI state based on processing status
   * @param {boolean} isProcessing - Whether processing is in progress
   */
  function updateUIProcessingState(isProcessing) {
    const extractBtn = document.getElementById('extractBtn');
    const loadingIndicator = document.getElementById('loadingIndicator');
    
    if (extractBtn) {
      extractBtn.disabled = isProcessing;
      extractBtn.textContent = isProcessing ? 'Processing...' : 'Extract All Developer Domains';
    }
    
    if (loadingIndicator) {
      loadingIndicator.style.display = isProcessing ? 'flex' : 'none';
    }
  }
  
  // ==========================================
  // Data Export
  // ==========================================
  
  /**
   * Download results as CSV
   * @param {Array} results - Results data
   */
  function downloadResultsAsCsv(results) {
    if (!results || !results.length) {
      Utilities.showNotification('No results to download', 'error');
      return;
    }
    
    try {
      // Check if search was performed
      const hasSearchResults = results.some(r => r.success && r.appAdsTxt?.searchResults);
      const searchTerms = hasSearchResults && results.find(r => r.appAdsTxt?.searchResults)?.appAdsTxt.searchResults?.terms;
      const searchTerm = searchTerms ? searchTerms.join(', ') : null;
      
      // Create CSV header
      let csvHeader = "Bundle ID,Store,Domain,Has App-Ads.txt,App-Ads.txt URL";
      
      // Add search columns if needed
      if (searchTerm) {
        csvHeader += `,Search Term,Search Matches,Matching Lines`;
      }
      
      // Complete the header
      csvHeader += ",Success,Error\n";
      
      // Create blob with stream-like approach for better memory usage
      const csvParts = [csvHeader];
      
      // Process in chunks to avoid memory issues with large datasets
      const CHUNK_SIZE = 100;
      for (let i = 0; i < results.length; i += CHUNK_SIZE) {
        let chunkCsv = '';
        const chunk = results.slice(i, Math.min(i + CHUNK_SIZE, results.length));
        
        for (const result of chunk) {
          const hasAppAds = result.success && result.appAdsTxt?.exists;
          
          // Basic columns
          const basicCols = [
            `"${(result.bundleId || '').replace(/"/g, '""')}"`,
            `"${(result.storeType ? Utilities.getStoreDisplayName(result.storeType) : '').replace(/"/g, '""')}"`,
            `"${(result.domain || '').replace(/"/g, '""')}"`,
            hasAppAds ? "Yes" : "No",
            `"${(hasAppAds ? result.appAdsTxt.url : '').replace(/"/g, '""')}"`
          ].join(',');
          
          // Search columns
          let searchCols = '';
          if (searchTerm) {
            const hasMatches = hasAppAds && result.appAdsTxt.searchResults?.count > 0;
            const matchCount = hasMatches ? result.appAdsTxt.searchResults.count : 0;
            
            // Limit matching lines to first 10 for CSV file size
            const matchingLines = hasMatches ? 
              result.appAdsTxt.searchResults.matchingLines
                .slice(0, 10)
                .map(line => `Line ${line.lineNumber}: ${line.content.replace(/"/g, '""')}`)
                .join(' | ') : '';
            
            const matchingLinesSummary = hasMatches && result.appAdsTxt.searchResults.matchingLines.length > 10 ?
              `${matchingLines} (+ ${result.appAdsTxt.searchResults.matchingLines.length - 10} more)` :
              matchingLines;
              
            searchCols = `,${`"${searchTerm.replace(/"/g, '""')}"`},${matchCount},${`"${matchingLinesSummary}"`}`;
          }
          
          // Status columns
          const statusCols = `,${result.success ? "Yes" : "No"},${`"${(result.error || '').replace(/"/g, '""')}"`}`;
          
          // Build the complete row
          chunkCsv += basicCols + searchCols + statusCols + "\n";
        }
        
        csvParts.push(chunkCsv);
      }
      
      // Create download link
      const blob = new Blob(csvParts, { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      
      // Set download attributes
      link.setAttribute('href', url);
      link.setAttribute('download', `developer_domains_${new Date().toISOString().slice(0, 10)}.csv`);
      
      // Trigger download and clean up
      document.body.appendChild(link);
      link.click();
      
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        Utilities.showNotification('CSV download started', 'success');
      }, 100);
    } catch (err) {
      console.error('Error downloading CSV:', err);
      Utilities.showNotification('Error creating CSV file', 'error');
    }
  }
  
  // ==========================================
  // Initialization
  // ==========================================
  
  /**
   * Initialize the application
   */
  function initializeApp() {
    try {
      // Initialize event handlers
      EventHandler.init();
      
      // Initialize theme
      const savedTheme = localStorage.getItem('theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const theme = savedTheme || (prefersDark ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', theme);
      
      // Set theme toggle button state
      const themeToggle = document.getElementById('themeToggle');
      if (themeToggle) {
        themeToggle.setAttribute('aria-pressed', theme === 'dark');
      }
      
      // Setup keyboard shortcuts for debug mode
      console.info('Press Ctrl+D to toggle debug mode');
      
      // Add global error handler
      window.addEventListener('error', handleGlobalError);
      window.addEventListener('unhandledrejection', handleUnhandledRejection);
      
    } catch (err) {
      console.error('Error initializing app:', err);
      showErrorBoundary('Failed to initialize application');
    }
  }
  
  /**
   * Global error handler
   * @param {ErrorEvent} event - Error event
   */
  function handleGlobalError(event) {
    console.error('Global error:', event.error || event.message);
    
    // Show error boundary for critical errors
    if (isCriticalError(event.error || event.message)) {
      showErrorBoundary(`${event.message || 'Application error'}`);
      return;
    }
    
    // For non-critical errors, show notification
    Utilities.showNotification('An error occurred. Check console for details.', 'error');
  }
  
  /**
   * Handle unhandled promise rejections
   * @param {PromiseRejectionEvent} event - Rejection event
   */
  function handleUnhandledRejection(event) {
    console.error('Unhandled promise rejection:', event.reason);
    
    // Prevent showing too many errors for network issues
    if (event.reason instanceof TypeError || 
        (event.reason.message && event.reason.message.includes('network'))) {
      Utilities.showNotification('Network error. Please check your connection.', 'error');
      return;
    }
    
    Utilities.showNotification('An error occurred. Check console for details.', 'error');
  }
  
  /**
   * Check if an error is critical
   * @param {Error|string} error - Error object or message
   * @returns {boolean} Whether error is critical
   */
  function isCriticalError(error) {
    if (!error) return false;
    
    // Check for initialization errors that would break the app
    if (error.message && (
      error.message.includes('undefined is not a function') ||
      error.message.includes('null is not an object') ||
      error.message.includes('cannot read property') ||
      error.message.includes('is not defined')
    )) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Show error boundary for critical errors
   * @param {string} message - Error message
   */
  function showErrorBoundary(message) {
    const errorBoundary = document.getElementById('errorBoundary');
    if (!errorBoundary) return;
    
    // Add error details
    const errorMessage = errorBoundary.querySelector('p');
    if (errorMessage) {
      errorMessage.textContent = message || 'Something went wrong. Please refresh the page.';
    }
    
    // Show error boundary
    errorBoundary.style.display = 'block';
    
    // Hide main content
    const mainContent = document.querySelector('main');
    if (mainContent) {
      mainContent.style.display = 'none';
    }
  }
  
  // Initialize on DOM content loaded
  document.addEventListener('DOMContentLoaded', initializeApp);
})();