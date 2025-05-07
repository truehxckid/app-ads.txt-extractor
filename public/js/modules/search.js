/**
 * Search Manager Module
 * Handles search functionality
 */

import DOMUtils from './dom-utils.js';

/**
 * Search Manager Class
 */
class SearchManager {
  constructor() {
    // Prevent duplicate event handlers flag
    this.handlersAdded = false;
  }
  
  /**
   * Initialize search functionality
   */
  initialize() {
    // Initialize search terms container if needed
    const searchContainer = DOMUtils.getElement('searchTermsContainer');
    if (searchContainer && searchContainer.children.length === 0) {
      this.addSearchTerm();
    }
    
    // Add add-term button event handler if not already added
    if (!this.handlersAdded) {
      const addTermButton = document.querySelector('[data-action="add-term"]');
      if (addTermButton) {
        addTermButton.addEventListener('click', (event) => {
          event.preventDefault();
          this.addSearchTerm();
        });
        this.handlersAdded = true;
      }
    }
  }
  
  /**
   * Add a new search term input
   */
  addSearchTerm() {
    try {
      const container = DOMUtils.getElement('searchTermsContainer');
      if (!container) {
        console.error('Search terms container not found');
        return;
      }
      
      // Use template if available
      const template = document.getElementById('search-term-template');
      if (template) {
        const clone = document.importNode(template.content, true);
        container.appendChild(clone);
        return;
      }
      
      // Fallback: create elements manually
      const row = DOMUtils.createElement('div', { className: 'search-term-row' });
      
      const input = DOMUtils.createElement('input', {
        type: 'text',
        className: 'search-term-input',
        placeholder: 'Enter keyword or domain to search for',
        'aria-label': 'Search term'
      });
      
      const button = DOMUtils.createElement('button', {
        type: 'button',
        className: 'remove-search-term',
        dataset: { action: 'remove-term' },
        'aria-label': 'Remove search term'
      }, '−');
      
      row.appendChild(input);
      row.appendChild(button);
      container.appendChild(row);
      
      // Focus the new input
      input.focus();
    } catch (err) {
      console.error('Error adding search term:', err);
    }
  }
  
  /**
   * Remove a search term input
   * @param {HTMLElement} button - Remove button
   */
  removeSearchTerm(button) {
    const row = button.closest('.search-term-row');
    if (row) {
      row.remove();
      
      // Ensure at least one search term exists
      const container = DOMUtils.getElement('searchTermsContainer');
      if (container && container.children.length === 0) {
        this.addSearchTerm();
      }
    }
  }
  
  /**
   * Get current search terms
   * @returns {string[]} - Array of search terms
   */
  getSearchTerms() {
    return Array.from(document.querySelectorAll('.search-term-input'))
      .map(input => input.value.trim())
      .filter(Boolean);
  }
  
  /**
   * Compatibility method for UnifiedSearch
   * @deprecated - Use UnifiedSearch.getSearchParams() instead
   */
  getCurrentSearchTerms() {
    return this.getSearchTerms();
  }
  
  /**
   * Set search terms in inputs
   * @param {string[]} terms - Array of search terms
   */
  setSearchTerms(terms) {
    if (!Array.isArray(terms) || terms.length === 0) {
      return;
    }
    
    const container = DOMUtils.getElement('searchTermsContainer');
    if (!container) return;
    
    // Clear existing terms
    container.innerHTML = '';
    
    // Add new terms
    terms.forEach(term => {
      const row = DOMUtils.createElement('div', { className: 'search-term-row' });
      
      const input = DOMUtils.createElement('input', {
        type: 'text',
        className: 'search-term-input',
        placeholder: 'Enter keyword or domain to search for',
        'aria-label': 'Search term',
        value: term
      });
      
      const button = DOMUtils.createElement('button', {
        type: 'button',
        className: 'remove-search-term',
        dataset: { action: 'remove-term' },
        'aria-label': 'Remove search term'
      }, '−');
      
      row.appendChild(input);
      row.appendChild(button);
      container.appendChild(row);
    });
  }
  
  /**
   * Highlight search matches in text
   * @param {string} text - Text to search in
   * @param {string[]} terms - Search terms
   * @returns {Object} - Object with highlighted text and match statistics
   */
  findMatches(text, terms) {
    if (!text || !terms || !terms.length) {
      return { 
        text: text,
        hasMatches: false,
        matchCount: 0
      };
    }
    
    let matchCount = 0;
    const matchPositions = [];
    
    // Find all matches
    terms.forEach((term, termIndex) => {
      if (!term) return;
      
      const termLower = term.toLowerCase();
      const textLower = text.toLowerCase();
      let pos = -1;
      
      while ((pos = textLower.indexOf(termLower, pos + 1)) !== -1) {
        matchCount++;
        matchPositions.push({
          start: pos,
          end: pos + term.length,
          term,
          termIndex
        });
      }
    });
    
    // Sort positions to process in order
    matchPositions.sort((a, b) => a.start - b.start);
    
    return {
      text,
      hasMatches: matchCount > 0,
      matchCount,
      matchPositions
    };
  }
}

// Export singleton instance
const searchManager = new SearchManager();
export default searchManager;