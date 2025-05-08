/**
 * App State Management Module
 * Centralized state management for the application
 */

import { showNotification } from '../utils/notification.js';
import DOMUtils from './dom-utils.js';

/**
 * App State Management Class
 */
class AppStateManager {
  constructor() {
    // Core state
    this.isProcessing = false;
    this.darkMode = false;
    
    // Results and pagination
    this.results = [];
    this.pagination = null;
    this.searchTerms = []; // Legacy - will be removed
    this.searchParams = null; // New unified search parameters
    this.pageSize = 20;
    
    // Event listeners
    this.listeners = {
      stateChange: [],
      processingChange: [],
      resultsChange: [],
      themeChange: []
    };
  }
  
  /**
   * Initialize state from localStorage if available
   */
  initialize() {
    // Load dark mode preference from theme manager
    this.darkMode = document.documentElement.getAttribute('data-theme') === 'dark';
    
    // Load page size preference
    const savedPageSize = parseInt(localStorage.getItem('pageSize'), 10);
    if (!isNaN(savedPageSize) && savedPageSize > 0) {
      this.pageSize = savedPageSize;
    }
  }
  
  /**
   * Set processing state
   * @param {boolean} isProcessing - Whether the app is processing
   */
  setProcessing(isProcessing) {
    if (this.isProcessing === isProcessing) return;
    
    this.isProcessing = isProcessing;
    this.updateProcessingUI(isProcessing);
    this.notifyListeners('processingChange', { isProcessing });
  }
  
  /**
   * Update UI elements based on processing state
   * @param {boolean} isProcessing - Processing state
   */
  updateProcessingUI(isProcessing) {
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
  
  /**
   * Set results and notify listeners
   * @param {Array} results - Results array
   * @param {Object} pagination - Pagination info
   */
  setResults(results, pagination = null) {
    this.results = results || [];
    this.pagination = pagination;
    
    this.notifyListeners('resultsChange', { 
      results: this.results,
      pagination: this.pagination
    });
  }
  
  /**
   * Set search terms (legacy - kept for compatibility)
   * @param {Array} terms - Search terms array
   * @deprecated Use setSearchParams instead
   */
  setSearchTerms(terms) {
    this.searchTerms = Array.isArray(terms) ? terms : [];
    
    // Convert to structured params for backward compatibility
    if (terms && terms.length > 0) {
      this.setSearchParams({
        structuredParams: terms.map(term => ({
          domain: term.includes('.') ? term : undefined,
          publisherId: !term.includes('.') ? term : undefined
        }))
      });
    }
  }
  
  /**
   * Set unified search parameters
   * @param {Object} params - Search parameters object
   */
  setSearchParams(params) {
    this.searchParams = params;
    
    // Store structured params
    if (params && params.structuredParams) {
      this.setAdvancedSearchParams(params.structuredParams);
    }
    
    // For backwards compatibility - map structured params to searchTerms
    if (params && params.structuredParams) {
      const structuredParams = params.structuredParams;
      
      // Handle both array and single object cases
      if (Array.isArray(structuredParams)) {
        // For array, use the first item's domain or publisherId if available
        if (structuredParams.length > 0) {
          const firstParam = structuredParams[0];
          if (firstParam.domain) {
            this.searchTerms = [firstParam.domain];
          } else if (firstParam.publisherId) {
            this.searchTerms = [firstParam.publisherId];
          } else {
            this.searchTerms = [];
          }
        } else {
          this.searchTerms = [];
        }
      } else {
        // Handle single object (legacy case)
        if (structuredParams.domain) {
          this.searchTerms = [structuredParams.domain];
        } else if (structuredParams.publisherId) {
          this.searchTerms = [structuredParams.publisherId];
        } else {
          this.searchTerms = [];
        }
      }
    } else if (params && params.queries && Array.isArray(params.queries)) {
      // For the case when we receive just queries array
      this.searchTerms = params.queries;
    } else {
      this.searchTerms = [];
    }
  }
  
  /**
   * Set advanced search parameters
   * @param {Object|Array} structuredParams - Advanced search parameters
   */
  setAdvancedSearchParams(structuredParams) {
    // Ensure structured parameters are always an array for consistency
    if (structuredParams) {
      if (!Array.isArray(structuredParams)) {
        // Convert single object to array with one item
        this.advancedSearchParams = [structuredParams];
      } else {
        this.advancedSearchParams = structuredParams;
      }
    } else {
      this.advancedSearchParams = null;
    }
    // Notify listeners if needed
    this.notifyListeners('stateChange', { 
      advancedSearchParams: this.advancedSearchParams
    });
  }
  
  /**
   * Set page size
   * @param {number} size - Page size
   */
  setPageSize(size) {
    const newSize = parseInt(size, 10);
    if (!isNaN(newSize) && newSize > 0) {
      this.pageSize = newSize;
      localStorage.setItem('pageSize', newSize);
      this.notifyListeners('stateChange', { pageSize: this.pageSize });
    }
  }
  
  /**
   * Reset app state
   */
  reset() {
    this.results = [];
    this.pagination = null;
    this.isProcessing = false;
    this.updateProcessingUI(false);
    
    this.notifyListeners('stateChange', { 
      results: this.results,
      pagination: this.pagination,
      isProcessing: this.isProcessing
    });
  }
  
  /**
   * Add state change listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   * @returns {Function} Function to remove the listener
   */
  addListener(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    
    this.listeners[event].push(callback);
    
    // Return function to remove listener
    return () => {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    };
  }
  
  /**
   * Notify all listeners of a state change
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  notifyListeners(event, data) {
    if (!this.listeners[event]) return;
    
    for (const callback of this.listeners[event]) {
      try {
        callback(data);
      } catch (err) {
        // Silently ignore errors in listeners to avoid console pollution
      }
    }
  }
}

// Export singleton instance
const AppState = new AppStateManager();

// Make AppState available globally
if (typeof window !== 'undefined') {
  window.AppState = AppState;
}

export default AppState;