/**
 * Error handling fixes for app.js
 * This script should be loaded before validation.js and app.js
 */

// Run as soon as possible
(function() {
  console.log('Running error fixes script');
  
  // Global flag to prevent duplicate event handlers
  window._searchTermHandlersAdded = window._searchTermHandlersAdded || false;
  
  // Make sure DOM is loaded before accessing elements
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFixScript);
  } else {
    initFixScript();
  }
  
  function initFixScript() {
    console.log('DOM loaded, initializing fixes');
    
    // Fix error dialog that's showing inappropriately
    hideErrorDialog();
    
    // Make sure page layout is ready before app init
    fixMissingElements();
    
    // Safe initialization of search terms
    safeInitSearchTerms();
    
    // Add error handling for button clicks
    addSafeButtonHandlers();
  }
  
  /**
   * Hide any error dialogs that are showing
   */
  function hideErrorDialog() {
    const errorBoundary = document.getElementById('errorBoundary');
    const modalBackdrop = document.getElementById('modalBackdrop');
    
    if (errorBoundary && errorBoundary.style.display === 'block') {
      console.log('Hiding error dialog');
      errorBoundary.style.display = 'none';
      
      if (modalBackdrop) {
        modalBackdrop.style.display = 'none';
      }
    }
    
    // Close any other error messages
    const closeButtons = document.querySelectorAll('.error-close-btn, button[data-action="close-error"]');
    closeButtons.forEach(button => {
      if (button && typeof button.click === 'function') {
        button.click();
      }
    });
  }
  
  /**
   * Check and fix missing elements that could cause layout issues
   */
  function fixMissingElements() {
    // Make sure search container exists
    let searchContainer = document.getElementById('searchTermsContainer');
    if (!searchContainer) {
      console.warn('Search terms container missing, creating it');
      
      // Find parent element
      const searchOptions = document.querySelector('.search-options');
      if (searchOptions) {
        // Create and insert container
        searchContainer = document.createElement('div');
        searchContainer.id = 'searchTermsContainer';
        searchContainer.setAttribute('role', 'group');
        searchContainer.setAttribute('aria-labelledby', 'search-terms-label');
        
        // Find the right position to insert
        const label = searchOptions.querySelector('label');
        if (label) {
          label.after(searchContainer);
        } else {
          searchOptions.appendChild(searchContainer);
        }
      }
    }
    
    // Check if notification container exists
    const notificationContainer = document.getElementById('notificationContainer');
    if (!notificationContainer) {
      console.warn('Notification container missing, creating it');
      
      const newContainer = document.createElement('div');
      newContainer.id = 'notificationContainer';
      newContainer.className = 'notification-container';
      newContainer.setAttribute('aria-live', 'assertive');
      newContainer.setAttribute('aria-atomic', 'true');
      
      document.body.appendChild(newContainer);
    }
  }
  
  /**
   * Safely initialize search terms
   */
  function safeInitSearchTerms() {
    try {
      const container = document.getElementById('searchTermsContainer');
      if (container && container.children.length === 0) {
        console.log('Initializing search terms container');
        addNewSearchTerm();
      }
    } catch (err) {
      console.error('Error initializing search terms:', err);
    }
  }
  
  /**
   * Add a new search term input
   */
  function addNewSearchTerm() {
    try {
      // Debug statement to track function calls
      console.log('addNewSearchTerm called from fix-errors.js');
      
      const container = document.getElementById('searchTermsContainer');
      if (!container) {
        console.error('Search terms container not found');
        return;
      }
      
      const template = document.getElementById('search-term-template');
      if (!template) {
        console.warn('Search term template not found, creating manually');
        
        // Create elements manually
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
        
        return;
      }
      
      // Use template if available
      const clone = document.importNode(template.content, true);
      container.appendChild(clone);
    } catch (err) {
      console.error('Error adding search term:', err);
    }
  }
  
  /**
   * Add safe event handlers for buttons
   */
  function addSafeButtonHandlers() {
    // Only add handlers if they haven't been added yet
    if (window._searchTermHandlersAdded) {
      console.log('Search term handlers already added, skipping');
      return;
    }
    
    // Handle add term button
    const addTermButton = document.querySelector('[data-action="add-term"]');
    if (addTermButton) {
      console.log('Adding safe handler for add term button');
      
      // Remove existing listeners to avoid duplicates
      const newButton = addTermButton.cloneNode(true);
      addTermButton.parentNode.replaceChild(newButton, addTermButton);
      
      // Add a single click handler
      newButton.addEventListener('click', function(event) {
        console.log('Add term button clicked');
        event.preventDefault();
        
        // Use a flag to prevent multiple adds on a single click
        if (!window._addingSearchTerm) {
          window._addingSearchTerm = true;
          
          setTimeout(() => {
            addNewSearchTerm();
            window._addingSearchTerm = false;
          }, 10);
        }
      });
      
      // Mark that handlers have been added
      window._searchTermHandlersAdded = true;
    }
    
    // Handle document click for delegation with proper flags to prevent multiple handlers
    document.removeEventListener('click', documentClickHandler); // Remove any existing handler
    document.addEventListener('click', documentClickHandler);
  }
  
  /**
   * Document click handler for delegation
   */
  function documentClickHandler(event) {
    const target = event.target;
    const action = target.dataset.action || target.closest('[data-action]')?.dataset.action;
    
    if (!action) return;
    
    switch (action) {
      case 'remove-term':
        const row = target.closest('.search-term-row');
        if (row) {
          row.remove();
          
          // Ensure at least one search term exists
          const container = document.getElementById('searchTermsContainer');
          if (container && container.children.length === 0) {
            addNewSearchTerm();
          }
        }
        break;
      case 'close-error':
        hideErrorDialog();
        break;
    }
  }
})();