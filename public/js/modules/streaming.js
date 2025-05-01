/**
 * Streaming Module for App-Ads.txt Extractor
 * Handles client-side streaming processing for large datasets
 * Simple direct import version
 */

console.log('🔄 Loading streaming.js bridge module'); 

// Direct import without top-level await
import StreamProcessor from './streaming/StreamProcessor.js';

// Create a simple log indicator in the console
const createDebugItem = (message, type = 'info') => {
  console.log(`🔄 BRIDGE: ${message}`);
  
  // Try to add to debug info element if it exists
  try {
    const debugInfo = document.getElementById('debugInfo') || document.getElementById('debug-information');
    if (debugInfo) {
      const color = type === 'error' ? 'color:red;font-weight:bold;' : '';
      debugInfo.innerHTML += `<div style="${color}"><strong>🔄 BRIDGE:</strong> ${message}</div>`;
    }
  } catch (e) {
    // Silently fail - console log is already done
  }
};

createDebugItem(`StreamProcessor loaded successfully: ${!!StreamProcessor}`);

// Initialize the StreamProcessor
try {
  const initSuccess = StreamProcessor.initialize();
  createDebugItem(`StreamProcessor initialized: ${initSuccess}`);
} catch (err) {
  createDebugItem(`Error initializing StreamProcessor: ${err.message}`, 'error');
}

// Create global reference for debugging
window.StreamProcessorDebug = StreamProcessor;

export default StreamProcessor;