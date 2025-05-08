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
        
        // Debug info is no longer shown in the UI
        console.log('⚡⚡⚡ ENTRY POINT: Processing with streaming API, bundle IDs:', bundleIds.length);
        
        try {
          // First check that StreamingProcessor exists and is properly initialized
          if (!StreamingProcessor) {
            throw new Error('StreamingProcessor module is not loaded properly');
          }
          
          if (typeof StreamingProcessor.processBundleIds !== 'function') {
            throw new Error(`StreamingProcessor.processBundleIds is not a function. Type: ${typeof StreamingProcessor.processBundleIds}`);
          }
          
          // Function check logs
          console.log(`⚡⚡⚡ Function Check: StreamingProcessor loaded: ${!!StreamingProcessor}, type: ${typeof StreamingProcessor}`);
          console.log(`⚡⚡⚡ Function Check: processBundleIds type: ${typeof StreamingProcessor.processBundleIds}`);
          
          // Process with streaming
          console.log('⚡⚡⚡ ENTRY POINT: Calling StreamingProcessor.processBundleIds');
          console.log('⚡⚡⚡ ENTRY POINT: StreamingProcessor content:', StreamingProcessor);
          console.log('⚡⚡⚡ ENTRY POINT: processBundleIds function:', StreamingProcessor.processBundleIds);
          
          const success = await StreamingProcessor.processBundleIds(bundleIds, searchTerms);
          console.log('⚡⚡⚡ ENTRY POINT: Streaming process result:', success ? 'Success' : 'Failed');
          
          // Log result
          console.log(`⚡⚡⚡ Process result: ${success ? 'Success' : 'Failed'}`);
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
          
          // Log error details
          console.error(`⚡⚡⚡ Error details: ${err.message}, type: ${err.name}`);
          console.error(`⚡⚡⚡ Error stack: ${err.stack || 'No stack trace'}`);
          console.log('⚡⚡⚡ Falling back to regular processing...');
          
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