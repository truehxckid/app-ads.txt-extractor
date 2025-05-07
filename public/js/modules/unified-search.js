/**
 * Unified Search Module
 * Handles both simple and advanced structured search for app-ads.txt files
 */

import DOMUtils from './dom-utils.js';
import { showNotification } from '../utils/notification.js';

/**
 * Unified Search Manager Class
 */
class UnifiedSearchManager {
  constructor() {
    this.activeMode = 'simple'; // Default mode
    this.handlersAdded = false;
  }
  
  /**
   * Initialize unified search functionality
   */
  initialize() {
    console.log('🔍 Initializing UnifiedSearchManager');
    
    // Add event listeners for search mode toggle buttons
    if (!this.handlersAdded) {
      const modeButtons = document.querySelectorAll('[data-action="switch-search-mode"]');
      if (modeButtons.length) {
        modeButtons.forEach(button => {
          button.addEventListener('click', this.handleModeSwitch.bind(this));
        });
      }
      
      // Initialize search terms container if empty
      const searchTermsContainer = document.getElementById('searchTermsContainer');
      if (searchTermsContainer && searchTermsContainer.children.length === 0) {
        this.addSearchTerm();
      }
      
      // Initialize structured search container if empty
      const structuredSearchContainer = document.getElementById('structuredSearchContainer');
      if (structuredSearchContainer && structuredSearchContainer.children.length === 0) {
        this._addStructuredSearchFormToUI(structuredSearchContainer);
        this._updateStructuredSearchFormsUI();
      }
      
      this.handlersAdded = true;
    }
  }
  
  /**
   * Handle search mode switch
   * @param {Event} event - Click event
   */
  handleModeSwitch(event) {
    const button = event.target;
    const mode = button.dataset.mode;
    
    if (!mode || mode === this.activeMode) return;
    
    // Update active mode
    this.activeMode = mode;
    
    // Update UI
    this.updateModeUI();
  }
  
  /**
   * Update UI based on active mode
   */
  updateModeUI() {
    // Update mode toggle buttons
    const modeButtons = document.querySelectorAll('[data-action="switch-search-mode"]');
    modeButtons.forEach(button => {
      const isActive = button.dataset.mode === this.activeMode;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', isActive);
    });
    
    // Update visible container
    const simpleContainer = document.getElementById('simpleSearchContainer');
    const advancedContainer = document.getElementById('advancedSearchContainer');
    
    if (simpleContainer) {
      simpleContainer.style.display = this.activeMode === 'simple' ? 'block' : 'none';
    }
    
    if (advancedContainer) {
      advancedContainer.style.display = this.activeMode === 'advanced' ? 'block' : 'none';
    }
  }
  
  /**
   * Get the current search parameters based on active mode
   * @returns {Object} Search parameters object
   */
  getSearchParams() {
    // Get parameters based on active mode
    if (this.activeMode === 'simple') {
      return this.getSimpleSearchParams();
    } else {
      return this.getAdvancedSearchParams();
    }
  }
  
  /**
   * Get search parameters from simple mode
   * @returns {Object} Simple search parameters
   */
  getSimpleSearchParams() {
    // Get all search terms from the search terms container
    const inputValues = Array.from(document.querySelectorAll('.search-term-input'))
      .map(input => input.value.trim())
      .filter(Boolean);
    
    if (!inputValues.length) {
      return null; // No search parameters
    }
    
    // Use each input value as an exact search term without splitting
    const searchTerms = inputValues;
    
    // Create array of structured params for each term
    const structuredParams = searchTerms.map(term => {
      const params = {};
      
      // Treat the entire term as one entity
      params.exactMatch = term;
      
      return params;
    });
    
    return {
      mode: 'simple',
      query: searchTerms.join(','), // Join for backward compatibility
      queries: searchTerms, // Array of all search terms
      structuredParams: structuredParams
    };
  }
  
