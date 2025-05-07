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
        
        // Check if we need to disable the button (if 5 terms are already present)
        if (searchContainer && searchContainer.children.length >= 5) {
          addTermButton.disabled = true;
          addTermButton.classList.add('disabled');
          addTermButton.setAttribute('title', 'Maximum of 5 search terms allowed');
        }
      }
    }
  }
  
  /**
   * Add a new search term input
   * Maximum of 5 search terms allowed
   */
  addSearchTerm() {
    try {
      const container = DOMUtils.getElement('searchTermsContainer');
      if (!container) {
        console.error('Search terms container not found');
        return;
      }
      
      // Limit to maximum 5 search terms
      if (container.children.length >= 5) {
        // Import notification utils dynamically
        import('../utils/notification.js').then(module => {
          if (module && module.showNotification) {
            module.showNotification('Maximum of 5 search terms allowed', 'info');
          } else {
            console.info('Maximum of 5 search terms allowed');
          }
        }).catch(() => {
          console.info('Maximum of 5 search terms allowed');
        });
        
        // Disable the Add Term button
        const addTermButton = document.querySelector('[data-action="add-term"]');
        if (addTermButton) {
          addTermButton.disabled = true;
          addTermButton.classList.add('disabled');
          addTermButton.setAttribute('title', 'Maximum of 5 search terms allowed');
        }
        
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
      } else {
        // Enable the Add Term button if we're below the limit
        const addTermButton = document.querySelector('[data-action="add-term"]');
        if (addTermButton && container && container.children.length < 5) {
          addTermButton.disabled = false;
          addTermButton.classList.remove('disabled');
          addTermButton.setAttribute('title', 'Add another search term');
        }
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
   * @param {string[]} terms - Array of search terms (limited to 5)
   */
  setSearchTerms(terms) {
    if (!Array.isArray(terms) || terms.length === 0) {
      return;
    }
    
    const container = DOMUtils.getElement('searchTermsContainer');
    if (!container) return;
    
    // Clear existing terms
    container.innerHTML = '';
    
    // Add new terms (up to 5)
    const limitedTerms = terms.slice(0, 5);
    limitedTerms.forEach(term => {
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
    
    // Show notification if terms were limited
    if (terms.length > 5) {
      // Import notification utils dynamically
      import('../utils/notification.js').then(module => {
        if (module && module.showNotification) {
          module.showNotification('Limited to 5 search terms', 'info');
        } else {
          console.info('Limited to 5 search terms');
        }
      }).catch(() => {
        console.info('Limited to 5 search terms');
      });
    }
    
    // Update the Add Term button state
    const addTermButton = document.querySelector('[data-action="add-term"]');
    if (addTermButton) {
      const isDisabled = container.children.length >= 5;
      addTermButton.disabled = isDisabled;
      if (isDisabled) {
        addTermButton.classList.add('disabled');
        addTermButton.setAttribute('title', 'Maximum of 5 search terms allowed');
      } else {
        addTermButton.classList.remove('disabled');
        addTermButton.setAttribute('title', 'Add another search term');
      }
    }
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