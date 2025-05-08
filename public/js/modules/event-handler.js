/**
 * Event Handler module
 * Centralizes event handling for the application
 */

import AppState from './app-state.js';
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
    
    
    // Global click handler for dynamic elements
    document.addEventListener('click', this.handleDocumentClick);
    
    // Global keyboard shortcuts
    document.addEventListener('keydown', this.handleKeydown);
    
    // Error handling
    const errorCloseBtn = document.querySelector('.error-close-btn');
    if (errorCloseBtn) {
      errorCloseBtn.addEventListener('click', () => DOMUtils.hideErrorBoundary());
    }
    
    // Event handlers initialized
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
            // Error parsing CSV
            showNotification(`Error parsing CSV: ${parseErr.message}`, 'error');
            
            // Hide progress
            if (progressDiv) progressDiv.style.display = 'none';
          }
        });
      } catch (err) {
        // Error reading file
        showNotification('Error reading file', 'error');
        
        // Hide progress
        if (progressDiv) progressDiv.style.display = 'none';
      }
    };
    
    reader.onerror = function() {
      // Error reading file
      showNotification('Error reading file', 'error');
      
      // Hide progress
      if (progressDiv) progressDiv.style.display = 'none';
    };
    
    reader.readAsText(file);
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
      case 'download-csv': // Single action for CSV download
        // Use global export timestamp to synchronize with StreamProcessor
        const currentTime = Date.now();
        
        // Check global timestamp first (takes precedence)
        if (window._lastGlobalExportTime && (currentTime - window._lastGlobalExportTime < 5000)) {
          // CSV export recently triggered (global tracking), ignoring duplicate request
          showNotification('Export already in progress, please wait a few seconds', 'info');
          // Prevent event propagation
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        
        // Also check local timestamp as fallback
        if (this._lastExportTime && (currentTime - this._lastExportTime < 5000)) {
          // CSV export recently triggered (local tracking), ignoring duplicate request
          showNotification('Export already in progress, please wait a few seconds', 'info');
          // Prevent event propagation
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        
        // Set only the local timestamp for initial tracking
        // Let StreamProcessor set the global timestamp to avoid double-checking conflicts
        this._lastExportTime = currentTime;
        
        // Stop click event propagation to prevent any duplicate triggers
        event.preventDefault();
        event.stopPropagation();
        
        // CSV export triggered
        
        // Handle all CSV download actions with the streaming method
        import('./streaming/StreamProcessor.js').then(module => {
          const StreamProcessor = module.default;
          // Get bundle IDs and search parameters
          const bundleIds = DOMUtils.getTextareaLines('bundleIds');
          
          // Only advanced mode is supported now
          // Get structured parameters from all possible sources
          let structuredParams = AppState.advancedSearchParams || window.AppState?.advancedSearchParams || window.advancedSearchParams || null;
          
          // For debugging, log what we have found
          console.log("CSV Export: Using structured params:", structuredParams);
          
          // Ensure structuredParams is always an array
          if (structuredParams && !Array.isArray(structuredParams)) {
            structuredParams = [structuredParams];
          }
          
          // Use advanced search mode with properly formatted parameters
          const searchParams = {
            mode: 'advanced',
            structuredParams: structuredParams
          };
          
          // Call export CSV function with streaming capability
          if (StreamProcessor && typeof StreamProcessor.exportCsv === 'function') {
            // Call exportCsv with search parameters
            
            // Removed redundant check that was causing issues
            // The check at the start of this function is sufficient
            
            // Pass search parameters as a unified object to ensure both simple terms
            // and structured parameters are correctly handled
            // Ensure we're calling the correct method (exportResultsAsCsv instead of exportCsv)
            if (typeof StreamProcessor.exportResultsAsCsv === 'function') {
              StreamProcessor.exportResultsAsCsv(bundleIds, searchParams);
            } else if (typeof StreamProcessor.exportCsv === 'function') {
              StreamProcessor.exportCsv(bundleIds, searchParams);
            }
            return; // Early return to prevent fallback
          }
          
          // If StreamProcessor exists but the export method doesn't exist, fall back
          CSVExporter.downloadResults(AppState.results);
        }).catch(error => {
          // Fall back to regular download if streaming fails
          CSVExporter.downloadResults(AppState.results);
          
          // Make sure to clear global timestamp if there was an error
          window._lastGlobalExportTime = null;
          this._lastExportTime = null;
        });
        break;
      case 'add-structured-search':
        this.handleAddStructuredSearch(target);
        break;
      case 'remove-structured-search':
        this.handleRemoveStructuredSearch(target);
        break;
      case 'paginate': // Use 'paginate' instead of 'pagination'
        this.handlePaginationClick(actionElement);
        break;
      case 'close-error':
        DOMUtils.hideErrorBoundary();
        break;
      case 'hide-results':
        // Hide the results display but keep completion banner visible
        const hideResultsDisplay = document.querySelector('.stream-results-display');
        if (hideResultsDisplay) {
          hideResultsDisplay.style.display = 'none';
          
          // Update all buttons at once for better efficiency
          const showResultsBtns = document.querySelectorAll('[data-action="show-results"]');
          if (showResultsBtns.length > 0) {
            // Update all matching buttons in a single iteration
            showResultsBtns.forEach(btn => { btn.textContent = 'Show Results'; });
          }
        }
        break;
      case 'show-results':
        // Show the results display
        const showResultsDisplay = document.querySelector('.stream-results-display');
        
        if (showResultsDisplay) {
          // Results display already exists, just show it
          showResultsDisplay.style.display = 'block';
          showResultsDisplay.scrollIntoView({ behavior: 'smooth', block: 'start' });
          
          // Update all matching buttons at once using querySelectorAll for better efficiency
          const hideResultsBtns = document.querySelectorAll('[data-action="hide-results"]');
          if (hideResultsBtns.length > 0) {
            hideResultsBtns.forEach(btn => { btn.textContent = 'Hide Results'; });
          }
        } else {
          // Use Promise.all to load modules in parallel for better performance
          Promise.all([
            import('./streaming/StreamResultsRenderer.js'),
            import('./app-state.js')
          ]).then(([rendererModule, appStateModule]) => {
            const streamResultsRenderer = rendererModule.default;
            const appState = appStateModule.default;
            
            // Show the results
            streamResultsRenderer.showResults(appState?.results || []);
            
            // Cache the button reference
            const showBtn = target.closest('[data-action="show-results"]');
            if (showBtn) {
              showBtn.textContent = 'Hide Results';
            }
          }).catch(error => {
            // Error importing modules
            
            // Fallback to a single import if parallel loading fails
            import('./streaming/StreamResultsRenderer.js').then(module => {
              const streamResultsRenderer = module.default;
              // Fallback to window.AppState
              streamResultsRenderer.showResults(window.AppState?.results || []);
            }).catch(fallbackError => {
              // Error in fallback code path
            });
          });
        }
        break;
    }
  }
  
  /**
   * Handle keyboard shortcuts - Empty placeholder for potential future shortcuts
   * @param {KeyboardEvent} event - Keydown event
   */
  handleKeydown = (event) => {
    // Reserved for future keyboard shortcuts
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
      // Error handling for clipboard
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
  
  
  // handleDownloadAllCSV removed - no longer needed
  
  // Remove search term handler removed (simple search mode no longer supported)
  
  /**
   * Handle pagination button click
   * @param {HTMLElement} button - Pagination button
   */
  handlePaginationClick(button) {
    // Pagination button clicked
    
    // Check if the button has 'data-action="paginate"' attribute
    const action = button.getAttribute('data-action');
    if (action !== 'paginate') {
      // Button does not have correct action
      return;
    }
    
    // Get the page number from the button
    const pageAttr = button.getAttribute('data-page');
    if (!pageAttr) {
      // Button does not have page attribute
      return;
    }
    
    const page = parseInt(pageAttr, 10);
    if (isNaN(page) || page <= 0) {
      // Invalid page number
      return;
    }
    
    // Changing to page
    
    // Import StreamResultsRenderer and use its _renderPage method to handle pagination
    import('./streaming/StreamResultsRenderer.js').then(module => {
      const streamResultsRenderer = module.default;
      
      if (streamResultsRenderer && typeof streamResultsRenderer._renderPage === 'function') {
        // Get results either from StreamResultsRenderer's allResults or from AppState
        const results = streamResultsRenderer.allResults || window.AppState?.results || [];
        // Rendering page with results
        streamResultsRenderer._renderPage(results, page);
      } else {
        // Renderer or method not found
      }
    }).catch(error => {
      // Error importing module
    });
  }
  
  /**
   * Global error handler
   * @param {ErrorEvent} event - Error event
   */
  handleGlobalError(event) {
    // Check if it's related to streaming or a known non-critical issue
    const errorString = String(event.error || event.message || '').toLowerCase();
    
    // Ignore specific errors we know are non-critical
    if (errorString.includes('target.classname.replace') || 
        errorString.includes('event-monitor') ||
        errorString.includes('iscriticalerror')) {
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
  }
  
  /**
   * Handle unhandled promise rejections
   * @param {PromiseRejectionEvent} event - Rejection event
   */
  handleUnhandledRejection(event) {
    // Prevent showing too many errors for network issues
    if (event.reason instanceof TypeError || 
        (event.reason.message && event.reason.message.includes('network'))) {
      showNotification('Network error. Please check your connection.', 'error');
      return;
    }
    
    showNotification('An error occurred.', 'error');
  }
  
  // Search mode switch handler removed (only advanced mode is supported now)
  
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