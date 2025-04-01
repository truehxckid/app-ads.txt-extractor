/**
 * Form validation for the App Developer Domain Extractor
 * Handles form validation, error states, and focus management
 */

// Initialize validation when the DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  // Initialize form elements
  const bundleIdsTextarea = document.getElementById('bundleIds');
  const bundleIdsValidation = document.getElementById('bundleIds-validation');
  const csvFileInput = document.getElementById('csvFile');
  const csvFileValidation = document.getElementById('csvFile-validation');
  const extractBtn = document.getElementById('extractBtn');
  const errorCloseBtn = document.querySelector('.error-close-btn');
  const errorBoundary = document.getElementById('errorBoundary');
  const modalBackdrop = document.getElementById('modalBackdrop');
  
  // Set up event listeners
  if (bundleIdsTextarea && bundleIdsValidation) {
    bundleIdsTextarea.addEventListener('input', function() {
      validateBundleIds(this, bundleIdsValidation);
    });
  }
  
  if (csvFileInput && csvFileValidation) {
    csvFileInput.addEventListener('change', function() {
      validateCsvFile(this, csvFileValidation);
    });
  }
  
  // Form submission handling
  if (extractBtn) {
    extractBtn.addEventListener('click', function(event) {
      // Prevent action if validation fails
      if (!validateBeforeSubmit()) {
        event.stopPropagation();
      }
    }, true); // Use capturing to intercept before other handlers
  }
  
  // Error boundary handling
  if (errorCloseBtn) {
    errorCloseBtn.addEventListener('click', function() {
      hideErrorBoundary();
    });
  }
  
  // Handle form submission with Enter key
  document.getElementById('extractForm').addEventListener('submit', function(event) {
    event.preventDefault(); // Prevent traditional form submission
    
    if (validateBeforeSubmit()) {
      // If valid, trigger the extract button click to use existing logic
      extractBtn.click();
    }
  });
  
  // Initialize focus trap for error boundary and modals
  initFocusTrap();
  
  // Set up theme color based on current theme
  updateThemeColor();
  
  // Listen for theme changes
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function() {
      // Small delay to allow theme to change before updating meta tag
      setTimeout(updateThemeColor, 100);
    });
  }
});

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
  } else {
    validationElement.textContent = lines.length > 1 ? 
      `${lines.length} bundle IDs detected` : 
      '1 bundle ID detected';
    validationElement.className = 'validation-message success';
    textarea.setAttribute('aria-invalid', 'false');
    return true;
  }
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
  if (hasBundleIds && bundleIdsValidation) {
    return validateBundleIds(bundleIdsTextarea, bundleIdsValidation);
  }
  
  return true;
}

/**
 * Show error boundary with focus management
 * @param {string} message - Error message to display
 */
function showErrorBoundary(message) {
  const errorBoundary = document.getElementById('errorBoundary');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const errorMessage = errorBoundary.querySelector('p');
  
  if (errorMessage && message) {
    errorMessage.textContent = message;
  }
  
  if (errorBoundary) {
    errorBoundary.style.display = 'block';
    
    // Save last focused element to restore later
    window.lastFocusedElement = document.activeElement;
    
    // Focus the error dialog
    errorBoundary.focus();
    
    // Show backdrop
    if (modalBackdrop) {
      modalBackdrop.style.display = 'block';
    }
  }
}

/**
 * Hide error boundary and restore focus
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

// Expose these functions globally for use by other scripts
window.FormValidation = {
  validateBundleIds,
  validateCsvFile,
  validateBeforeSubmit,
  showErrorBoundary,
  hideErrorBoundary,
  updateThemeColor
};