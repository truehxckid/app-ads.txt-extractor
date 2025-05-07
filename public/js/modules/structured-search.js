/**
 * Structured Search Module
 * Handles advanced structured search functionality for app-ads.txt files
 */

import DOMUtils from './dom-utils.js';
import Api from './api.js';
import { showNotification } from '../utils/notification.js';

/**
 * Structured Search Manager Class
 */
class StructuredSearchManager {
  constructor() {
    // Prevent duplicate event handlers flag
    this.handlersAdded = false;
  }
  
  /**
   * Initialize structured search functionality
   */
  initialize() {
    console.log('🔍 Initializing StructuredSearchManager');
    
    // Add advanced search toggle button event handler
    const toggleButton = document.querySelector('[data-action="toggle-advanced-search"]');
    if (toggleButton && !this.handlersAdded) {
      toggleButton.addEventListener('click', this.toggleAdvancedSearch.bind(this));
      this.handlersAdded = true;
    }
  }
  
  /**
   * Toggle advanced search container visibility
   * @param {Event} event - Click event
   */
  toggleAdvancedSearch(event) {
    event.preventDefault();
    
    const toggleButton = event.target;
    const advancedSearchContainer = document.getElementById('advancedSearchContainer');
    
    if (!advancedSearchContainer) return;
    
    const isVisible = advancedSearchContainer.style.display !== 'none';
    
    // Toggle visibility
    advancedSearchContainer.style.display = isVisible ? 'none' : 'block';
    
    // Update button attributes
    toggleButton.setAttribute('aria-expanded', !isVisible);
    toggleButton.textContent = isVisible ? 'Toggle Advanced Search' : 'Hide Advanced Search';
    
    // If showing, focus the first input field
    if (!isVisible) {
      const firstInput = advancedSearchContainer.querySelector('input');
      if (firstInput) firstInput.focus();
    }
  }
  
  /**
   * Get structured search query from form
   * @returns {Object|null} - Structured query object or null if empty
   */
  getStructuredQuery() {
    const domainField = document.getElementById('structuredDomain');
    const publisherIdField = document.getElementById('structuredPublisherId');
    const relationshipField = document.getElementById('structuredRelationship');
    const tagIdField = document.getElementById('structuredTagId');
    
    // Get values and trim whitespace
    const domain = domainField?.value?.trim() || '';
    const publisherId = publisherIdField?.value?.trim() || '';
    const relationship = relationshipField?.value?.trim() || '';
    const tagId = tagIdField?.value?.trim() || '';
    
    // Check if any field has a value
    if (!domain && !publisherId && !relationship && !tagId) {
      return null;
    }
    
    return {
      domain,
      publisherId,
      relationship,
      tagId
    };
  }
  
  /**
   * Reset structured search form
   */
  resetForm() {
    const fields = [
      'structuredDomain',
      'structuredPublisherId',
      'structuredRelationship',
      'structuredTagId'
    ];
    
    fields.forEach(fieldId => {
      const field = document.getElementById(fieldId);
      if (field) {
        if (field.tagName === 'SELECT') {
          field.selectedIndex = 0;
        } else {
          field.value = '';
        }
      }
    });
  }
  
  /**
   * Perform structured search
   * @param {string} domain - Domain to check
   * @returns {Promise<Object>} - Search results
   */
  async performStructuredSearch(domain) {
    try {
      const query = this.getStructuredQuery();
      
      if (!query) {
        showNotification('Please fill at least one field in the structured search form', 'warning');
        return null;
      }
      
      // Show loading notification
      showNotification('Performing structured search...', 'info');
      
      // Call API
      const result = await Api.structuredSearch(domain, query);
      
      if (!result.success) {
        showNotification(result.error || 'Error performing structured search', 'error');
        return null;
      }
      
      // Show success notification with match count
      const matchCount = result.result?.count || 0;
      showNotification(`Found ${matchCount} structured search matches`, 'success');
      
      return result.result;
    } catch (err) {
      console.error('Structured search error:', err);
      showNotification(err.message || 'Error performing structured search', 'error');
      return null;
    }
  }
  
  /**
   * Format structured search results for display
   * @param {Object} results - Structured search results
   * @returns {string} - HTML formatted results
   */
  formatResults(results) {
    if (!results || !results.matches || results.matches.length === 0) {
      return `<div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <h3 class="empty-state-title">No matches found</h3>
        <p class="empty-state-description">Try adjusting your search criteria.</p>
      </div>`;
    }
    
    // Format the query for display
    const queryDisplay = Object.entries(results.query)
      .filter(([_, value]) => value && value.trim().length > 0)
      .map(([key, value]) => `<strong>${key}:</strong> ${DOMUtils.escapeHtml(value)}`)
      .join(', ');
    
    // Create results HTML
    let html = `
      <div class="structured-search-results">
        <h3>Structured Search Results</h3>
        <p>Found ${results.count} matches for ${queryDisplay} in ${DOMUtils.escapeHtml(results.domain)}</p>
        
        <div class="results-table-container">
          <table class="search-matches-table">
            <thead>
              <tr>
                <th style="width: 10%;">Line #</th>
                <th style="width: 90%;">Content</th>
              </tr>
            </thead>
            <tbody>
    `;
    
    // Add each match
    results.matches.forEach(match => {
      html += `
        <tr>
          <td>${match.lineNumber}</td>
          <td class="search-match-content">${DOMUtils.escapeHtml(match.content)}</td>
        </tr>
      `;
    });
    
    html += `
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    return html;
  }
}

// Create and export a singleton instance
const structuredSearchManager = new StructuredSearchManager();
export default structuredSearchManager;