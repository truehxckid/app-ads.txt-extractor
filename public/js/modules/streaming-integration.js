/**
 * Streaming Integration Module
 * Integrates streaming functionality with the main application
 */

import AppState from './app-state.js';
import EventHandler from './event-handler.js';
import StreamingProcessor from './streaming/StreamProcessor.js'; // Direct import instead of bridge module
import { showNotification } from '../utils/notification.js';
import DOMUtils from './dom-utils.js';

/**
 * Streaming Integration Class
 */
class StreamingIntegration {
  constructor() {
    this.initialized = false;
    this.isStreamingSupported = !!window.ReadableStream;
    
    // Always use streaming mode for all requests
    console.log('StreamingIntegration: Streaming mode is always ON');
    localStorage.setItem('streamingEnabled', 'true');
    this.streamingEnabled = true;
    
    // Log current state to console
    console.log('StreamingIntegration constructed with streaming ' + 
      (this.streamingEnabled ? 'ENABLED' : 'disabled') + 
      ' (localStorage value: ' + localStorage.getItem('streamingEnabled') + ')');
  }
  
  /**
   * Initialize streaming integration
   */
  initialize() {
    if (this.initialized) return;
    
    // First check if browser supports streaming
    if (!this.isStreamingSupported) {
      console.log('Streaming not supported in this browser');
      this.streamingEnabled = false;
      localStorage.setItem('streamingEnabled', 'false');
      this.initialized = true;
      return;
    }
    
    // Initialize the streaming processor
    try {
      StreamingProcessor.initialize();
      console.log('Streaming processor initialized');
      
      // Add streaming toggle to UI
      this._addStreamingToggle();
      
      // Patch the extract button click handler
      this._patchExtractHandler();
      
      // Patch CSV export
      this._patchCsvExport();
      
      this.initialized = true;
      console.log('Streaming integration complete');
    } catch (err) {
      console.error('Failed to initialize streaming:', err);
      this.streamingEnabled = false;
      localStorage.setItem('streamingEnabled', 'false');
    }
  }
  
  /**
   * Add streaming toggle UI element
   */
  _addStreamingToggle() {
    // Create toggle element in options area
    const actionBar = document.querySelector('.action-bar');
    if (!actionBar) return;
    
    const toggleContainer = document.createElement('div');
    toggleContainer.className = 'streaming-toggle-container';
    toggleContainer.innerHTML = `
      <div class="streaming-status" style="display: flex; align-items: center; color: #27ae60; font-weight: bold;">
        <span class="status-icon" style="margin-right: 5px;">✓</span>
        <span class="status-label">Streaming Mode Active</span>
      </div>
      <div class="streaming-tooltip">
        <span class="tooltip-icon">?</span>
        <span class="tooltip-text">
          Streaming mode processes results as they arrive, showing real-time updates and preventing timeouts with large datasets. This helps avoid server errors and improves performance.
        </span>
      </div>
    `;
    
    actionBar.insertAdjacentElement('afterbegin', toggleContainer);
    
    // Initialize the streaming processor
    try {
      // Force initialize the streaming processor
      StreamingProcessor.initialize();
      
      // Create a one-time confirmation (shown only when the app first loads)
      if (!localStorage.getItem('streaming_notification_shown')) {
        const resultContainer = document.getElementById('result');
        if (resultContainer) {
          resultContainer.style.display = 'block';
          
          // Create a simple confirmation feedback
          const confirmDiv = document.createElement('div');
          confirmDiv.className = 'streaming-confirmation';
          confirmDiv.style.cssText = 'padding: 15px; background: #e8f7f3; border: 1px solid #27ae60; border-radius: 4px; margin-bottom: 15px; text-align: center;';
          confirmDiv.innerHTML = '<strong>Streaming mode active!</strong> Results will be processed efficiently with real-time updates.';
          
          resultContainer.prepend(confirmDiv);
          
          // Remove after 5 seconds
          setTimeout(() => {
            if (confirmDiv.parentNode) {
              confirmDiv.parentNode.removeChild(confirmDiv);
            }
            if (resultContainer.children.length === 0) {
              resultContainer.style.display = 'none'; 
            }
          }, 5000);
          
          // Mark as shown
          localStorage.setItem('streaming_notification_shown', 'true');
        }
      }
    } catch (e) {
      console.warn('Failed to initialize streaming processor:', e);
    }
    
    // Add some basic CSS for the toggle
    const style = document.createElement('style');
    style.textContent = `
      .streaming-toggle-container {
        display: flex;
        align-items: center;
        margin-right: 20px;
        gap: 8px;
      }
      .streaming-toggle {
        display: flex;
        align-items: center;
        cursor: pointer;
      }
      .toggle-switch {
        position: relative;
        display: inline-block;
        width: 40px;
        height: 20px;
        background-color: var(--neutral);
        border-radius: 10px;
        margin-right: 8px;
        transition: background-color 0.3s;
      }
      .toggle-switch:before {
        content: '';
        position: absolute;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: white;
        top: 2px;
        left: 2px;
        transition: transform 0.3s;
      }
      .streaming-toggle input {
        display: none;
      }
      .streaming-toggle input:checked + .toggle-switch {
        background-color: var(--primary);
      }
      .streaming-toggle input:checked + .toggle-switch:before {
        transform: translateX(20px);
      }
      .toggle-label {
        font-size: var(--font-size-sm);
      }
      .streaming-tooltip {
        position: relative;
        display: inline-block;
      }
      .tooltip-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        background: var(--neutral-light);
        border-radius: 50%;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
      }
      .tooltip-text {
        visibility: hidden;
        position: absolute;
        width: 250px;
        background: var(--bg-card);
        border: 1px solid var(--border);
        padding: 8px;
        border-radius: var(--radius-sm);
        font-size: var(--font-size-xs);
        bottom: 25px;
        left: 50%;
        transform: translateX(-50%);
        z-index: var(--z-above);
        box-shadow: 0 2px 8px var(--shadow);
      }
      .streaming-tooltip:hover .tooltip-text {
        visibility: visible;
      }
    `;
    document.head.appendChild(style);
  }
  
