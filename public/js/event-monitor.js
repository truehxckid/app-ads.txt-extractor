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
  
  // Helper function for creating visual indicators
  function addVisualIndicator(text, color, bgColor, duration = 10000) {
    // Remove any existing indicators first
    const existingIndicators = document.querySelectorAll('.event-monitor-indicator');
    existingIndicators.forEach(indicator => {
      indicator.remove();
    });
    
    // Create the indicator
    const indicator = document.createElement('div');
    indicator.className = 'event-monitor-indicator';
    indicator.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: ${bgColor};
      border: 1px solid ${color};
      color: ${color};
      padding: 10px;
      border-radius: 4px;
      z-index: 9999;
      font-size: 14px;
      font-weight: bold;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      opacity: 0;
      transform: translateY(-20px);
      transition: opacity 0.3s, transform 0.3s;
    `;
    indicator.innerHTML = text;
    
    // Add timestamp
    const timestamp = document.createElement('div');
    timestamp.style.cssText = `
      font-size: 10px;
      margin-top: 5px;
      opacity: 0.8;
    `;
    timestamp.textContent = new Date().toLocaleTimeString();
    indicator.appendChild(timestamp);
    
    // Add to page
    document.body.appendChild(indicator);
    
    // Animate in
    setTimeout(() => {
      indicator.style.opacity = '1';
      indicator.style.transform = 'translateY(0)';
    }, 10);
    
    // Auto-remove after specified duration
    setTimeout(() => {
      if (indicator.parentNode) {
        indicator.style.opacity = '0';
        indicator.style.transform = 'translateY(-20px)';
        setTimeout(() => {
          if (indicator.parentNode) {
            indicator.parentNode.removeChild(indicator);
          }
        }, 500);
      }
    }, duration);
    
    return indicator;
  }

  // Add stream processing monitoring
  window.addEventListener('stream-processing-started', function(event) {
    console.log('EVENT MONITOR: Stream processing started:', event.detail);
    addVisualIndicator('🔄 STREAMING ACTIVE', '#28a745', '#dcffe4');
  });
  
  // Add regular API monitoring
  window.addEventListener('regular-api-called', function(event) {
    console.log('EVENT MONITOR: Regular API called:', event.detail);
    // Use more attention-grabbing colors for this warning
    addVisualIndicator('⚠️ REGULAR API CALLED (NOT STREAMING)', '#e36209', '#fff8f1');
  });
  
  // Add forced streaming API monitoring
  window.addEventListener('streaming-api-forced', function(event) {
    console.log('EVENT MONITOR: Streaming API forced:', event.detail);
    addVisualIndicator('✅ STREAMING API FORCED', '#0366d6', '#f1f8ff');
  });
  
  // Add fade-out animation style if it doesn't exist
  if (!document.querySelector('style#streaming-animations')) {
    const fadeStyle = document.createElement('style');
    fadeStyle.id = 'streaming-animations';
    fadeStyle.textContent = `
      @keyframes fade-out {
        0% { opacity: 1; }
        80% { opacity: 1; }
        100% { opacity: 0; }
      }
    `;
    document.head.appendChild(fadeStyle);
  }
  
  // Monitor streaming results rendered
  window.addEventListener('streaming-results-rendered', function(event) {
    console.log('EVENT MONITOR: Streaming results rendered:', event.detail);
    
    // Add a small visual indicator that doesn't interfere too much
    const indicator = document.createElement('div');
    indicator.style.cssText = `
      position: fixed;
      bottom: 10px;
      right: 10px;
      background: rgba(40, 167, 69, 0.2);
      border: 1px solid rgba(40, 167, 69, 0.4);
      padding: 5px 10px;
      border-radius: 4px;
      font-size: 12px;
      color: #28a745;
      z-index: 9999;
      animation: fade-out 1s ease-out forwards;
    `;
    indicator.innerHTML = `✅ Rendered ${event.detail.count} results`;
    document.body.appendChild(indicator);
    
    // Auto-remove after 1 second
    setTimeout(() => {
      if (indicator.parentNode) {
        indicator.parentNode.removeChild(indicator);
      }
    }, 1000);
  });
  
  console.log('EVENT MONITOR: Monitoring initialized successfully with all event listeners');
})();