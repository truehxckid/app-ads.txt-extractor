/**
 * Unified Search Module
 * Handles structured search for app-ads.txt files
 */

import DOMUtils from './dom-utils.js';
import { showNotification } from '../utils/notification.js';
import Sanitizer from '../utils/sanitizer.js';

/**
 * Unified Search Manager Class
 */
class UnifiedSearchManager {
  constructor() {
    this.handlersAdded = false;
    
    // Cache DOM references
    this.domCache = {
      structuredSearchContainer: null,
      advancedSearchContainer: null,
      addButton: null
    };
  }
  
  /**
   * Get cached DOM element or query and cache it
   * @param {string} key - Cache key
   * @param {string|function} selector - Element selector or function to get element
   * @param {boolean} queryAll - Whether to use querySelectorAll instead of single element
   * @returns {HTMLElement|NodeList} - Cached element
   */
  _getElement(key, selector, queryAll = false) {
    // Return cached element if available
    if (this.domCache[key]) {
      return this.domCache[key];
    }
    
    // Query element if not cached
    if (typeof selector === 'string') {
      this.domCache[key] = queryAll 
        ? document.querySelectorAll(selector)
        : document.getElementById(selector) || document.querySelector(selector);
    } else if (typeof selector === 'function') {
      this.domCache[key] = selector();
    }
    
    return this.domCache[key];
  }
  
  /**
   * Initialize unified search functionality
   */
  initialize() {
    console.log('🔍 Initializing UnifiedSearchManager');
    
    if (!this.handlersAdded) {
      // Initialize structured search container if empty
      const structuredSearchContainer = this._getElement('structuredSearchContainer', 'structuredSearchContainer');
      if (structuredSearchContainer && structuredSearchContainer.children.length === 0) {
        this._addStructuredSearchFormToUI(structuredSearchContainer);
        this._updateStructuredSearchFormsUI();
      }
      
      // Show advanced search container
      const advancedContainer = this._getElement('advancedSearchContainer', 'advancedSearchContainer');
      if (advancedContainer) {
        advancedContainer.style.display = 'block';
      }
      
      this.handlersAdded = true;
    }
  }
  
  /**
   * Get the current search parameters
   * @returns {Object} Search parameters object
   */
  getSearchParams() {
    return this._getStructuredSearchParams();
  }
  
  /**
   * Get structured search parameters
   * @returns {Object} Structured search parameters
   * @private
   */
  _getStructuredSearchParams() {
    // Get all structured search forms - this is a dynamic query so we don't cache
    const forms = this._getElement('searchForms', 
      () => document.querySelectorAll('#structuredSearchContainer .structured-search-form'),
      false
    );
    
    // Clear this cache entry so it will be refreshed next time
    this.domCache['searchForms'] = null;
    
    if (!forms || !forms.length) {
      return null; // No search forms found
    }
    
    // Array to hold all structured parameters
    const structuredParamsArray = [];
    
    // Process each form
    forms.forEach((form, index) => {
      // Cache form field elements within each form
      const formFields = form._cachedFields = form._cachedFields || {
        domain: form.querySelector('.structured-domain'),
        publisherId: form.querySelector('.structured-publisher-id'),
        relationship: form.querySelector('.structured-relationship'),
        tagId: form.querySelector('.structured-tag-id')
      };
      
      const domain = formFields.domain?.value?.trim() || '';
      const publisherId = formFields.publisherId?.value?.trim() || '';
      const relationship = formFields.relationship?.value?.trim() || '';
      const tagId = formFields.tagId?.value?.trim() || '';
      
      // Skip if both domain and publisherId are empty
      if (!domain && !publisherId) {
        return;
      }
      
      // Create structured parameters for this form
      const params = {};
      
      if (domain) params.domain = domain;
      
      // Handle publisher ID - could contain multiple IDs separated by spaces, commas, or "+"
      if (publisherId) {
        // Check if there are multiple publisher IDs separated by commas or spaces
        if (publisherId.includes(',') || publisherId.includes(' ') && !publisherId.includes('+')) {
          // Convert to "+" format for backend processing
          const cleanedIds = publisherId
            .split(/[\s,]+/)         // Split by spaces or commas
            .filter(Boolean)         // Remove empty items
            .join('+');              // Join with "+" for backend
          
          params.publisherId = cleanedIds;
          console.log('UnifiedSearch: Multiple publisher IDs detected:', cleanedIds);
        } else {
          // Use as-is if it already contains "+" or is a single ID
          params.publisherId = publisherId;
        }
      }
      
      if (relationship) params.relationship = relationship;
      if (tagId) params.tagId = tagId;
      
      // Add to array if there are valid parameters
      if (Object.keys(params).length > 0) {
        structuredParamsArray.push(params);
      }
    });
    
    // If no valid parameters, return null
    if (structuredParamsArray.length === 0) {
      return null;
    }
    
    // Debug log the structured parameters
    console.log('UnifiedSearch: Advanced search parameters:', structuredParamsArray);
    
    return {
      mode: 'advanced',
      structuredParams: structuredParamsArray, // Always return array even with one item
      isMultiple: structuredParamsArray.length > 1
    };
  }
  
