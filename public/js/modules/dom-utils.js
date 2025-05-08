/**
 * DOM Utilities Module
 * Helper functions for DOM manipulation
 */
import Sanitizer from '../utils/sanitizer.js';

// DOM Element cache for performance
const DOMCache = new Map();

/**
 * DOM Utilities Class
 */
class DOMUtils {
  /**
   * Get DOM element with caching
   * @param {string} id - Element ID
   * @returns {HTMLElement|null} - DOM element or null if not found
   */
  static getElement(id) {
    if (!DOMCache.has(id)) {
      const element = document.getElementById(id);
      if (element) {
        DOMCache.set(id, element);
      } else {
        console.warn(`Element not found: ${id}`);
        return null;
      }
    }
    return DOMCache.get(id);
  }
  
  /**
   * Create DOM element with attributes and content
   * @param {string} tag - Element tag name
   * @param {Object} attrs - Element attributes
   * @param {string|HTMLElement|Array} content - Element content
   * @returns {HTMLElement} - Created element
   */
  static createElement(tag, attrs = {}, content = null) {
    const element = document.createElement(tag);
    
    // Set attributes
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === 'className') {
        element.className = value;
      } else if (key === 'dataset') {
        Object.entries(value).forEach(([dataKey, dataValue]) => {
          element.dataset[dataKey] = dataValue;
        });
      } else {
        element.setAttribute(key, value);
      }
    });
    
    // Set content
    if (content !== null) {
      if (typeof content === 'string') {
        element.textContent = content;
      } else if (Array.isArray(content)) {
        content.forEach(child => {
          if (child instanceof HTMLElement) {
            element.appendChild(child);
          } else if (typeof child === 'string') {
            element.appendChild(document.createTextNode(child));
          }
        });
      } else if (content instanceof HTMLElement) {
        element.appendChild(content);
      }
    }
    
    return element;
  }
  
  /**
   * Safely escape HTML to prevent XSS
   * @param {string} str - String to escape
   * @returns {string} - Escaped string
   */
  static escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  
  /**
   * Clear element content
   * @param {HTMLElement|string} element - Element or element ID
   */
  static clearElement(element) {
    const el = typeof element === 'string' ? this.getElement(element) : element;
    if (el) {
      // Safer than innerHTML = '' - removes children one by one
      while (el.firstChild) {
        el.removeChild(el.firstChild);
      }
    }
  }
  
  /**
   * Show error boundary for critical errors
   * @param {string} message - Error message
   */
  static showErrorBoundary(message) {
    const errorBoundary = this.getElement('errorBoundary');
    if (!errorBoundary) return;
    
    // Add error details
    const errorMessage = errorBoundary.querySelector('p');
    if (errorMessage) {
      errorMessage.textContent = message || 'Something went wrong. Please refresh the page.';
    }
    
    // Show error boundary
    errorBoundary.style.display = 'block';
    
    // Show backdrop
    const modalBackdrop = this.getElement('modalBackdrop');
    if (modalBackdrop) {
      modalBackdrop.style.display = 'block';
    }
    
    // Hide main content
    const mainContent = document.querySelector('main');
    if (mainContent) {
      mainContent.style.display = 'none';
    }
  }
  
  /**
   * Hide error boundary
   */
  static hideErrorBoundary() {
    const errorBoundary = this.getElement('errorBoundary');
    if (!errorBoundary) return;
    
    errorBoundary.style.display = 'none';
    
    // Hide backdrop
    const modalBackdrop = this.getElement('modalBackdrop');
    if (modalBackdrop) {
      modalBackdrop.style.display = 'none';
    }
    
    // Show main content
    const mainContent = document.querySelector('main');
    if (mainContent) {
      mainContent.style.display = 'block';
    }
  }
  
  /**
   * Show loading state in container
   * @param {string} containerId - Container ID
   * @param {string} message - Loading message
   */
  static showLoading(containerId, message = 'Loading...') {
    const container = this.getElement(containerId);
    if (!container) return;
    
    // Clear previous content
    this.clearElement(container);
    
    // Add loading div with sanitized message
    const loadingDiv = Sanitizer.createSafeElement('div', { class: 'loading' }, message);
    container.appendChild(loadingDiv);
    container.style.display = 'block';
  }
  
  /**
   * Show error state in container
   * @param {string} containerId - Container ID
   * @param {string} message - Error message
   */
  static showError(containerId, message) {
    const container = this.getElement(containerId);
    if (!container) return;
    
    // Clear previous content
    this.clearElement(container);
    
    // Create error elements with sanitized content
    const errorDiv = Sanitizer.createSafeElement('div', { class: 'error' });
    const strongElement = Sanitizer.createSafeElement('strong', {}, 'Error:');
    
    // Add the error message as text content
    errorDiv.appendChild(strongElement);
    errorDiv.appendChild(document.createTextNode(' ' + message)); // Space after "Error:"
    
    container.appendChild(errorDiv);
    container.style.display = 'block';
  }
  
  /**
   * Get value of form field
   * @param {string} fieldId - Field ID
   * @returns {string} - Field value
   */
  static getFieldValue(fieldId) {
    const field = this.getElement(fieldId);
    return field ? field.value.trim() : '';
  }
  
  /**
   * Get multiple lines from a textarea
   * @param {string} fieldId - Textarea ID
   * @returns {string[]} - Array of non-empty trimmed lines
   */
  static getTextareaLines(fieldId) {
    const text = this.getFieldValue(fieldId);
    return text.split('\n')
      .map(line => line.trim())
      .filter(Boolean);
  }
  
  /**
   * Get search input values
   * @returns {string[]} - Array of search terms
   */
  static getSearchTerms() {
    return Array.from(document.querySelectorAll('.search-term-input'))
      .map(input => input.value.trim())
      .filter(Boolean);
  }
}

export default DOMUtils;