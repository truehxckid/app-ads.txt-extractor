/**
 * API Module for App-Ads.txt Extractor
 * Handles all communication with the server
 */

import { showNotification } from '../utils/notification.js';

/**
 * API class for server communication
 */
class ApiService {
  /**
   * Extract developer domains from bundle IDs
   * @param {string[]} bundleIds - Array of bundle IDs
   * @param {string[]} searchTerms - Array of search terms (optional)
   * @param {number} page - Page number for pagination
   * @param {number} pageSize - Number of items per page
   * @param {Object} structuredParams - Structured search parameters (optional)
   * @returns {Promise<Object>} - API response
   */
  async extractDomains(bundleIds, searchTerms = [], page = 1, pageSize = 20, structuredParams = null) {
    try {
      // Increase fetch timeout with AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout
      
      // Add timestamp to avoid caching
      const cacheBuster = Date.now();
      
      // Check if streaming is enabled in localStorage
      const streamingEnabled = localStorage.getItem('streamingEnabled') === 'true';
      
      // Get the current search mode if it exists
      const currentSearchMode = window.currentSearchMode || 'simple';
      
      // Process parameters based on search mode
      let finalSearchTerms = searchTerms;
      let finalStructuredParams = null;
      
      if (currentSearchMode === 'advanced') {
        // For advanced mode: Use both structured params AND search terms
        finalSearchTerms = searchTerms; // Keep search terms in advanced mode
        
        // Get advanced params either directly or from AppState
        const advancedSearchParams = 
          structuredParams || 
          window.AppState?.advancedSearchParams || 
          window.advancedSearchParams || 
          null;
          
        finalStructuredParams = advancedSearchParams;
        console.log('🔍 API: Using ADVANCED search mode with structured params:', finalStructuredParams);
        console.log('🔍 API: Also including search terms in advanced mode:', finalSearchTerms);
      } else {
        // For simple mode: Use search terms, clear structured params
        finalSearchTerms = searchTerms;
        finalStructuredParams = null; // No structured params in simple mode
        console.log('🔍 API: Using SIMPLE search mode with terms:', finalSearchTerms);
      }
      
      // Log what we're sending to the API
      console.log('🔍 API.extractDomains parameters:', {
        bundleIds: bundleIds?.length || 0,
        searchTerms,
        structuredParams: finalStructuredParams,
        advancedParamsFound: !!advancedSearchParams
      });
      
      // FORCE REDIRECT: If streaming is enabled, use the streaming endpoint
      if (streamingEnabled) {
        console.log('🔄 API.extractDomains: REDIRECTING to streaming endpoint - streaming is enabled');
        
        // SPECIAL INDICATOR TO SHOW STREAMING ENDPOINT IS BEING USED
        if (window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('streaming-api-forced', {
            detail: { timestamp: Date.now(), endpoint: '/api/stream/extract-multiple' }
          }));
        }
        
        const response = await fetch(`/api/stream/extract-multiple?_=${cacheBuster}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          },
          body: JSON.stringify({ 
            bundleIds, 
            searchTerms: finalSearchTerms,
            page,
            pageSize,
            structuredParams: finalStructuredParams,
            fullAnalysis: true
          }),
          signal: controller.signal
        });
        
        // Clear timeout as we got a response
        clearTimeout(timeoutId);
        
        // For streaming, we don't return JSON, we return the response object
        // for the StreamProcessor to handle
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Server error: ${response.status} ${response.statusText}`);
        }
        
        // For streaming, we need to return a response object that matches
        // what the ResultsManager expects to avoid "Cannot read properties of undefined (reading 'filter')" errors
        return { 
          response, 
          isStreaming: true,
          // Add these properties to ensure compatibility with the results manager
          results: [],
          totalProcessed: 0,
          successCount: 0,
          errorCount: 0,
          processingTime: 0,
          pagination: {
            currentPage: 1,
            totalPages: 1,
            totalItems: bundleIds.length
          }
        };
      }
      
      // Non-streaming path below
      console.log('📢 API.extractDomains: Using NON-STREAMING endpoint - streaming is disabled');
      
