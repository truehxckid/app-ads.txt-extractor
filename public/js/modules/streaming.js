/**
 * Streaming Module for App-Ads.txt Extractor
 * Handles client-side streaming processing for large datasets
 * 
 * This is a refactored, modular version of the original streaming.js file
 */

console.log('🔄 Loading streaming.js module'); 

// Direct import without top-level await
import StreamProcessor from './streaming/StreamProcessor.js';

// Wrapped version of the processor that logs usage
const wrappedProcessor = {
  // Forward all calls to the real processor with logging
  initialize() {
    console.log('🚀 StreamProcessor.initialize called');
    return StreamProcessor.initialize();
  },
  
  processBundleIds(bundleIds, searchTerms) {
    console.log(`🚀 StreamProcessor.processBundleIds called with ${bundleIds?.length} bundle IDs`);
    return StreamProcessor.processBundleIds(bundleIds, searchTerms);
  },
  
  exportCsv(bundleIds, searchTerms) {
    console.log(`🚀 StreamProcessor.exportCsv called with ${bundleIds?.length} bundle IDs`);
    return StreamProcessor.exportCsv(bundleIds, searchTerms);
  }
};

console.log('✅ StreamProcessor loaded successfully');
export default wrappedProcessor;