/**
 * Streaming Module for App-Ads.txt Extractor
 * Handles client-side streaming processing for large datasets
 * 
 * This is a refactored, modular version of the original streaming.js file
 */

console.log('🔄 Loading streaming.js module'); 

// Import the new modular components
try {
  // Dynamic import with error handling
  const StreamProcessorModule = await import('./streaming/StreamProcessor.js');
  console.log('✅ StreamProcessor loaded successfully');
  
  // Export the stream processor as the default
  export default StreamProcessorModule.default;
} catch (error) {
  console.error('❌ Error loading StreamProcessor:', error);
  
  // Provide fallback to prevent breaking the application
  const fallbackProcessor = {
    initialize() {
      console.warn('Using fallback streaming processor');
      return true;
    },
    processBundleIds() {
      console.error('Fallback processor cannot process bundle IDs');
      return Promise.resolve(false);
    }
  };
  
  export default fallbackProcessor;
}