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
    this.debugMode = false;
    this.darkMode = false;
    
    // Results and pagination
    this.results = [];
    this.pagination = null;
    this.searchTerms = [];
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
    // Load debug mode preference
    this.debugMode = localStorage.getItem('debugMode') === 'true';
    this.updateDebugMode(this.debugMode);
    
    // Load dark mode preference from theme manager
    this.darkMode = document.documentElement.getAttribute('data-theme') === 'dark';
    
    // Load page size preference
    const savedPageSize = parseInt(localStorage.getItem('pageSize'), 10);
    if (!isNaN(savedPageSize) && savedPageSize > 0) {
      this.pageSize = savedPageSize;
    }
    
    console.log('AppState initialized with:', {
      debugMode: this.debugMode,
      darkMode: this.darkMode,
      pageSize: this.pageSize
    });
  }
  
  /**
   * Toggle debug mode
   * @returns {boolean} New debug mode state
   */
  toggleDebugMode() {
    const newState = !this.debugMode;
    this.updateDebugMode(newState);
    localStorage.setItem('debugMode', newState);
    return newState;
  }
  
  /**
   * Update debug mode and related UI
   * @param {boolean} isDebug - Debug mode state
   */
  updateDebugMode(isDebug) {
    this.debugMode = isDebug;
    const debugInfo = document.getElementById('debugInfo');
    
    if (debugInfo) {
      debugInfo.style.display = this.debugMode ? 'block' : 'none';
    }
    
    this.notifyListeners('stateChange', { debugMode: this.debugMode });
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
   * Set search terms
   * @param {Array} terms - Search terms array
   */
  setSearchTerms(terms) {
    this.searchTerms = Array.isArray(terms) ? terms : [];
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
        console.error(`Error in ${event} listener:`, err);
      }
    }
  }
}

// Export singleton instance
const AppState = new AppStateManager();

// Make AppState available globally
if (typeof window !== 'undefined') {
  window.AppState = AppState;
  console.log('AppState attached to window object');
}

export default AppState;