  /**
   * Set search parameters in the UI
   * @param {Object} params - Search parameters
   */
  setSearchParams(params) {
    if (!params) return;
    
    // Handle structured parameters
    if (params.structuredParams) {
      // Clear existing structured search forms
      const container = this._getElement('structuredSearchContainer', 'structuredSearchContainer');
      if (container) {
        // Clear using safe DOM manipulation
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
        
        // Handle array of structured params
        if (Array.isArray(params.structuredParams)) {
          params.structuredParams.forEach((structuredParam, index) => {
            this._addStructuredSearchFormToUI(container, structuredParam, index);
          });
        } 
        // Handle single structured param object
        else {
          this._addStructuredSearchFormToUI(container, params.structuredParams, 0);
        }
        
        // Update remove buttons visibility
        this._updateStructuredSearchFormsUI();
      }
    } 
    // For backward compatibility - handle queries array if present
    else if (params.queries && Array.isArray(params.queries)) {
      const container = this._getElement('structuredSearchContainer', 'structuredSearchContainer');
      if (container) {
        // Clear using safe DOM manipulation
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
        
        // Convert each term to a domain search
        params.queries.slice(0, 5).forEach((query, index) => {
          const advancedParam = {
            domain: query.trim() // Use the search term as a domain search
          };
          this._addStructuredSearchFormToUI(container, advancedParam, index);
        });
        
        // Update remove buttons visibility
        this._updateStructuredSearchFormsUI();
      }
    }
    
    // Show advanced container
    const advancedContainer = this._getElement('advancedSearchContainer', 'advancedSearchContainer');
    if (advancedContainer) {
      advancedContainer.style.display = 'block';
    }
  }
  
  /**
   * Add a structured search form to the UI
   * @param {HTMLElement} container - Container element
   * @param {Object} params - Structured parameters
   * @param {number} index - Form index
   * @private
   */
  _addStructuredSearchFormToUI(container, params = {}, index = 0) {
    const { domain, publisherId, relationship, tagId } = params;
    
    // Create form container using Sanitizer
    const form = Sanitizer.createSafeElement('div', {
      class: 'structured-search-form',
      'data-index': String(index)
    });
    
    // Create domain field
    const domainField = document.createElement('div');
    domainField.className = 'structured-search-field';
    
    const domainLabel = document.createElement('label');
    domainLabel.setAttribute('for', `structuredDomain_${index}`);
    domainLabel.textContent = 'Domain:';
    
    const domainInput = document.createElement('input');
    domainInput.type = 'text';
    domainInput.id = `structuredDomain_${index}`;
    domainInput.className = 'structured-domain';
    domainInput.placeholder = 'e.g., appnexus.com';
    if (domain) {
      domainInput.value = domain;
    }
    
    domainField.appendChild(domainLabel);
    domainField.appendChild(domainInput);
    
    // Create publisher ID field
    const publisherIdField = document.createElement('div');
    publisherIdField.className = 'structured-search-field';
    
    const publisherIdLabel = document.createElement('label');
    publisherIdLabel.setAttribute('for', `structuredPublisherId_${index}`);
    publisherIdLabel.textContent = 'Publisher ID:';
    
    const publisherIdInput = document.createElement('input');
    publisherIdInput.type = 'text';
    publisherIdInput.id = `structuredPublisherId_${index}`;
    publisherIdInput.className = 'structured-publisher-id';
    publisherIdInput.placeholder = 'e.g., 12447 (searches for exact ID)';
    if (publisherId) {
      publisherIdInput.value = publisherId;
    }
    
    publisherIdField.appendChild(publisherIdLabel);
    publisherIdField.appendChild(publisherIdInput);
    
    // Create relationship field
    const relationshipField = document.createElement('div');
    relationshipField.className = 'structured-search-field';
    
    const relationshipLabel = document.createElement('label');
    relationshipLabel.setAttribute('for', `structuredRelationship_${index}`);
    relationshipLabel.textContent = 'Relationship:';
    
    const relationshipSelect = document.createElement('select');
    relationshipSelect.id = `structuredRelationship_${index}`;
    relationshipSelect.className = 'structured-relationship';
    
    const anyOption = document.createElement('option');
    anyOption.value = '';
    anyOption.textContent = 'Any';
    
    const directOption = document.createElement('option');
    directOption.value = 'DIRECT';
    directOption.textContent = 'DIRECT';
    
    const resellerOption = document.createElement('option');
    resellerOption.value = 'RESELLER';
    resellerOption.textContent = 'RESELLER';
    
    relationshipSelect.appendChild(anyOption);
    relationshipSelect.appendChild(directOption);
    relationshipSelect.appendChild(resellerOption);
    
    if (relationship) {
      relationshipSelect.value = relationship;
    }
    
    relationshipField.appendChild(relationshipLabel);
    relationshipField.appendChild(relationshipSelect);
    
    // Create tag ID field
    const tagIdField = document.createElement('div');
    tagIdField.className = 'structured-search-field';
    
    const tagIdLabel = document.createElement('label');
    tagIdLabel.setAttribute('for', `structuredTagId_${index}`);
    tagIdLabel.textContent = 'Tag ID (Optional):';
    
    const tagIdInput = document.createElement('input');
    tagIdInput.type = 'text';
    tagIdInput.id = `structuredTagId_${index}`;
    tagIdInput.className = 'structured-tag-id';
    tagIdInput.placeholder = 'e.g., abc123';
    if (tagId) {
      tagIdInput.value = tagId;
    }
    
    tagIdField.appendChild(tagIdLabel);
    tagIdField.appendChild(tagIdInput);
    
    // Create remove button
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'structured-search-actions';
    
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'remove-structured-search-btn';
    removeButton.dataset.action = 'remove-structured-search';
    removeButton.dataset.index = index;
    removeButton.setAttribute('aria-label', 'Remove this search criteria');
    removeButton.textContent = '−';
    
    actionsDiv.appendChild(removeButton);
    
    // Append all fields to form
    form.appendChild(domainField);
    form.appendChild(publisherIdField);
    form.appendChild(relationshipField);
    form.appendChild(tagIdField);
    form.appendChild(actionsDiv);
    
    // Append form to container
    container.appendChild(form);
  }
  
