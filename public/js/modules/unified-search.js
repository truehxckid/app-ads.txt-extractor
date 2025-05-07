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
    const searchQuery = document.getElementById('searchQuery')?.value?.trim() || '';
    
    if (!searchQuery) {
      return null; // No search parameters
    }
    
    // Try to determine if this is a domain or publisher ID
    let params = {};
    
    // Check if query resembles a domain
    if (searchQuery.includes('.')) {
      params.domain = searchQuery;
    } else {
      // If not a domain, assume it's a publisher ID
      params.publisherId = searchQuery;
    }
    
    return {
      mode: 'simple',
      query: searchQuery,
      structuredParams: params
    };
  }
  
  /**
   * Get search parameters from advanced mode
   * @returns {Object} Advanced search parameters
   */
  getAdvancedSearchParams() {
    const domain = document.getElementById('structuredDomain')?.value?.trim() || '';
    const publisherId = document.getElementById('structuredPublisherId')?.value?.trim() || '';
    const relationship = document.getElementById('structuredRelationship')?.value?.trim() || '';
    const tagId = document.getElementById('structuredTagId')?.value?.trim() || '';
    
    // Check if we have at least domain or publisherId
    if (!domain && !publisherId) {
      return null; // No valid search parameters
    }
    
    // Create structured parameters
    const structuredParams = {};
    
    if (domain) structuredParams.domain = domain;
    if (publisherId) structuredParams.publisherId = publisherId;
    if (relationship) structuredParams.relationship = relationship;
    if (tagId) structuredParams.tagId = tagId;
    
    return {
      mode: 'advanced',
      structuredParams
    };
  }
  
  /**
   * Set search parameters in the UI
   * @param {Object} params - Search parameters
   */
  setSearchParams(params) {
    if (!params) return;
    
    if (params.mode === 'simple' && params.query) {
      // Set simple mode parameters
      this.activeMode = 'simple';
      const searchQueryInput = document.getElementById('searchQuery');
      if (searchQueryInput) {
        searchQueryInput.value = params.query;
      }
    } else if (params.structuredParams) {
      // Set advanced mode parameters
      this.activeMode = 'advanced';
      
      const { domain, publisherId, relationship, tagId } = params.structuredParams;
      
      // Set form values
      if (domain && document.getElementById('structuredDomain')) {
        document.getElementById('structuredDomain').value = domain;
      }
      
      if (publisherId && document.getElementById('structuredPublisherId')) {
        document.getElementById('structuredPublisherId').value = publisherId;
      }
      
      if (relationship && document.getElementById('structuredRelationship')) {
        document.getElementById('structuredRelationship').value = relationship;
      }
      
      if (tagId && document.getElementById('structuredTagId')) {
        document.getElementById('structuredTagId').value = tagId;
      }
    }
    
    // Update UI to reflect current mode
    this.updateModeUI();
  }
  
  /**
   * Reset search form
   */
  resetSearch() {
    // Reset simple mode
    const searchQueryInput = document.getElementById('searchQuery');
    if (searchQueryInput) {
      searchQueryInput.value = '';
    }
    
    // Reset advanced mode
    const advancedFields = [
      'structuredDomain',
      'structuredPublisherId',
      'structuredRelationship',
      'structuredTagId'
    ];
    
    advancedFields.forEach(fieldId => {
      const field = document.getElementById(fieldId);
      if (field) {
        if (field.tagName === 'SELECT') {
          field.selectedIndex = 0;
        } else {
          field.value = '';
        }
      }
    });
    
    // Default to simple mode
    this.activeMode = 'simple';
    this.updateModeUI();
  }
}

// Create and export singleton instance
const unifiedSearch = new UnifiedSearchManager();
export default unifiedSearch;