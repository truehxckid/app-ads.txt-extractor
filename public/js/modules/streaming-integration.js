/**
 * Streaming Integration Module
 * Integrates streaming functionality with the main application
 */

import AppState from './app-state.js';
import EventHandler from './event-handler.js';
import StreamingProcessor from './streaming.js';
import { showNotification } from '../utils/notification.js';
import DOMUtils from './dom-utils.js';

/**
 * Streaming Integration Class
 */
class StreamingIntegration {
  constructor() {
    this.initialized = false;
    this.isStreamingSupported = !!window.ReadableStream;
    this.streamingEnabled = localStorage.getItem('streamingEnabled') === 'true';
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
      <label class="streaming-toggle">
        <input type="checkbox" id="streamingToggle" ${this.streamingEnabled ? 'checked' : ''}>
        <span class="toggle-switch"></span>
        <span class="toggle-label">Enable Streaming</span>
      </label>
      <div class="streaming-tooltip">
        <span class="tooltip-icon">?</span>
        <span class="tooltip-text">
          Streaming mode processes results progressively as they arrive, showing real-time updates and preventing timeouts with large datasets (10+ bundle IDs). Enable this to avoid 524 errors.
        </span>
      </div>
    `;
    
    actionBar.insertAdjacentElement('afterbegin', toggleContainer);
    
    // Add toggle handler
    const toggle = document.getElementById('streamingToggle');
    if (toggle) {
      toggle.addEventListener('change', () => {
        this.streamingEnabled = toggle.checked;
        localStorage.setItem('streamingEnabled', this.streamingEnabled.toString());
        
        if (this.streamingEnabled) {
          showNotification('Streaming mode enabled for large datasets', 'info');
        } else {
          showNotification('Streaming mode disabled', 'info');
        }
      });
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
    const originalHandler = EventHandler.handleExtractButtonClick;
    
    EventHandler.handleExtractButtonClick = async (event) => {
      // Prevent default and prevent double submission
      event.preventDefault();
      if (AppState.isProcessing) return;
      
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
      
      // Determine if we should use streaming
      const useStreaming = this.streamingEnabled && bundleIds.length >= 10;
      
      if (useStreaming) {
        console.log('Using streaming for large dataset:', bundleIds.length);
        
        try {
          // Process with streaming
          await StreamingProcessor.processBundleIds(bundleIds, searchTerms);
        } catch (err) {
          console.error('Streaming error, falling back to regular processing:', err);
          showNotification('Streaming error, falling back to regular processing', 'warning');
          
          // Fall back to original handler
          return originalHandler.call(EventHandler, event);
        } finally {
          AppState.setProcessing(false);
        }
      } else {
        // Use original handler for smaller datasets
        return originalHandler.call(EventHandler, event);
      }
    };
    
    console.log('Extract handler patched for streaming support');
  }
  
  /**
   * Patch CSV export functionality
   */
  _patchCsvExport() {
    // Add event handler for streaming-specific downloads
    document.addEventListener('click', async (event) => {
      const target = event.target;
      const action = target.dataset.action || target.closest('[data-action]')?.dataset.action;
      
      if (action === 'stream-download-csv') {
        event.preventDefault();
        
        // Get bundle IDs and search terms
        const bundleIds = DOMUtils.getTextareaLines('bundleIds');
        const searchTerms = AppState.searchTerms.length > 0 ? 
          AppState.searchTerms : DOMUtils.getSearchTerms();
        
        // Download all results via streaming API
        await StreamingProcessor.exportCsv(bundleIds, searchTerms);
      }
    });
    
    // Modify the action buttons in results summary
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          const actionButtons = document.querySelector('.action-buttons');
          if (actionButtons && this.streamingEnabled) {
            // Check if we already added the streaming button
            if (!actionButtons.querySelector('[data-action="stream-download-csv"]')) {
              // Add streaming-specific download button
              const streamDownloadBtn = document.createElement('button');
              streamDownloadBtn.className = 'download-btn';
              streamDownloadBtn.setAttribute('data-action', 'stream-download-csv');
              streamDownloadBtn.textContent = 'Stream Download CSV';
              
              // Add to action buttons
              actionButtons.prepend(streamDownloadBtn);
            }
          }
        }
      });
    });
    
    // Start observing the document body for dynamic changes
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

// Create and export singleton
const streamingIntegration = new StreamingIntegration();
export default streamingIntegration;