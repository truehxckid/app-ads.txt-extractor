// api-module.js - Server communication and API functions
window.APIModule = (function() {
  'use strict';
  
  /**
   * Extract developer domains from bundle IDs
   * @param {string[]} bundleIds - Array of bundle IDs
   * @param {string[]} searchTerms - Array of search terms
   * @returns {Promise<Object>} API response
   */
  async function extractDomains(bundleIds, searchTerms = []) {
    try {
      const response = await fetch('/api/extract-multiple', {
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
      console.error('API request failed:', err);
      throw err;
    }
  }
  
  /**
   * Check server health status
   * @returns {Promise<Object>} Health status
   */
  async function checkHealth() {
    try {
      const response = await fetch('/health');
      
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    } catch (err) {
      console.error('Health check failed:', err);
      throw err;
    }
  }
  
  // Public API
  return {
    extractDomains,
    checkHealth
  };
})();