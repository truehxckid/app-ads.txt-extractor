/**
 * Event Handler module
 * Centralizes event handling for the application
 */

import AppState from './app-state.js';
import SearchManager from './search.js'; // Legacy - will be phased out
import DOMUtils from './dom-utils.js';
import { showNotification } from '../utils/notification.js';
import ThemeManager from '../utils/theme.js';
import Api from './api.js';
import CSVExporter from './exporter.js';
import StreamProcessor from './streaming/StreamProcessor.js';
import UnifiedSearch from './unified-search.js';

/**
 * Event Handler Class
 */
class EventHandlerManager {
  /**
   * Initialize all event listeners
   */
  initialize() {
    // Theme toggle
    const themeToggleBtn = DOMUtils.getElement('themeToggle');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', this.handleThemeToggle);
    }
    
    // Extract button
    const extractBtn = DOMUtils.getElement('extractBtn');
    if (extractBtn) {
      extractBtn.addEventListener('click', this.handleExtractButtonClick);
    }
    
    // File upload
    const csvFileInput = DOMUtils.getElement('csvFile');
    if (csvFileInput) {
      csvFileInput.addEventListener('change', this.handleFileUpload);
    }
    
    // Form submission
    const extractForm = DOMUtils.getElement('extractForm');
    if (extractForm) {
      extractForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleExtractButtonClick(e);
      });
    }
    
    // Search term add button
    const addTermBtn = document.querySelector('[data-action="add-term"]');
    if (addTermBtn) {
      addTermBtn.addEventListener('click', this.handleAddSearchTerm);
    }
    
    // Global click handler for dynamic elements
    document.addEventListener('click', this.handleDocumentClick);
    
    // Global keyboard shortcuts
    document.addEventListener('keydown', this.handleKeydown);
    
    // Error handling
    const errorCloseBtn = document.querySelector('.error-close-btn');
    if (errorCloseBtn) {
      errorCloseBtn.addEventListener('click', () => DOMUtils.hideErrorBoundary());
    }
    
    console.log('Event handlers initialized');
  }
  
  /**
   * Handle theme toggle button click
   * @param {Event} event - Click event
   */
  handleThemeToggle = (event) => {
    ThemeManager.toggleTheme();
  }
  
  /**
   * Handle extract button click
   * @param {Event} event - Click event
   */
  handleExtractButtonClick = (event) => {
    // Prevent default form submission
    event.preventDefault();
    
    // Prevent double submission
    if (AppState.isProcessing) return;
    
    // Get bundle IDs
    const bundleIdsElement = DOMUtils.getElement('bundleIds');
    const bundleIds = bundleIdsElement ? 
      DOMUtils.getTextareaLines('bundleIds') : [];
    
    if (bundleIds.length === 0) {
      showNotification('Please enter at least one bundle ID', 'error');
      bundleIdsElement?.focus();
      return;
    }
    
    // Get unified search parameters
    const searchParams = UnifiedSearch.getSearchParams();
    
    // Store search parameters in app state
    AppState.setSearchParams(searchParams);
    
    // Show processing indicator and disable extract button
    AppState.setProcessing(true);
    
    // Process the bundleIds with StreamProcessor
    StreamProcessor.processBundleIds(bundleIds, searchParams);
  }
  
  /**
   * Handle file upload
   * @param {Event} event - Change event
   */
  handleFileUpload = (event) => {
    const fileInput = event.target;
    const file = fileInput.files?.[0];
    
    if (!file) return;
    
    // Display file name
    const fileNameDisplay = DOMUtils.getElement('fileNameDisplay');
    if (fileNameDisplay) {
      fileNameDisplay.textContent = file.name;
    }
    
    // Show progress
    const progressDiv = DOMUtils.getElement('fileUploadProgress');
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
        
        // Import CSV utilities dynamically to keep initial load fast
        import('../utils/csv.js').then(module => {
          const CSVUtils = module.default;
          
          try {
            // Parse CSV
            const parsedContent = CSVUtils.parseCSV(content);
            
            // Find the bundle ID column
            let bundleIdColumn = CSVUtils.findBundleIdColumn(parsedContent.header);
            
            // Extract bundle IDs
            const bundleIds = CSVUtils.extractBundleIds(parsedContent.data, bundleIdColumn);
            
            // Update progress
            if (progressBar) progressBar.style.width = '100%';
            if (progressText) progressText.textContent = `Found ${bundleIds.length} bundle IDs`;
            
            // Fill textarea with bundle IDs
            const bundleIdsTextarea = DOMUtils.getElement('bundleIds');
            if (bundleIdsTextarea) {
              bundleIdsTextarea.value = bundleIds.join('\n');
            }
            
            // Hide progress after a delay
            setTimeout(() => {
              if (progressDiv) progressDiv.style.display = 'none';
            }, 2000);
            
            // Show notification
            showNotification(`Successfully imported ${bundleIds.length} bundle IDs`, 'success');
          } catch (parseErr) {
            console.error('Error parsing CSV:', parseErr);
            showNotification(`Error parsing CSV: ${parseErr.message}`, 'error');
            
            // Hide progress
            if (progressDiv) progressDiv.style.display = 'none';
          }
        });
      } catch (err) {
        console.error('Error reading file:', err);
        showNotification('Error reading file', 'error');
        
        // Hide progress
        if (progressDiv) progressDiv.style.display = 'none';
      }
    };
    
    reader.onerror = function() {
      console.error('Error reading file');
      showNotification('Error reading file', 'error');
      
      // Hide progress
      if (progressDiv) progressDiv.style.display = 'none';
    };
    
    reader.readAsText(file);
  }
  
  /**
   * Handle add search term button click
   * @param {Event} event - Click event
   */
  handleAddSearchTerm = (event) => {
    event.preventDefault();
    UnifiedSearch.addSearchTerm();
  }
  
  /**
   * Handle document click events (delegation)
   * @param {Event} event - Click event
   */
  handleDocumentClick = (event) => {
    const target = event.target;
    const actionElement = target.hasAttribute('data-action') 
      ? target 
      : target.closest('[data-action]');
    
    // Make sure we have an action element
    if (!actionElement) return;
    
    const action = actionElement.dataset.action;
    
    // Check for duplicate events (sometimes the browser sends duplicate events)
    const now = Date.now();
    const lastClickTime = this._lastClickTime || 0;
    const lastClickAction = this._lastClickAction || '';
    
    // If the same action was clicked within 300ms, it's likely a duplicate event
    if (action === lastClickAction && (now - lastClickTime < 300)) {
      console.log('Ignoring potential duplicate click event on:', action);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    
    // Update click tracking
    this._lastClickTime = now;
    this._lastClickAction = action;
    
    if (!action) return;
    
    switch (action) {
      case 'copy':
        this.handleCopyButtonClick(target);
        break;
      case 'toggle-ads':
        this.handleToggleAdsClick(target);
        break;
      case 'toggle-matches':
        this.handleToggleMatchesClick(target);
        break;
      case 'tab-switch':
        this.handleTabSwitch(target);
        break;
      case 'download-csv':
      case 'stream-download-csv':
        // Prevent multiple execution by using a debounce mechanism
        // Instead of just a flag, use a timestamp for better prevention
        const currentTime = Date.now();
        if (this._lastExportTime && (currentTime - this._lastExportTime < 5000)) {
          console.log('CSV export recently triggered, ignoring duplicate request');
          // Prevent event propagation
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        
        // Set timestamp
        this._lastExportTime = currentTime;
        
        // Stop click event propagation to prevent any duplicate triggers
        event.preventDefault();
        event.stopPropagation();
        
        console.log('CSV export triggered at: ' + new Date().toISOString());
        
        // Handle all CSV download actions with the streaming method
        import('./streaming/StreamProcessor.js').then(module => {
          const StreamProcessor = module.default;
          // Get bundle IDs and search parameters
          const bundleIds = DOMUtils.getTextareaLines('bundleIds');
          
          // Choose parameters based on current search mode
          const currentSearchMode = window.currentSearchMode || 'simple';
          let searchParams;
          
          if (currentSearchMode === 'advanced') {
            // For advanced mode, create params object with structured params
            let structuredParams = window.AppState?.advancedSearchParams || window.advancedSearchParams || null;
            
            // Ensure structuredParams is always an array
            if (structuredParams && !Array.isArray(structuredParams)) {
              structuredParams = [structuredParams];
            }
            
            console.log('📊 CSV Export: Using ADVANCED search mode:', structuredParams);
            searchParams = {
              mode: 'advanced',
              structuredParams: structuredParams
            };
          } else {
            // For simple mode, create params object with search terms
            const searchTerms = AppState.searchTerms.length > 0 ? AppState.searchTerms : DOMUtils.getSearchTerms();
            console.log('📊 CSV Export: Using SIMPLE search mode:', searchTerms);
            searchParams = {
              mode: 'simple',
              queries: searchTerms
            };
          }
          
          // Call export CSV function with streaming capability
          if (StreamProcessor && typeof StreamProcessor.exportCsv === 'function') {
            // Log the search params we're sending
            console.log('Calling StreamProcessor.exportCsv with searchParams:', searchParams);
            
            // Pass search parameters as a unified object to ensure both simple terms
            // and structured parameters are correctly handled
            StreamProcessor.exportCsv(bundleIds, searchParams);
            return; // Early return to prevent fallback
          }
          
          // If StreamProcessor exists but exportCsv method doesn't exist, fall back
          console.warn('StreamProcessor exists but exportCsv method not found, falling back to regular download');
          CSVExporter.downloadResults(AppState.results);
        }).catch(error => {
          console.error('Error importing StreamProcessor for CSV export:', error);
          
          // Fall back to regular download if streaming fails
          CSVExporter.downloadResults(AppState.results);
        });
        break;
      case 'download-all-csv':
        this.handleDownloadAllCSV();
        break;
      case 'remove-term':
        this.handleRemoveSearchTerm(target);
        break;
      case 'add-structured-search':
        this.handleAddStructuredSearch(target);
        break;
      case 'remove-structured-search':
        this.handleRemoveStructuredSearch(target);
        break;
      case 'pagination':
        this.handlePaginationClick(target);
        break;
      case 'close-error':
        DOMUtils.hideErrorBoundary();
        break;
      case 'switch-search-mode':
        this.handleSwitchSearchMode(target);
        break;
      case 'hide-results':
      case 'show-results':
        break;
    }
  }
  
  /**
   * Handle keyboard shortcuts
   * @param {KeyboardEvent} event - Keydown event
   */
  handleKeydown = (event) => {
    // Ctrl+D for debug mode
    if (event.ctrlKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      const isDebug = AppState.toggleDebugMode();
      showNotification(`Debug mode ${isDebug ? 'enabled' : 'disabled'}`, 'info');
    }
  }
  
  /**
   * Handle copy button click
   * @param {HTMLElement} button - Copy button
   */
  async handleCopyButtonClick(button) {
    const textToCopy = button.dataset.copy || button.closest('[data-copy]')?.dataset.copy;
    
    if (!textToCopy) return;
    
    try {
      // Use navigator clipboard API
      await navigator.clipboard.writeText(textToCopy);
      
      // Change button text temporarily
      const originalText = button.textContent;
      button.textContent = 'Copied!';
      
      setTimeout(() => {
        button.textContent = originalText;
      }, 1500);
      
      showNotification(`Copied ${textToCopy} to clipboard`, 'success', 1500);
    } catch (err) {
      console.error('Error copying to clipboard:', err);
      showNotification('Failed to copy to clipboard', 'error');
    }
  }
  
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
  }
  
  /**
   * Handle toggle search matches button click
   * @param {HTMLElement} button - Toggle button
   */
  handleToggleMatchesClick(button) {
    const targetId = button.dataset.target;
    if (!targetId) return;
    
    const targetElement = document.getElementById(targetId);
    if (!targetElement) return;
    
    const isVisible = targetElement.style.display !== 'none';
    
    // Toggle visibility
    targetElement.style.display = isVisible ? 'none' : 'block';
    
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
  }
  
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
    
    // Get all content elements
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
  }
  
  
  /**
   * Handle download all CSV button click
   */
  handleDownloadAllCSV() {
    // Get bundle IDs
    const bundleIds = DOMUtils.getTextareaLines('bundleIds');
    
    // Choose parameters based on current search mode
    const currentSearchMode = window.currentSearchMode || 'simple';
    
    if (currentSearchMode === 'advanced') {
      // For advanced mode, use structured params
      let structuredParams = window.AppState?.advancedSearchParams || window.advancedSearchParams || null;
      
      // Ensure structuredParams is always an array
      if (structuredParams && !Array.isArray(structuredParams)) {
        structuredParams = [structuredParams];
      }
      
      console.log('📊 CSV Export All: Using ADVANCED search mode:', structuredParams);
      
      // Download with structured params and empty search terms
      CSVExporter.downloadAllResults(bundleIds, [], structuredParams);
    } else {
      // For simple mode, use search terms
      const searchTerms = AppState.searchTerms.length > 0 ? 
        AppState.searchTerms : DOMUtils.getSearchTerms();
      console.log('📊 CSV Export All: Using SIMPLE search mode:', searchTerms);
      
      // Download with search terms and no structured params
      CSVExporter.downloadAllResults(bundleIds, searchTerms);
    }
  }
  
  /**
   * Handle remove search term button click
   * @param {HTMLElement} button - Remove button
   */
  handleRemoveSearchTerm(button) {
    UnifiedSearch.removeSearchTerm(button);
  }
  
  /**
   * Handle pagination button click
   * @param {HTMLElement} button - Pagination button
   */
  handlePaginationClick(button) {
    // Implemented in StreamResultsRenderer
  }
  
  /**
   * Global error handler
   * @param {ErrorEvent} event - Error event
   */
  handleGlobalError(event) {
    console.error('Global error:', event.error || event.message);
    
    // Check if it's related to streaming or a known non-critical issue
    const errorString = String(event.error || event.message || '').toLowerCase();
    
    // Ignore specific errors we know are non-critical
    if (errorString.includes('target.classname.replace') || 
        errorString.includes('event-monitor') ||
        errorString.includes('iscriticalerror')) {
      console.log('Ignoring non-critical UI error:', errorString);
      return;
    }
    
    // Check if error is related to streaming
    const isStreamingError = errorString.includes('stream') || 
                            errorString.includes('worker') || 
                            errorString.includes('web worker');
    
    // Only show UI error for non-streaming errors that would impact user experience
    if (!isStreamingError && errorString.includes('undefined') || errorString.includes('null')) {
      DOMUtils.showErrorBoundary(`${event.message || 'Application error'}`);
      return;
    }
    
    // For non-critical errors, just log to console
    // Skip showing notification to reduce UI clutter during streaming
  }
  
  /**
   * Handle unhandled promise rejections
   * @param {PromiseRejectionEvent} event - Rejection event
   */
  handleUnhandledRejection(event) {
    console.error('Unhandled promise rejection:', event.reason);
    
    // Prevent showing too many errors for network issues
    if (event.reason instanceof TypeError || 
        (event.reason.message && event.reason.message.includes('network'))) {
      showNotification('Network error. Please check your connection.', 'error');
      return;
    }
    
    showNotification('An error occurred. Check console for details.', 'error');
  }
  
  /**
   * Handle search mode switch
   * @param {HTMLElement} button - Mode toggle button
   */
  handleSwitchSearchMode(button) {
    UnifiedSearch.handleModeSwitch({ target: button });
  }
  
  /**
   * Handle add structured search button click
   * @param {HTMLElement} button - Add button
   */
  handleAddStructuredSearch(button) {
    UnifiedSearch.addStructuredSearchForm();
  }
  
  /**
   * Handle remove structured search button click
   * @param {HTMLElement} button - Remove button
   */
  handleRemoveStructuredSearch(button) {
    UnifiedSearch.removeStructuredSearchForm(button);
  }

  /**
   * Check if an error is critical
   * @param {Error|string} error - Error object or message
   * @returns {boolean} - Whether error is critical
   */
  isCriticalError(error) {
    if (!error) return false;
    
    // First check for known non-critical errors
    const errorString = String(error).toLowerCase();
    
    // Ignore known non-critical errors
    if (errorString.includes('event-monitor') || 
        errorString.includes('target.classname') ||
        errorString.includes('iscriticalerror')) {
      return false;
    }
    
    // Check for initialization errors that would break the app
    if ((typeof error === 'object' && error.message) || typeof error === 'string') {
      const message = typeof error === 'object' ? error.message : error;
      
      return message.includes('undefined is not a function') ||
             message.includes('null is not an object') ||
             message.includes('cannot read property') ||
             message.includes('is not defined') ||
             message.includes('is not a function');
    }
    
    return true;
  }
}

// Export singleton instance
const EventHandler = new EventHandlerManager();
export default EventHandler;