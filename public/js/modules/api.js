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
   * @returns {Promise<Object>} - API response
   */
  async extractDomains(bundleIds, searchTerms = [], page = 1, pageSize = 20) {
    try {
      // Increase fetch timeout with AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout
      
      // Add timestamp to avoid caching
      const cacheBuster = Date.now();
      
      console.log('📢 API.extractDomains: Using NON-STREAMING endpoint - if you see this when streaming is enabled, there is a bug!');
      
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
          searchTerms,
          page,
          pageSize,
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
   * @returns {Promise<Object>} - API response with all results
   */
  async exportCsv(bundleIds, searchTerms = []) {
    try {
      // Show loading notification
      showNotification('Preparing CSV export...', 'info');
      
      const response = await fetch('/api/export-csv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ bundleIds, searchTerms })
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