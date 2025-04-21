/**
 * Application Configuration
 * Central configuration settings for the application
 */

const Config = {
  /**
   * API endpoints
   */
  api: {
    extractMultiple: '/api/extract-multiple',
    exportCsv: '/api/export-csv',
    checkAppAds: '/api/check-app-ads',
    stats: '/api/stats'
  },
  
  /**
   * Pagination settings
   */
  pagination: {
    defaultPageSize: 20,
    pageSizeOptions: [10, 20, 50, 100],
    maxPageSize: 100
  },
  
  /**
   * CSV Export settings
   */
  export: {
    chunkSize: 100, // Process items in chunks of this size
    maxMatchingLines: 10 // Maximum number of matching lines to include in CSV
  },
  
  /**
   * Search settings
   */
  search: {
    maxTerms: 5, // Maximum number of search terms
    minTermLength: 2 // Minimum length of search term
  },
  
  /**
   * UI settings
   */
  ui: {
    notificationDuration: 3000, // Default notification duration in ms
    debounceDelay: 300, // Debounce delay for input handlers
    animationDuration: 300, // CSS animation duration in ms
    longTimeout: 10000 // Long operation timeout
  },
  
  /**
   * Browser support
   */
  browser: {
    minVersions: {
      chrome: 80,
      firefox: 75,
      safari: 13,
      edge: 80
    }
  },
  
  /**
   * Performance settings
   */
  performance: {
    maxResultsInDom: 1000, // Maximum number of results to render at once
    maxSearchMatches: 500 // Maximum number of search matches to process
  },
  
  /**
   * Feature flags
   */
  features: {
    enableDebugMode: true,
    enableDarkMode: true,
    enablePagination: true,
    enableCsvExport: true,
    enableSearchHighlighting: true
  },
  
  /**
   * Get environment (development/production)
   * @returns {string} Current environment
   */
  getEnvironment() {
    // Detect environment based on URL or other factors
    return window.location.hostname === 'localhost' || 
           window.location.hostname === '127.0.0.1'
      ? 'development'
      : 'production';
  },
  
  /**
   * Check if running in development environment
   * @returns {boolean} True if in development
   */
  isDevelopment() {
    return this.getEnvironment() === 'development';
  }
};

export default Config;