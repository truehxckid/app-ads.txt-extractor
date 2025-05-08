/**
 * Event Monitoring Script (minimized)
 */

(function() {
  // Only monitor essential events - fetch requests and API responses
  
  // Monitor fetch/XHR requests - keep for API debugging
  const originalFetch = window.fetch;
  window.fetch = function() {
    // Only log important API calls for debugging
    const url = arguments[0];
    if (typeof url === 'string' && (url.includes('/api/') || url.includes('export-csv'))) {
      // Fetch request initiated
      
      return originalFetch.apply(this, arguments)
        .then(response => {
          // Fetch response received
          return response;
        })
        .catch(error => {
          // Fetch error occurred
          throw error;
        });
    }
    
    return originalFetch.apply(this, arguments);
  };
})();