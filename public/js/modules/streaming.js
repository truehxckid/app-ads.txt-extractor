/**
 * Streaming Module for App-Ads.txt Extractor
 * Handles client-side streaming processing for large datasets
 * 
 * This is a refactored, modular version of the original streaming.js file
 */

console.log('⚡ CRITICAL: Loading streaming.js bridge module - entry point!'); 

let importedStreamProcessor = null;
let importError = null;

try {
  // Direct import without top-level await
  console.log('⚡ CRITICAL: About to import StreamProcessor - using direct import');
  
  // Log window object to check if we're in the right environment
  console.log('⚡ CRITICAL: Window.ReadableStream exists:', !!window.ReadableStream);
  console.log('⚡ CRITICAL: Document ready state:', document.readyState);
  
  // Create a global debug message on the page
  const debugMessage = document.createElement('div');
  debugMessage.id = 'streaming-debug-message';
  debugMessage.style.cssText = 'position: fixed; bottom: 10px; right: 10px; background: #f8f8f8; border: 1px solid #ddd; padding: 5px; border-radius: 5px; font-size: 12px; z-index: 10000; max-width: 300px; opacity: 0.9;';
  debugMessage.innerHTML = 'StreamingModule: Loading modules...';
  document.body.appendChild(debugMessage);
  
  // Do the import
  import('./streaming/StreamProcessor.js')
    .then(module => {
      console.log('⚡ CRITICAL: StreamProcessor imported successfully:', module);
      importedStreamProcessor = module.default;
      debugMessage.innerHTML = 'StreamingModule: Modules loaded successfully!';
    })
    .catch(err => {
      console.error('⚡ CRITICAL: Failed to import StreamProcessor:', err);
      importError = err;
      debugMessage.innerHTML = `StreamingModule Error: ${err.message}`;
      debugMessage.style.backgroundColor = '#ffdddd';
    });
    
} catch (err) {
  console.error('⚡ CRITICAL: Critical error while importing StreamProcessor:', err);
  importError = err;
  
  // Try to show the error on the page
  try {
    const errorMessage = document.createElement('div');
    errorMessage.style.cssText = 'position: fixed; top: 10px; right: 10px; background: #ffdddd; border: 1px solid #ff0000; padding: 10px; border-radius: 5px; z-index: 10000;';
    errorMessage.innerHTML = `<strong>Critical Error:</strong> ${err.message}`;
    document.body.appendChild(errorMessage);
  } catch (displayErr) {
    // Last resort - just log to console
    console.error('⚡ CRITICAL: Could not even display error:', displayErr);
  }
}

// Function to safely get the StreamProcessor
const getProcessor = () => {
  // First try imported module
  if (importedStreamProcessor) {
    return importedStreamProcessor;
  }
  
  // If that failed, try dynamic import again
  try {
    console.log('⚡ CRITICAL: Attempting fallback import of StreamProcessor');
    return import('./streaming/StreamProcessor.js')
      .then(module => {
        console.log('⚡ CRITICAL: Fallback import succeeded:', module);
        importedStreamProcessor = module.default;
        return importedStreamProcessor;
      })
      .catch(err => {
        console.error('⚡ CRITICAL: Fallback import failed:', err);
        throw err;
      });
  } catch (err) {
    console.error('⚡ CRITICAL: Critical error in fallback import:', err);
    throw err;
  }
};

// Wrapped version of the processor with extensive error handling and logging
const wrappedProcessor = {
  // Forward all calls to the real processor with logging
  async initialize() {
    console.log('⚡⚡ StreamProcessor.initialize called');
    
    try {
      // First check if we have an import error
      if (importError) {
        console.error('⚡⚡ Initialize: Import error occurred:', importError);
        throw importError;
      }
      
      // Get the processor
      const processor = await getProcessor();
      
      if (!processor) {
        console.error('⚡⚡ Initialize: Failed to get StreamProcessor instance');
        throw new Error('Failed to get StreamProcessor instance');
      }
      
      console.log('⚡⚡ Initialize: Got processor instance:', processor);
      return processor.initialize();
    } catch (err) {
      console.error('⚡⚡ Initialize: Error initializing StreamProcessor:', err);
      // Try to show debugging info
      const debugInfo = document.getElementById('debugInfo') || document.getElementById('debug-information');
      if (debugInfo) {
        debugInfo.innerHTML += `<br><br><strong>StreamProcessor Error (${new Date().toLocaleTimeString()}):</strong><br>
          Error during initialize: ${err.message}<br>
          Stack: ${err.stack ? err.stack.split('\n').slice(0, 3).join('<br>') : 'No stack trace'}<br>
        `;
        debugInfo.style.display = 'block';
      }
      throw err;
    }
  },
  
  async processBundleIds(bundleIds, searchTerms) {
    console.log(`⚡⚡ StreamProcessor.processBundleIds called with ${bundleIds?.length} bundle IDs`);
    try {
      // First check if we have an import error
      if (importError) {
        console.error('⚡⚡ processBundleIds: Import error occurred:', importError);
        throw importError;
      }
      
      // Get the processor
      const processor = await getProcessor();
      
      if (!processor) {
        console.error('⚡⚡ processBundleIds: Failed to get StreamProcessor instance');
        throw new Error('Failed to get StreamProcessor instance');
      }
      
      console.log('⚡⚡ processBundleIds: Got processor instance:', processor);
      return processor.processBundleIds(bundleIds, searchTerms);
    } catch (err) {
      console.error('⚡⚡ processBundleIds: Error processing bundle IDs:', err);
      
      // Try to show debugging info
      const debugInfo = document.getElementById('debugInfo') || document.getElementById('debug-information');
      if (debugInfo) {
        debugInfo.innerHTML += `<br><br><strong>StreamProcessor Error (${new Date().toLocaleTimeString()}):</strong><br>
          Error during processBundleIds: ${err.message}<br>
          Stack: ${err.stack ? err.stack.split('\n').slice(0, 3).join('<br>') : 'No stack trace'}<br>
        `;
        debugInfo.style.display = 'block';
      }
      
      throw err;
    }
  },
  
  async exportCsv(bundleIds, searchTerms) {
    console.log(`⚡⚡ StreamProcessor.exportCsv called with ${bundleIds?.length} bundle IDs`);
    try {
      // First check if we have an import error
      if (importError) {
        console.error('⚡⚡ exportCsv: Import error occurred:', importError);
        throw importError;
      }
      
      // Get the processor
      const processor = await getProcessor();
      
      if (!processor) {
        console.error('⚡⚡ exportCsv: Failed to get StreamProcessor instance');
        throw new Error('Failed to get StreamProcessor instance');
      }
      
      console.log('⚡⚡ exportCsv: Got processor instance:', processor);
      return processor.exportCsv(bundleIds, searchTerms);
    } catch (err) {
      console.error('⚡⚡ exportCsv: Error exporting CSV:', err);
      
      // Try to show debugging info
      const debugInfo = document.getElementById('debugInfo') || document.getElementById('debug-information');
      if (debugInfo) {
        debugInfo.innerHTML += `<br><br><strong>StreamProcessor Error (${new Date().toLocaleTimeString()}):</strong><br>
          Error during exportCsv: ${err.message}<br>
          Stack: ${err.stack ? err.stack.split('\n').slice(0, 3).join('<br>') : 'No stack trace'}<br>
        `;
        debugInfo.style.display = 'block';
      }
      
      throw err;
    }
  }
};

console.log('✅ StreamProcessor bridge module loaded successfully');

// Create a global direct access method for debugging
window.StreamProcessorDebug = wrappedProcessor;

export default wrappedProcessor;