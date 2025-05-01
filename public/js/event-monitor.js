/**
 * Event Monitoring Script
 * Tracks all clicks and form submissions for debugging
 */

(function() {
  console.log('EVENT MONITOR: Initializing event monitoring');
  
  // Track all clicks
  document.addEventListener('click', function(event) {
    const target = event.target;
    console.log('EVENT MONITOR: Click detected on:', target.tagName, 
      target.id ? `#${target.id}` : '',
      target.className ? `.${target.className.replace(/\s+/g, '.')}` : '',
      target.textContent ? `"${target.textContent.substring(0, 20).trim()}${target.textContent.length > 20 ? '...' : ''}"` : ''
    );
    
    // Check if it's the extract button
    if (target.id === 'extractBtn' || (target.closest && target.closest('#extractBtn'))) {
      console.log('EVENT MONITOR: Extract button clicked!');
      
      // Log bundle IDs
      const bundleIdsElement = document.getElementById('bundleIds');
      if (bundleIdsElement) {
        const text = bundleIdsElement.value;
        const lines = text.split('\n').filter(line => line.trim().length > 0);
        console.log('EVENT MONITOR: Bundle IDs count:', lines.length);
        console.log('EVENT MONITOR: First few bundle IDs:', lines.slice(0, 3));
      }
      
      // Log streaming toggle state
      const streamingToggle = document.getElementById('streamingToggle');
      if (streamingToggle) {
        console.log('EVENT MONITOR: Streaming enabled:', streamingToggle.checked);
      }
    }
  }, true);
  
  // Track form submissions
  document.addEventListener('submit', function(event) {
    const form = event.target;
    console.log('EVENT MONITOR: Form submission detected:', 
      form.id ? `#${form.id}` : 'unknown form',
      'action:', form.action
    );
    
    // If it's the extract form
    if (form.id === 'extractForm') {
      console.log('EVENT MONITOR: Extract form submitted!');
      
      // Get input contents
      const formData = new FormData(form);
      for (const [key, value] of formData.entries()) {
        console.log(`EVENT MONITOR: Form field ${key}:`, typeof value === 'string' ? value : '(file or object)');
      }
    }
  }, true);
  
  // Create a MutationObserver to watch for DOM changes
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      // Look for new processing indicators
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i];
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList && (
                node.classList.contains('processing-indicator') || 
                node.id === 'loadingIndicator' || 
                node.id === 'progressIndicator'
            )) {
              console.log('EVENT MONITOR: Processing indicator appeared:', node.id || node.className);
            }
          }
        }
      }
    });
  });
  
  // Start observing
  observer.observe(document.body, { childList: true, subtree: true });
  
  // Also monitor fetch/XHR requests
  const originalFetch = window.fetch;
  window.fetch = function() {
    console.log('EVENT MONITOR: Fetch request initiated to:', arguments[0]);
    console.log('EVENT MONITOR: Fetch options:', arguments[1]);
    
    return originalFetch.apply(this, arguments)
      .then(response => {
        console.log('EVENT MONITOR: Fetch response received:', response.status, response.statusText);
        return response;
      })
      .catch(error => {
        console.error('EVENT MONITOR: Fetch error:', error);
        throw error;
      });
  };
  
  // Modify the AppState to monitor processing state
  if (window.AppState) {
    const originalSetProcessing = window.AppState.setProcessing;
    window.AppState.setProcessing = function(isProcessing) {
      console.log('EVENT MONITOR: AppState.setProcessing called with:', isProcessing);
      return originalSetProcessing.call(window.AppState, isProcessing);
    };
  }
  
  // Add stream processing monitoring
  window.addEventListener('stream-processing-started', function(event) {
    console.log('EVENT MONITOR: Stream processing started:', event.detail);
    
    // Add a visual indicator on the page
    const indicator = document.createElement('div');
    indicator.style.cssText = 'position: fixed; top: 10px; right: 10px; background: #dcffe4; border: 1px solid #28a745; color: #28a745; padding: 10px; border-radius: 4px; z-index: 9999; font-size: 14px; font-weight: bold;';
    indicator.innerHTML = '🔄 STREAMING ACTIVE';
    document.body.appendChild(indicator);
    
    // Remove after 3 seconds
    setTimeout(() => {
      if (indicator.parentNode) {
        indicator.parentNode.removeChild(indicator);
      }
    }, 3000);
  });
  
  // Add regular API monitoring
  window.addEventListener('regular-api-called', function(event) {
    console.log('EVENT MONITOR: Regular API called:', event.detail);
    
    // Add a visual indicator on the page
    const indicator = document.createElement('div');
    indicator.style.cssText = 'position: fixed; top: 10px; right: 10px; background: #fff2dc; border: 1px solid #f0ad4e; color: #f0ad4e; padding: 10px; border-radius: 4px; z-index: 9999; font-size: 14px; font-weight: bold;';
    indicator.innerHTML = '⚠️ REGULAR API CALLED (NOT STREAMING)';
    document.body.appendChild(indicator);
    
    // Remove after 3 seconds
    setTimeout(() => {
      if (indicator.parentNode) {
        indicator.parentNode.removeChild(indicator);
      }
    }, 3000);
  });
  
  console.log('EVENT MONITOR: Monitoring initialized successfully with all event listeners');
})();