  /**
   * Get search parameters from advanced mode
   * @returns {Object} Advanced search parameters
   */
  getAdvancedSearchParams() {
    // Get all structured search forms
    const forms = document.querySelectorAll('#structuredSearchContainer .structured-search-form');
    
    if (!forms.length) {
      return null; // No search forms found
    }
    
    // Array to hold all structured parameters
    const structuredParamsArray = [];
    
    // Process each form
    forms.forEach((form, index) => {
      const domain = form.querySelector(`.structured-domain`)?.value?.trim() || '';
      const publisherId = form.querySelector(`.structured-publisher-id`)?.value?.trim() || '';
      const relationship = form.querySelector(`.structured-relationship`)?.value?.trim() || '';
      const tagId = form.querySelector(`.structured-tag-id`)?.value?.trim() || '';
      
      // Skip if both domain and publisherId are empty
      if (!domain && !publisherId) {
        return;
      }
      
      // Create structured parameters for this form
      const params = {};
      
      if (domain) params.domain = domain;
      if (publisherId) params.publisherId = publisherId;
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
    
    return {
      mode: 'advanced',
      structuredParams: structuredParamsArray.length === 1 ? structuredParamsArray[0] : structuredParamsArray,
      isMultiple: structuredParamsArray.length > 1
    };
  }
  
  /**
   * Set search parameters in the UI
   * @param {Object} params - Search parameters
   */
  setSearchParams(params) {
    if (!params) return;
    
    if (params.mode === 'simple') {
      // Set simple mode parameters
      this.activeMode = 'simple';
      
      // Handle multiple search terms
      if (params.queries && Array.isArray(params.queries)) {
        // Clear existing search terms
        const container = document.getElementById('searchTermsContainer');
        if (container) {
          container.innerHTML = '';
          
          // Add each search term
          params.queries.forEach(query => {
            this._addSearchTermToUI(container, query);
          });
        }
      } 
      // Handle backward compatibility with single query
      else if (params.query) {
        const container = document.getElementById('searchTermsContainer');
        if (container) {
          container.innerHTML = '';
          this._addSearchTermToUI(container, params.query);
        }
      }
    } 
    else if (params.structuredParams) {
      // Set advanced mode parameters
      this.activeMode = 'advanced';
      
      // Clear existing structured search forms
      const container = document.getElementById('structuredSearchContainer');
      if (container) {
        container.innerHTML = '';
        
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
    
    // Update UI to reflect current mode
    this.updateModeUI();
  }
  
  /**
   * Add a search term to the UI
   * @param {HTMLElement} container - Container element
   * @param {string} value - Search term value
   * @private
   */
  _addSearchTermToUI(container, value = '') {
    // Use template if available
    const template = document.getElementById('search-term-template');
    if (template) {
      const clone = document.importNode(template.content, true);
      const input = clone.querySelector('.search-term-input');
      if (input && value) {
        input.value = value;
      }
      container.appendChild(clone);
      return;
    }
    
    // Fallback: create elements manually
    const row = document.createElement('div');
    row.className = 'search-term-row';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'search-term-input';
    input.placeholder = 'Enter keyword or domain to search for';
    input.setAttribute('aria-label', 'Search term');
    if (value) {
      input.value = value;
    }
    
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'remove-search-term';
    button.dataset.action = 'remove-term';
    button.setAttribute('aria-label', 'Remove search term');
    button.textContent = '−';
    
    row.appendChild(input);
    row.appendChild(button);
    container.appendChild(row);
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
    
    // Create form container
    const form = document.createElement('div');
    form.className = 'structured-search-form';
    form.dataset.index = index;
    
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
    publisherIdInput.placeholder = 'e.g., 12447';
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
    removeButton.textContent = '− Remove';
    
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
    const forms = document.querySelectorAll('#structuredSearchContainer .structured-search-form');
    
    // Show/hide remove buttons based on number of forms
    forms.forEach((form, index) => {
      const removeButton = form.querySelector('.remove-structured-search-btn');
      if (removeButton) {
        // Only show remove button if there's more than one form
        removeButton.style.display = forms.length > 1 ? 'block' : 'none';
      }
    });
  }
  
  /**
   * Reset search form
   */
  resetSearch() {
    // Reset simple mode
    const searchTermsContainer = document.getElementById('searchTermsContainer');
    if (searchTermsContainer) {
      searchTermsContainer.innerHTML = '';
      // Add one empty search term
      this._addSearchTermToUI(searchTermsContainer);
    }
    
    // Reset advanced mode
    const structuredSearchContainer = document.getElementById('structuredSearchContainer');
    if (structuredSearchContainer) {
      structuredSearchContainer.innerHTML = '';
      // Add one empty structured search form
      this._addStructuredSearchFormToUI(structuredSearchContainer);
      this._updateStructuredSearchFormsUI();
    }
    
    // Default to simple mode
    this.activeMode = 'simple';
    this.updateModeUI();
  }
  
  /**
   * Add a new empty search term
   */
  addSearchTerm() {
    const container = document.getElementById('searchTermsContainer');
    if (container) {
      this._addSearchTermToUI(container);
    }
  }
  
  /**
   * Remove a search term
   * @param {HTMLElement} button - Remove button
   */
  removeSearchTerm(button) {
    const row = button.closest('.search-term-row');
    if (row) {
      row.remove();
      
      // Ensure at least one search term exists
      const container = document.getElementById('searchTermsContainer');
      if (container && container.children.length === 0) {
        this.addSearchTerm();
      }
    }
  }
  
  /**
   * Add a new empty structured search form
   */
  addStructuredSearchForm() {
    const container = document.getElementById('structuredSearchContainer');
    if (container) {
      const index = container.children.length;
      this._addStructuredSearchFormToUI(container, {}, index);
      this._updateStructuredSearchFormsUI();
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
      
      // Ensure at least one form exists
      const container = document.getElementById('structuredSearchContainer');
      if (container && container.children.length === 0) {
        this.addStructuredSearchForm();
      }
      
      // Update forms UI
      this._updateStructuredSearchFormsUI();
    }
  }
}

// Create and export singleton instance
const unifiedSearch = new UnifiedSearchManager();
export default unifiedSearch;