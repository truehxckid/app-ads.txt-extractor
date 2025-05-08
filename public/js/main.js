/**
 * Main entry point for App-Ads.txt Extractor
 */

import AppState from './modules/app-state.js';
import EventHandler from './modules/event-handler.js';
import ThemeManager from './utils/theme.js';
import { checkBrowserSupport } from './utils/browser-compat.js';
import DOMUtils from './modules/dom-utils.js';
import StreamingIntegration from './modules/streaming-integration.js';
import StreamProgressUI from './modules/streaming/StreamProgressUI.js';
import UnifiedSearch from './modules/unified-search.js';
import UnifiedExporter from './modules/unified-exporter.js'; // Preload the unified exporter

/**
 * Initialize the application
 */
function initApp() {
  try {
    // Remove any existing debug info panels
    const debugInfo = document.getElementById('debugInfo');
    if (debugInfo) {
      debugInfo.remove();
    }
    // Check browser compatibility
    const compatibilityIssues = checkBrowserSupport();
    if (compatibilityIssues.length > 0) {
      // Browser compatibility issues detected
    }
    
    // Initialize theme
    ThemeManager.initialize();
    
    // Initialize app state
    AppState.initialize();
    
    // Initialize event handlers
    EventHandler.initialize();
    
    // Initialize streaming integration
    StreamingIntegration.initialize();
    
    // Initialize UI components
    UnifiedSearch.initialize();
    
    // Initialize progress UI
    StreamProgressUI.initialize();
    
    // Add global error handling
    window.addEventListener('error', EventHandler.handleGlobalError);
    window.addEventListener('unhandledrejection', EventHandler.handleUnhandledRejection);
    
    // Initial form setup
    setupInitialForm();
  } catch (err) {
    // Failed to initialize application
    DOMUtils.showErrorBoundary('Failed to initialize application');
  }
}

/**
 * Setup initial form state
 */
function setupInitialForm() {
  // Initialize the advanced search form if needed
  const advancedSearchContainer = document.getElementById('advancedSearchContainer');
  if (advancedSearchContainer && advancedSearchContainer.children.length === 0) {
    // UnifiedSearch is already imported at the top, no need for a dynamic import
    UnifiedSearch.addStructuredSearchForm();
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Export minimal app utilities
window.AppUtilities = {
  resetApp: () => {
    AppState.reset();
    window.location.reload();
  },
  // Export for debugging and testing
  exportCSV: (bundleIds, params, useServer = false) => {
    return UnifiedExporter.exportToCSV(
      bundleIds || DOMUtils.getTextareaLines('bundleIds'),
      params || { 
        mode: 'advanced', 
        structuredParams: AppState.advancedSearchParams 
      },
      { useServer: useServer }
    );
  }
};