// validation-module.js - Form validation and related functionality
window.ValidationModule = (function() {
  'use strict';

  let initialized = false;

  /**
   * Initialize validation module
   */
  function init() {
    if (initialized) return;
    
    // Initialize form elements
    const bundleIdsTextarea = document.getElementById('bundleIds');
    const bundleIdsValidation = document.getElementById('bundleIds-validation');
    const csvFileInput = document.getElementById('csvFile');
    const csvFileValidation = document.getElementById('csvFile-validation');
    const extractBtn = document.getElementById('extractBtn');
    const errorCloseBtn = document.querySelector('.error-close-btn');
    
    // Set up validation listeners
    if (bundleIdsTextarea && bundleIdsValidation) {
      bundleIdsTextarea.addEventListener('input', function() {
        validateBundleIds(bundleIdsTextarea, bundleIdsValidation);
      });
    }
    
    if (csvFileInput && csvFileValidation) {
      csvFileInput.addEventListener('change', function() {
        validateCsvFile(csvFileInput, csvFileValidation);
      });
    }
    
    // Initialize focus trap for modal dialogs
    initFocusTrap();
    
    // Update theme color based on current theme
    updateThemeColor();
    
    // Mark as initialized
    initialized = true;
  }
  
  /**
   * Validate bundle IDs
   * @param {HTMLTextAreaElement} textarea - The bundle IDs textarea
   * @param {HTMLElement} validationElement - The validation message element
   * @returns {boolean} - Whether validation passed
   */
  function validateBundleIds(textarea, validationElement) {
    const value = textarea.value.trim();
    const lines = value.split('\n').filter(line => line.trim().length > 0);
    
    if (lines.length === 0) {
      validationElement.textContent = 'Please enter at least one bundle ID';
      validationElement.className = 'validation-message error';
      textarea.setAttribute('aria-invalid', 'true');
      return false;
    }
    
    validationElement.textContent = lines.length > 1 ? 
      `${lines.length} bundle IDs detected` : 
      '1 bundle ID detected';
    validationElement.className = 'validation-message success';
    textarea.setAttribute('aria-invalid', 'false');
    return true;
  }
  
  /**
   * Validate CSV file
   * @param {HTMLInputElement} fileInput - The file input element
   * @param {HTMLElement} validationElement - The validation message element
   * @returns {boolean} - Whether validation passed
   */
  function validateCsvFile(fileInput, validationElement) {
    if (!fileInput.files || fileInput.files.length === 0) {
      validationElement.textContent = '';
      return true;
    }
    
    const file = fileInput.files[0];
    
    if (!file.name.toLowerCase().endsWith('.csv')) {
      validationElement.textContent = 'Please select a CSV file';
      validationElement.className = 'validation-message error';
      fileInput.setAttribute('aria-invalid', 'true');
      return false;
    } else {
      validationElement.textContent = `Selected file: ${file.name}`;
      validationElement.className = 'validation-message success';
      fileInput.setAttribute('aria-invalid', 'false');
      return true;
    }
  }
  
  /**
   * Validate before submitting
   * @returns {boolean} - Whether validation passed
   */
  function validateBeforeSubmit() {
    const bundleIdsTextarea = document.getElementById('bundleIds');
    const bundleIdsValidation = document.getElementById('bundleIds-validation');
    const csvFileInput = document.getElementById('csvFile');
    
    // Check if there are bundle IDs or a file is selected
    const hasBundleIds = bundleIdsTextarea && bundleIdsTextarea.value.trim().length > 0;
    const hasFile = csvFileInput && csvFileInput.files && csvFileInput.files.length > 0;
    
    if (!hasBundleIds && !hasFile) {
      if (bundleIdsValidation) {
        bundleIdsValidation.textContent = 'Please enter bundle IDs or upload a CSV file';
        bundleIdsValidation.className = 'validation-message error';
        bundleIdsTextarea.setAttribute('aria-invalid', 'true');
        bundleIdsTextarea.focus();
      }
      return false;
    }
    
    // If bundle IDs are provided, validate them
    if (hasBundleIds && bundleIdsTextarea && bundleIdsValidation) {
      return validateBundleIds(bundleIdsTextarea, bundleIdsValidation);
    }
    
    return true;
  }
  
  /**
   * Initialize focus trap for modal dialogs
   */
  function initFocusTrap() {
    // Handle focus trap in error boundary
    const errorBoundary = document.getElementById('errorBoundary');
    if (errorBoundary) {
      errorBoundary.addEventListener('keydown', function(event) {
        // Close on escape
        if (event.key === 'Escape') {
          hideErrorBoundary();
          event.preventDefault();
        }
        
        // Trap focus
        if (event.key === 'Tab') {
          const focusable = errorBoundary.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          
          if (focusable.length > 0) {
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            
            if (event.shiftKey && document.activeElement === first) {
              last.focus();
              event.preventDefault();
            } else if (!event.shiftKey && document.activeElement === last) {
              first.focus();
              event.preventDefault();
            }
          }
        }
      });
    }
  }
  
  /**
   * Hide error boundary
   */
  function hideErrorBoundary() {
    const errorBoundary = document.getElementById('errorBoundary');
    const modalBackdrop = document.getElementById('modalBackdrop');
    
    if (errorBoundary) {
      errorBoundary.style.display = 'none';
      
      // Restore focus
      if (window.lastFocusedElement) {
        window.lastFocusedElement.focus();
      }
      
      // Hide backdrop
      if (modalBackdrop) {
        modalBackdrop.style.display = 'none';
      }
    }
  }
  
  /**
   * Update the theme-color meta tag based on current theme
   */
  function updateThemeColor() {
    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    
    if (themeColorMeta) {
      // Use appropriate color based on theme
      themeColorMeta.setAttribute(
        'content', 
        isDarkMode ? '#121826' : '#3498db'
      );
    }
  }
  
  // Public API
  return {
    init,
    validateBundleIds,
    validateCsvFile,
    validateBeforeSubmit,
    updateThemeColor,
    hideErrorBoundary
  };
})();