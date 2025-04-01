// app.js - Main entry point with proper module structure
(function() {
  'use strict';
  
  // Import modules with clear responsibilities
  const DOMUtils = window.DOMUtils;
  const UIComponents = window.UIComponents;
  const ValidationModule = window.ValidationModule;
  const APIModule = window.APIModule;
  
  // Centralized application state
  const AppState = {
    isProcessing: false,
    debugMode: false,
    darkMode: localStorage.getItem('theme') === 'dark',
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
  
  // Initialize the application when DOM is fully loaded
  document.addEventListener('DOMContentLoaded', initializeApp);
  
  /**
   * Initialize the application
   */
  function initializeApp() {
    try {
      console.log('Initializing application...');
      
      // Initialize form validation
      ValidationModule.init();
      
      // Initialize theme
      initializeTheme();
      
      // Set up event handlers - centralized to avoid duplicates
      setupEventHandlers();
      
      // Initialize search terms container with a single term
      initializeSearchTerms();
      
      // Setup keyboard shortcuts for debug mode
      console.info('Press Ctrl+D to toggle debug mode');
      
      // Add global error handler
      setupErrorHandlers();
      
      console.log('Application initialized successfully');
    } catch (err) {
      console.error('Error initializing app:', err);
      UIComponents.showErrorBoundary('Failed to initialize application');
    }
  }
  
  /**
   * Initialize theme based on preferences
   */
  function initializeTheme() {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (prefersDark ? 'dark' : 'light');
    
    document.documentElement.setAttribute('data-theme', theme);
    AppState.darkMode = theme === 'dark';
    
    // Set theme toggle button state
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
      themeToggle.setAttribute('aria-pressed', theme === 'dark');
    }
  }
  
  /**
   * Set up all event handlers - centralized to prevent duplicates
   */
  function setupEventHandlers() {
    // Theme toggle
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', handleThemeToggle);
    }
    
    // Extract button
    const extractBtn = document.getElementById('extractBtn');
    if (extractBtn) {
      extractBtn.addEventListener('click', handleExtractButtonClick);
    }
    
    // Form submission
    const extractForm = document.getElementById('extractForm');
    if (extractForm) {
      extractForm.addEventListener('submit', function(event) {
        event.preventDefault();
        if (ValidationModule.validateBeforeSubmit()) {
          handleExtractButtonClick(event);
        }
      });
    }
    
    // File upload
    const csvFile = document.getElementById('csvFile');
    if (csvFile) {
      csvFile.addEventListener('change', handleFileUpload);
    }
    
    // Add search term button - single event handler
    const addTermBtn = document.querySelector('[data-action="add-term"]');
    if (addTermBtn) {
      addTermBtn.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation(); // Prevent event bubbling to document
        addNewSearchTerm();
      });
    }
    
    // Global click handler for dynamic elements - use event delegation
    document.addEventListener('click', handleDocumentClick);
    
    // Global keyboard shortcuts
    document.addEventListener('keydown', handleKeydown);
    
    // Error boundary close button
    const errorCloseBtn = document.querySelector('.error-close-btn');
    if (errorCloseBtn) {
      errorCloseBtn.addEventListener('click', function() {
        UIComponents.hideErrorBoundary();
      });
    }
  }
  
  /**
   * Initialize search terms container with a single term
   */
  function initializeSearchTerms() {
    const container = document.getElementById('searchTermsContainer');
    if (container && container.children.length === 0) {
      addNewSearchTerm();
    }
  }
  
  /**
   * Add a new search term input
   */
  function addNewSearchTerm() {
    const container = document.getElementById('searchTermsContainer');
    if (!container) return;
    
    const template = document.getElementById('search-term-template');
    if (!template) {
      console.error('Search term template not found');
      
      // Fallback: create element manually
      const row = document.createElement('div');
      row.className = 'search-term-row';
      
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'search-term-input';
      input.placeholder = 'Enter keyword or domain to search for';
      input.setAttribute('aria-label', 'Search term');
      
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'remove-search-term';
      button.setAttribute('data-action', 'remove-term');
      button.setAttribute('aria-label', 'Remove search term');
      button.textContent = '−';
      
      row.appendChild(input);
      row.appendChild(button);
      container.appendChild(row);
      
      // Focus the new input
      input.focus();
      return;
    }
    
    // Use template if available
    const clone = document.importNode(template.content, true);
    container.appendChild(clone);
    
    // Focus the new input
    const newInput = container.lastElementChild.querySelector('.search-term-input');
    if (newInput) newInput.focus();
  }
  
  /**
   * Handle theme toggle button click
   * @param {Event} event - Click event
   */
  function handleThemeToggle(event) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    AppState.darkMode = !isDark;
    
    // Update button state for accessibility
    const button = event.target.closest('button');
    if (button) {
      button.setAttribute('aria-pressed', !isDark);
      button.setAttribute('aria-label', `Toggle ${isDark ? 'dark' : 'light'} mode`);
    }
    
    // Update theme color meta tag
    ValidationModule.updateThemeColor();
  }
  
  /**
   * Handle extract button click
   * @param {Event} event - Click event
   */
  function handleExtractButtonClick(event) {
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
      UIComponents.showNotification('Please enter at least one bundle ID', 'error');
      bundleIdsTextarea?.focus();
      return;
    }
    
    // Show progress indicator and disable extract button
    AppState.setProcessing(true);
    
    // Process the bundleIds
    processBundleIds(bundleIds, searchTerms);
  }
  
  /**
   * Handle file upload
   * @param {Event} event - Change event
   */
  function handleFileUpload(event) {
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
        const parsedContent = DOMUtils.parseCSV(content);
        
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
        UIComponents.showNotification(`Successfully imported ${bundleIds.length} bundle IDs`, 'success');
        
      } catch (err) {
        console.error('Error parsing CSV:', err);
        UIComponents.showNotification(`Error parsing CSV: ${err.message}`, 'error');
        
        // Hide progress
        if (progressDiv) progressDiv.style.display = 'none';
      }
    };
    
    reader.onerror = function() {
      console.error('Error reading file');
      UIComponents.showNotification('Error reading file', 'error');
      
      // Hide progress
      if (progressDiv) progressDiv.style.display = 'none';
    };
    
    reader.readAsText(file);
  }
  
  /**
   * Handle document click events (delegation)
   * @param {Event} event - Click event
   */
  function handleDocumentClick(event) {
    const target = event.target;
    const action = target.dataset.action || target.closest('[data-action]')?.dataset.action;
    
    if (!action) return;
    
    switch (action) {
      case 'copy':
        handleCopyButtonClick(target);
        break;
      case 'toggle-ads':
        handleToggleAdsClick(target);
        break;
      case 'toggle-matches':
        handleToggleMatchesClick(target);
        break;
      case 'tab-switch':
        handleTabSwitch(target);
        break;
      case 'download-csv':
        handleDownloadCSV();
        break;
      case 'remove-term':
        handleRemoveSearchTerm(target);
        break;
      case 'close-error':
        UIComponents.hideErrorBoundary();
        break;
    }
  }
  
  /**
   * Handle keyboard shortcuts
   * @param {KeyboardEvent} event - Keydown event
   */
  function handleKeydown(event) {
    // Ctrl+D for debug mode
    if (event.ctrlKey && event.key === 'd') {
      event.preventDefault();
      const isDebug = AppState.toggleDebugMode();
      UIComponents.showNotification(`Debug mode ${isDebug ? 'enabled' : 'disabled'}`, 'info');
    }
  }
  
  /**
   * Handle remove search term button click
   * @param {HTMLElement} button - Remove button
   */
  function handleRemoveSearchTerm(button) {
    const row = button.closest('.search-term-row');
    if (row) {
      row.remove();
      
      // Make sure at least one search term input exists
      const container = document.getElementById('searchTermsContainer');
      if (container && container.children.length === 0) {
        addNewSearchTerm();
      }
    }
  }
  
  /**
   * Handle copy button click
   * @param {HTMLElement} button - Copy button
   */
  async function handleCopyButtonClick(button) {
    const textToCopy = button.dataset.copy || button.closest('[data-copy]')?.dataset.copy;
    
    if (!textToCopy) return;
    
    try {
      const success = await DOMUtils.copyToClipboard(textToCopy);
      
      if (success) {
        // Change button text temporarily
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        
        setTimeout(() => {
          button.textContent = originalText;
        }, 1500);
        
        UIComponents.showNotification(`Copied ${textToCopy} to clipboard`, 'success', 1500);
      } else {
        throw new Error('Copy failed');
      }
    } catch (err) {
      console.error('Error copying to clipboard:', err);
      UIComponents.showNotification('Failed to copy to clipboard', 'error');
    }
  }
  
  /**
   * Handle toggle app-ads.txt button click
   * @param {HTMLElement} button - Toggle button
   */
  function handleToggleAdsClick(button) {
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
  function handleToggleMatchesClick(button) {
    const targetId = button.dataset.target;
    
    if (!targetId) {
      console.error('No target ID found on button');
      return;
    }
    
    const targetElement = document.getElementById(targetId);
    
    if (!targetElement) {
      console.error('Target element not found for ID:', targetId);
      return;
    }
    
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
  function handleTabSwitch(tab) {
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
  }
  
  /**
   * Handle download CSV button click
   */
  function handleDownloadCSV() {
    downloadResultsAsCsv(AppState.results);
  }
  
  /**
   * Set up global error handlers
   */
  function setupErrorHandlers() {
    window.addEventListener('error', function(event) {
      console.error('Global error:', event.error || event.message);
      
      // Show error boundary for critical errors
      if (isCriticalError(event.error || event.message)) {
        UIComponents.showErrorBoundary(`${event.message || 'Application error'}`);
        return;
      }
      
      // For non-critical errors, show notification
      UIComponents.showNotification('An error occurred. Check console for details.', 'error');
    });
    
    window.addEventListener('unhandledrejection', function(event) {
      console.error('Unhandled promise rejection:', event.reason);
      
      // Prevent showing too many errors for network issues
      if (event.reason instanceof TypeError || 
          (event.reason.message && event.reason.message.includes('network'))) {
        UIComponents.showNotification('Network error. Please check your connection.', 'error');
        return;
      }
      
      UIComponents.showNotification('An error occurred. Check console for details.', 'error');
    });
  }
  
  /**
   * Check if an error is critical
   * @param {Error|string} error - Error object or message
   * @returns {boolean} Whether error is critical
   */
  function isCriticalError(error) {
    if (!error) return false;
    
    // Check for initialization errors that would break the app
    if (typeof error === 'string') {
      return error.includes('undefined is not a function') || 
             error.includes('null is not an object') ||
             error.includes('cannot read property') ||
             error.includes('is not defined');
    }
    
    if (error.message) {
      return error.message.includes('undefined is not a function') || 
             error.message.includes('null is not an object') ||
             error.message.includes('cannot read property') ||
             error.message.includes('is not defined');
    }
    
    return false;
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
      const response = await APIModule.extractDomains(bundleIds, searchTerms);
      
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
      
      // Generate results HTML
      const summaryHtml = UIComponents.generateResultsSummary(summaryData);
      const tableWrapper = UIComponents.generateResultsTable(AppState.results, searchTermsText);
      
      // Update results
      if (resultElement) {
        resultElement.innerHTML = summaryHtml;
        resultElement.appendChild(tableWrapper);
      }
      
      // Final completion notification
      const message = `Completed extracting ${successResults.length} domains (${response.errorCount} errors)`;
      UIComponents.showNotification(message, 'success');
      
    } catch (err) {
      console.error('Error processing bundle IDs:', err);
      
      // Show error message
      const errorMessage = err.message || 'An unknown error occurred';
      UIComponents.showNotification(`Error: ${errorMessage}`, 'error');
      
      // Update result area with error
      const resultElement = document.getElementById('result');
      if (resultElement) {
        resultElement.innerHTML = `
          <div class="error">
            <strong>Error:</strong> ${DOMUtils.escapeHtml(errorMessage)}
          </div>
        `;
      }
      
      // Update debug info if in debug mode
      const debugElement = document.getElementById('debugInfo');
      if (debugElement && AppState.debugMode) {
        debugElement.innerHTML = `
          <div class="debug-info">
            <h3>Debug Information</h3>
            <p><strong>Error:</strong> ${DOMUtils.escapeHtml(errorMessage)}</p>
            <p><strong>Stack:</strong> ${DOMUtils.escapeHtml(err.stack || 'No stack trace available')}</p>
          </div>
        `;
      }
    } finally {
      // Reset processing state
      AppState.setProcessing(false);
    }
  }
  
  /**
   * Download results as CSV
   * @param {Array} results - Results data
   */
  function downloadResultsAsCsv(results) {
    if (!results || !results.length) {
      UIComponents.showNotification('No results to download', 'error');
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
            `"${(result.storeType ? DOMUtils.getStoreDisplayName(result.storeType) : '').replace(/"/g, '""')}"`,
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
        
        UIComponents.showNotification('CSV download started', 'success');
      }, 100);
    } catch (err) {
      console.error('Error downloading CSV:', err);
      UIComponents.showNotification('Error creating CSV file', 'error');
    }
  }
  
  // Make public methods available
  window.AppController = {
    addNewSearchTerm,
    handleRemoveSearchTerm,
    processBundleIds
  };
})();