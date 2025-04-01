// dom-utils.js - Utility functions for DOM manipulation and data processing
window.DOMUtils = (function() {
  'use strict';
  
  // DOM Element cache for performance
  const elementCache = {};
  
  return {
    /**
     * Safely get DOM element with caching for performance
     * @param {string} id - Element ID
     * @returns {HTMLElement} DOM element
     */
    getElement(id) {
      if (!elementCache[id]) {
        elementCache[id] = document.getElementById(id);
        if (!elementCache[id]) {
          console.error(`Element not found: ${id}`);
        }
      }
      return elementCache[id];
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
})();