  /**
   * Update the UI for structured search forms
   * @private
   */
  _updateStructuredSearchFormsUI() {
    const forms = this._getElement('searchForms', 
      () => document.querySelectorAll('#structuredSearchContainer .structured-search-form'),
      false
    );
    
    // Clear this cache entry so it will be refreshed next time
    this.domCache['searchForms'] = null;
    
    if (!forms) return;
    
    // Show/hide remove buttons based on number of forms
    forms.forEach((form, index) => {
      // Cache the remove button reference within the form
      form._removeButton = form._removeButton || form.querySelector('.remove-structured-search-btn');
      
      if (form._removeButton) {
        // Only show remove button if there's more than one form
        form._removeButton.style.display = forms.length > 1 ? 'block' : 'none';
      }
    });
  }
  
  /**
   * Reset search form
   */
  resetSearch() {
    // Reset advanced mode only
    const structuredSearchContainer = this._getElement('structuredSearchContainer', 'structuredSearchContainer');
    if (structuredSearchContainer) {
      // Clear using safe DOM manipulation
      while (structuredSearchContainer.firstChild) {
        structuredSearchContainer.removeChild(structuredSearchContainer.firstChild);
      }
      // Add one empty structured search form
      this._addStructuredSearchFormToUI(structuredSearchContainer);
      this._updateStructuredSearchFormsUI();
      
      // Clear cached form elements since DOM was modified
      Object.keys(this.domCache).forEach(key => {
        if (key.startsWith('form_') || key === 'searchForms') {
          this.domCache[key] = null;
        }
      });
    }
  }
  
  /**
   * Add a new empty structured search form
   * Maximum of 5 forms allowed
   */
  addStructuredSearchForm() {
    const container = this._getElement('structuredSearchContainer', 'structuredSearchContainer');
    if (container) {
      // Limit to maximum 5 structured search forms
      if (container.children.length >= 5) {
        // Show notification if available
        if (typeof showNotification === 'function') {
          showNotification('Maximum of 5 advanced search forms allowed', 'info');
        } else {
          console.info('Maximum of 5 advanced search forms allowed');
        }
        return;
      }
      
      const index = container.children.length;
      this._addStructuredSearchFormToUI(container, {}, index);
      this._updateStructuredSearchFormsUI();
      
      // Disable add button if limit reached
      if (container.children.length >= 5) {
        const addButton = this._getElement('addButton', '[data-action="add-structured-search"]');
        if (addButton) {
          addButton.disabled = true;
          addButton.classList.add('disabled');
          addButton.setAttribute('title', 'Maximum of 5 advanced search forms allowed');
        }
      }
    }
  }
  
  /**
   * Remove a structured search form
   * @param {HTMLElement} button - Remove button
   */
  removeStructuredSearchForm(button) {
    const form = button.closest('.structured-search-form');
    if (form) {
      form.remove();
      
      // Clear any cached references to this form
      const formId = form.dataset.index;
      if (formId && this.domCache[`form_${formId}`]) {
        this.domCache[`form_${formId}`] = null;
      }
      
      // Ensure at least one form exists
      const container = this._getElement('structuredSearchContainer', 'structuredSearchContainer');
      if (container && container.children.length === 0) {
        this.addStructuredSearchForm();
      }
      
      // Update forms UI
      this._updateStructuredSearchFormsUI();
      
      // Re-enable add button if below the limit
      if (container && container.children.length < 5) {
        const addButton = this._getElement('addButton', '[data-action="add-structured-search"]');
        if (addButton) {
          addButton.disabled = false;
          addButton.classList.remove('disabled');
          addButton.setAttribute('title', 'Add another search criteria');
        }
      }
      
      // Clear the forms cache to ensure we get fresh forms on next query
      this.domCache['searchForms'] = null;
    }
  }
}

// Create and export singleton instance
const unifiedSearch = new UnifiedSearchManager();
export default unifiedSearch;