      // SPECIAL INDICATOR TO SHOW THIS ENDPOINT WAS USED
      if (window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('regular-api-called', {
          detail: { timestamp: Date.now(), endpoint: '/api/extract-multiple' }
        }));
      }
      
      const response = await fetch(`/api/extract-multiple?_=${cacheBuster}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        },
        body: JSON.stringify({ 
          bundleIds, 
          searchTerms: finalSearchTerms,
          page,
          pageSize,
          structuredParams: finalStructuredParams,
          fullAnalysis: true
        }),
        signal: controller.signal
      });
      
      // Clear timeout as we got a response
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${response.status} ${response.statusText}`);
      }
      
      // For regular (non-streaming) endpoints, return the JSON response
      return await response.json();
    } catch (err) {
      console.error('API request failed:', err);
      throw err;
    }
  }
  
  /**
   * Export all results for CSV download
   * @param {string[]} bundleIds - Array of bundle IDs
   * @param {string[]} searchTerms - Array of search terms (optional)
   * @param {Object} structuredParams - Structured search parameters (optional)
   * @returns {Promise<Object>} - API response with all results
   */
  async exportCsv(bundleIds, searchTerms = [], structuredParams = null) {
    try {
      // Show loading notification
      showNotification('Preparing CSV export...', 'info');
      
      // Determine search mode based on parameters
      const isAdvancedMode = structuredParams !== null;
      
      // For both modes, include search terms if provided
      // For advanced mode, also include structured params
      const finalSearchTerms = searchTerms;
      const finalStructuredParams = isAdvancedMode ? structuredParams : null;
      
      console.log('🔍 API.exportCsv: Using ' + (isAdvancedMode ? 'ADVANCED' : 'SIMPLE') + ' mode', {
        searchTerms: finalSearchTerms,
        structuredParams: finalStructuredParams
      });
      
      const response = await fetch('/api/export-csv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ 
          bundleIds, 
          searchTerms: finalSearchTerms, 
          structuredParams: finalStructuredParams 
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    } catch (err) {
      console.error('CSV export request failed:', err);
      throw err;
    }
  }
  
  /**
   * Check app-ads.txt for a single domain
   * @param {string} domain - Domain to check
   * @param {string[]} searchTerms - Search terms (optional)
   * @returns {Promise<Object>} - API response
   */
  async checkAppAdsTxt(domain, searchTerms = []) {
    try {
      // Build query string for search terms
      const searchParams = new URLSearchParams({ domain });
      
      if (searchTerms && searchTerms.length > 0) {
        // Add each search term as a separate parameter
        searchTerms.forEach(term => {
          searchParams.append('searchTerms', term);
        });
      }
      
      const response = await fetch(`/api/check-app-ads?${searchParams.toString()}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    } catch (err) {
      console.error('App-ads.txt check failed:', err);
      throw err;
    }
  }
  
  /**
   * Perform structured search on app-ads.txt
   * @param {string} domain - Domain to check
   * @param {Object} query - Structured query (domain, publisherId, relationship, tagId)
   * @returns {Promise<Object>} - API response with structured matches
   */
  async structuredSearch(domain, query) {
    try {
      // Show loading notification
      if (typeof showNotification === 'function') {
        showNotification('Performing structured search...', 'info');
      }
      
      const response = await fetch('/api/structured-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ domain, query })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    } catch (err) {
      console.error('Structured search failed:', err);
      throw err;
    }
  }
  
  /**
   * Get application statistics
   * @returns {Promise<Object>} - Server stats
   */
  async getStats() {
    try {
      const response = await fetch('/api/stats', {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    } catch (err) {
      console.error('Failed to get stats:', err);
      throw err;
    }
  }
  
  /**
   * Handle API errors consistently
   * @param {Error} error - Error object
   * @returns {string} - Formatted error message
   */
  formatErrorMessage(error) {
    // Extract the most user-friendly error message
    if (error.response) {
      return `Server error: ${error.response.status} ${error.response.statusText}`;
    } else if (error.message) {
      return error.message;
    } else {
      return 'Unknown error occurred';
    }
  }
}

// Export as a singleton
const Api = new ApiService();
export default Api;