/**
 * Sanitizer Module
 * Provides functions for sanitizing user input to prevent XSS attacks
 */

/**
 * Sanitize a string by escaping HTML special characters
 * @param {string} str - String to sanitize
 * @returns {string} - Sanitized string
 */
function sanitizeString(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }
  
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Sanitize an HTML element ID for use in selectors
 * @param {string} id - Element ID to sanitize
 * @returns {string} - Sanitized ID
 */
function sanitizeId(id) {
  if (!id || typeof id !== 'string') {
    return '';
  }
  
  // Remove any characters that are not alphanumeric, dash, or underscore
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Sanitize a URL to prevent JavaScript injection
 * @param {string} url - URL to sanitize
 * @returns {string} - Sanitized URL
 */
function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') {
    return '';
  }
  
  // Only allow http:, https:, and relative URLs
  if (!/^(https?:|\/)/i.test(url)) {
    return '';
  }
  
  // Remove JavaScript protocol
  if (/^javascript:/i.test(url)) {
    return '';
  }
  
  return url;
}

/**
 * Create a DOM element with sanitized content
 * @param {string} tag - Tag name for the element
 * @param {object} attributes - Attributes for the element
 * @param {string|Array} content - Content to add to the element
 * @returns {HTMLElement} - Created element
 */
function createSafeElement(tag, attributes = {}, content = '') {
  const element = document.createElement(tag);
  
  // Add sanitized attributes
  for (const key in attributes) {
    if (Object.prototype.hasOwnProperty.call(attributes, key)) {
      let value = attributes[key];
      
      // Special handling for certain attributes to prevent XSS
      if (key === 'id' || key === 'class') {
        value = sanitizeId(value);
      } else if (key === 'href' || key === 'src') {
        value = sanitizeUrl(value);
      } else {
        value = sanitizeString(value);
      }
      
      element.setAttribute(key, value);
    }
  }
  
  // Add content
  if (Array.isArray(content)) {
    content.forEach(item => {
      if (typeof item === 'string') {
        element.appendChild(document.createTextNode(item));
      } else if (item instanceof HTMLElement) {
        element.appendChild(item);
      }
    });
  } else if (typeof content === 'string') {
    element.textContent = content;
  }
  
  return element;
}

/**
 * Safely set the text content of an element
 * @param {HTMLElement} element - Element to update
 * @param {string} content - Content to set
 * @returns {HTMLElement} - Updated element
 */
function setTextContent(element, content) {
  if (element && content) {
    element.textContent = content;
  }
  return element;
}

/**
 * Safely set the HTML content of an element
 * Uses DOMPurify if available, otherwise uses createSafeElement
 * @param {HTMLElement} element - Element to update
 * @param {string} html - HTML content to set
 * @param {boolean} allowTags - Whether to allow certain safe HTML tags
 * @returns {HTMLElement} - Updated element
 */
function setHtmlContent(element, html, allowTags = false) {
  if (!element || !html) {
    return element;
  }
  
  // If DOMPurify is available, use it
  if (window.DOMPurify) {
    element.innerHTML = window.DOMPurify.sanitize(html, {
      ALLOWED_TAGS: allowTags ? ['a', 'b', 'br', 'code', 'div', 'em', 'i', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'ul'] : [],
      ALLOWED_ATTR: allowTags ? ['href', 'target', 'rel', 'class', 'id'] : []
    });
    
    // Ensure all links open in a new tab and have noopener
    if (allowTags) {
      const links = element.querySelectorAll('a');
      links.forEach(link => {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      });
    }
  } else {
    // Fallback to basic sanitization if DOMPurify is not available
    element.textContent = '';
    
    // Create a temporary div to parse the HTML
    const tempDiv = document.createElement('div');
    tempDiv.textContent = html;
    
    // Add the sanitized content
    element.appendChild(document.createTextNode(tempDiv.textContent));
  }
  
  return element;
}

export default {
  sanitizeString,
  sanitizeId,
  sanitizeUrl,
  createSafeElement,
  setTextContent,
  setHtmlContent
};