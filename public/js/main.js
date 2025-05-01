/**
 * Main entry point for App-Ads.txt Extractor
 * Initializes the application and connects modules
 */

import AppState from './modules/app-state.js';
import EventHandler from './modules/event-handler.js';
import ThemeManager from './utils/theme.js';
import { checkBrowserSupport } from './utils/browser-compat.js';
import DOMUtils from './modules/dom-utils.js';
import StreamingIntegration from './modules/streaming-integration.js';
import VisualIndicators from './modules/visual-indicators.js';

/**
 * Initialize the application
 */
function initApp() {
  try {
    // Check browser compatibility
    const compatibilityIssues = checkBrowserSupport();
    if (compatibilityIssues.length > 0) {
      console.warn('Browser compatibility issues:', compatibilityIssues);
    }
    
    // Initialize theme
    ThemeManager.initialize();
    
    // Initialize app state
    AppState.initialize();
    
    // Initialize event handlers
    EventHandler.initialize();
    
    // Initialize streaming integration
    StreamingIntegration.initialize();
    
    // Add global error handling
    window.addEventListener('error', EventHandler.handleGlobalError);
    window.addEventListener('unhandledrejection', EventHandler.handleUnhandledRejection);
    
    // Initial form setup
    setupInitialForm();
    
    console.info('App initialized successfully');
    console.info('Press Ctrl+D to toggle debug mode');
    
  } catch (err) {
    console.error('Failed to initialize application:', err);
    DOMUtils.showErrorBoundary('Failed to initialize application');
  }
}

/**
 * Setup initial form state
 */
function setupInitialForm() {
  // Initialize search terms container
  const searchContainer = document.getElementById('searchTermsContainer');
  if (searchContainer && searchContainer.children.length === 0) {
    const searchModule = import('./modules/search.js').then(module => {
      module.default.addSearchTerm();
    });
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Export for debugging
window.AppDebug = {
  AppState: AppState,
  resetApp: () => {
    AppState.reset();
    window.location.reload();
  },
  StreamingEnabled: () => StreamingIntegration.streamingEnabled
};