  /**
   * Patch the extract button click handler
   */
  _patchExtractHandler() {
    // Completely replace the original handler instead of wrapping it
    const originalHandler = EventHandler.handleExtractButtonClick;
    
    // Store reference to the original handler for use in the new handler
    this._originalExtractHandler = originalHandler;
    
    // Completely replace the extract button click handler
    EventHandler.handleExtractButtonClick = async (event) => {
      // Prevent default and prevent double submission
      event.preventDefault();
      if (AppState.isProcessing) return;
      
      console.log('⚡⚡⚡ COMPLETELY REPLACED HANDLER: Extract button clicked');
      
      // Get bundle IDs
      const bundleIdsElement = DOMUtils.getElement('bundleIds');
      const bundleIds = bundleIdsElement ? 
        DOMUtils.getTextareaLines('bundleIds') : [];
      
      if (bundleIds.length === 0) {
        showNotification('Please enter at least one bundle ID', 'error');
        bundleIdsElement?.focus();
        return;
      }
      
      // Get search terms
      const searchTerms = DOMUtils.getSearchTerms();
      
      // Store search terms in app state
      AppState.setSearchTerms(searchTerms);
      
      // Show processing indicator and disable extract button
      AppState.setProcessing(true);
      
      // Always use streaming for all requests, regardless of size
      const useStreaming = true;
      
      if (useStreaming) {
        console.log('⚡⚡⚡ ENTRY POINT: Using streaming for dataset:', bundleIds.length);
        console.log('⚡⚡⚡ ENTRY POINT: Streaming endpoint: /api/stream/extract-multiple');
        console.log('⚡⚡⚡ ENTRY POINT: COMPLETELY BYPASSING ORIGINAL HANDLER');
        
        // No longer creating fixed element to avoid duplicates - StreamProcessor now handles this
        
        // Create a global debug info element if it doesn't exist
        let debugElement = DOMUtils.getElement('debugInfo') || document.getElementById('debug-information');
        
        if (!debugElement) {
          console.log('⚡⚡⚡ ENTRY POINT: Creating debug info element from scratch');
          debugElement = document.createElement('div');
          debugElement.id = 'debugInfo';
          debugElement.className = 'debug-section';
          debugElement.style.cssText = 'background: #f8f8f8; border: 1px solid #ddd; padding: 15px; margin: 20px 0; border-radius: 8px; font-family: monospace; white-space: pre-wrap; overflow: auto; max-height: 300px; display: block;';
          
          // Add to the page - try to position it in a sensible location
          const resultElement = document.getElementById('result');
          if (resultElement && resultElement.parentNode) {
            resultElement.parentNode.insertBefore(debugElement, resultElement.nextSibling);
          } else {
            // Fallback to container or body
            const container = document.querySelector('.container') || document.body;
            container.appendChild(debugElement);
          }
          
          console.log('⚡⚡⚡ ENTRY POINT: Debug info element created successfully');
        }
        
        // Update the debug element
        if (debugElement) {
          console.log('⚡⚡⚡ ENTRY POINT: Updating debug element with initial information');
          debugElement.innerHTML = `
            <div class="debug-info">
              <strong>Debug Info (${new Date().toLocaleTimeString()}):</strong><br>
              <strong style="color: blue;">STREAMING MODE ACTIVE - USING /api/stream/extract-multiple</strong><br>
              Bundle IDs: ${bundleIds.length}<br>
              Search Terms: ${searchTerms.length ? searchTerms.join(', ') : 'None'}<br>
              Browser: ${navigator.userAgent}<br>
              Network: ${navigator.onLine ? 'Online' : 'Offline'}<br>
              Starting streaming process...
            </div>
          `;
          debugElement.style.display = 'block';
        } else {
          console.error('⚡⚡⚡ ENTRY POINT: Failed to create or find debug element');
        }
        
        try {
          // First check that StreamingProcessor exists and is properly initialized
          if (!StreamingProcessor) {
            throw new Error('StreamingProcessor module is not loaded properly');
          }
          
          if (typeof StreamingProcessor.processBundleIds !== 'function') {
            throw new Error(`StreamingProcessor.processBundleIds is not a function. Type: ${typeof StreamingProcessor.processBundleIds}`);
          }
          
          // Add debugging to debug element
          const debugInfo = document.getElementById('debugInfo') || document.getElementById('debug-information');
          if (debugInfo) {
            debugInfo.innerHTML += `<br><br><strong>Function Check (${new Date().toLocaleTimeString()}):</strong><br>
              StreamingProcessor loaded: ${!!StreamingProcessor}<br>
              StreamingProcessor type: ${typeof StreamingProcessor}<br>
              processBundleIds type: ${typeof StreamingProcessor.processBundleIds}<br>
              Starting method call...
            `;
          }
          
          // Process with streaming
          console.log('⚡⚡⚡ ENTRY POINT: Calling StreamingProcessor.processBundleIds');
          console.log('⚡⚡⚡ ENTRY POINT: StreamingProcessor content:', StreamingProcessor);
          console.log('⚡⚡⚡ ENTRY POINT: processBundleIds function:', StreamingProcessor.processBundleIds);
          
          const success = await StreamingProcessor.processBundleIds(bundleIds, searchTerms);
          console.log('⚡⚡⚡ ENTRY POINT: Streaming process result:', success ? 'Success' : 'Failed');
          
          // Update debug element with result
          if (debugInfo) {
            debugInfo.innerHTML += `<br><br><strong>Process Result (${new Date().toLocaleTimeString()}):</strong><br>
              Success: ${success}<br>
              Processing complete
            `;
          }
        } catch (err) {
          console.error('⚡⚡⚡ ENTRY POINT: Streaming error, falling back to regular processing:', err);
          
          // Log detailed error information
          console.error('⚡⚡⚡ ENTRY POINT: Error details:', {
            name: err.name,
            message: err.message,
            stack: err.stack,
            StreamingProcessor: StreamingProcessor ? 'Exists' : 'Missing',
            processBundleIds: typeof StreamingProcessor?.processBundleIds
          });
          
          // Update debug element with error
          const debugInfo = document.getElementById('debugInfo') || document.getElementById('debug-information');
          if (debugInfo) {
            debugInfo.innerHTML += `<br><br><strong>Error (${new Date().toLocaleTimeString()}):</strong><br>
              Error: ${err.message}<br>
              Type: ${err.name}<br>
              Stack: ${err.stack ? err.stack.split('\n').slice(0, 5).join('<br>') : 'No stack trace'}<br>
              Falling back to regular processing...
            `;
          }
          
          showNotification('Streaming error, falling back to regular processing', 'warning');
          
          // Reset processing state before calling original handler
          AppState.setProcessing(false);
          
          // Fall back to original handler
          return originalHandler.call(EventHandler, event);
        } finally {
          // Don't set processing to false here - let StreamProcessor handle it
          // when processing is truly complete
          console.log('⚡⚡⚡ ENTRY POINT: Processing in progress, AppState.isProcessing will be set to false when truly complete');
        }
        
        // IMPORTANT: Do not continue execution and call the original handler!
        return; // Return early to prevent execution continuing
      } else {
        // This should never happen since useStreaming is always true,
        // but we'll keep this code as a fallback just in case
        console.log('⚡⚡⚡ ENTRY POINT: Fallback to streaming processing for dataset:', bundleIds.length);
        
        // Try to use streaming anyway
        try {
          if (StreamingProcessor && typeof StreamingProcessor.processBundleIds === 'function') {
            return StreamingProcessor.processBundleIds(bundleIds, searchTerms);
          }
        } catch (err) {
          console.error('Error using streaming processor:', err);
        }
        
        // If all else fails, use original handler as a final fallback
        return this._originalExtractHandler.call(EventHandler, event);
      }
    };
    
    console.log('Extract handler patched for streaming support');
  }
  
  /**
   * Patch CSV export functionality
   */
  _patchCsvExport() {
    // We don't need to add a separate download button anymore
    // The "download-csv" action button is already handled by event-handler.js
    // This method is kept for backward compatibility but doesn't do anything
    console.log('CSV export patching skipped - using standard download-csv action');
  }
}

// Create and export singleton
const streamingIntegration = new StreamingIntegration();
export default streamingIntegration;