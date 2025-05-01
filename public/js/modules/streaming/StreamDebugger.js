/**
 * StreamDebugger Module
 * Handles debugging functionality for streaming operations
 */

/**
 * Stream Debugger Class
 * Creates and manages debug visualization for streaming data
 */
class StreamDebugger {
  constructor() {
    this.debugDiv = null;
    this.startTime = 0;
    this.enabled = false;
  }
  
  /**
   * Initialize the debugger
   * @param {string} title - Debug window title
   * @param {Object} options - Debugger options
   * @returns {boolean} - Success status
   */
  initialize(title = 'Stream Debug', options = {}) {
    if (this.debugDiv) {
      // Already initialized
      return true;
    }
    
    this.startTime = Date.now();
    this.enabled = options.enabled !== false;
    
    if (!this.enabled) {
      return false;
    }
    
    try {
      // Create a debugging div to show raw stream data
      const debugDiv = document.createElement('div');
      debugDiv.id = 'stream-debug';
      debugDiv.style.cssText = 'position: fixed; bottom: 10px; right: 10px; width: 300px; height: 200px; background: #f0f0f0; border: 1px solid #999; padding: 10px; overflow: auto; z-index: 9999; font-size: 10px;';
      
      // Add title bar with close button
      const titleBar = document.createElement('div');
      titleBar.style.cssText = 'display: flex; justify-content: space-between; margin-bottom: 8px; border-bottom: 1px solid #ccc; padding-bottom: 5px;';
      titleBar.innerHTML = `
        <strong>${title}</strong>
        <div style="display: flex; gap: 5px;">
          <button id="debug-clear" style="font-size: 10px; padding: 0 5px;">Clear</button>
          <button id="debug-close" style="font-size: 10px; padding: 0 5px;">Close</button>
        </div>
      `;
      
      // Add event listeners for buttons
      debugDiv.appendChild(titleBar);
      document.body.appendChild(debugDiv);
      
      const clearBtn = document.getElementById('debug-clear');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          this.clear();
        });
      }
      
      const closeBtn = document.getElementById('debug-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          this.close();
        });
      }
      
      // Store reference
      this.debugDiv = debugDiv;
      
      // Initial message
      this.debugDiv.innerHTML += `<div>Debug session started at ${new Date().toLocaleTimeString()}</div><hr>`;
      
      return true;
    } catch (error) {
      console.error('Error initializing debug panel:', error);
      return false;
    }
  }
  
  /**
   * Log general status message to debug panel
   * @param {string} message - Message to log
   */
  logStatus(message) {
    if (!this.debugDiv) return;
    
    const runTime = Math.round((Date.now() - this.startTime) / 1000);
    this.debugDiv.innerHTML += `<div>${runTime}s: ${message}</div>`;
    
    // Auto-scroll to bottom
    this.debugDiv.scrollTop = this.debugDiv.scrollHeight;
  }
  
  /**
   * Log chunk details to debug panel
   * @param {string} chunk - The received data chunk
   * @param {number} length - Byte length of the chunk
   */
  logChunk(chunk, length) {
    if (!this.debugDiv) return;
    
    const displayChunk = chunk.length > 50 ? chunk.substring(0, 50) + '...' : chunk;
    const runTime = Math.round((Date.now() - this.startTime) / 1000);
    
    this.debugDiv.innerHTML += `
      <div style="color:#3498db;">${runTime}s: Chunk ${length} bytes: 
        <span style="color:#555;">${displayChunk.replace(/</g, '&lt;')}</span>
      </div>
    `;
    
    // Auto-scroll to bottom
    this.debugDiv.scrollTop = this.debugDiv.scrollHeight;
  }
  
  /**
   * Log error message to debug panel
   * @param {Error|string} error - Error to log
   */
  logError(error) {
    if (!this.debugDiv) return;
    
    const errorMsg = error instanceof Error ? error.message : error;
    const errorStack = error instanceof Error ? error.stack : '';
    
    this.debugDiv.innerHTML += `
      <div style="color:red; font-weight:bold;">ERROR: ${errorMsg}</div>
      ${errorStack ? `<pre style="font-size:9px; margin:3px 0; color:#777;">${errorStack}</pre>` : ''}
    `;
    
    // Auto-scroll to bottom
    this.debugDiv.scrollTop = this.debugDiv.scrollHeight;
  }
  
  /**
   * Log server connection info
   * @param {Response} response - Fetch API response object
   */
  logConnectionInfo(response) {
    if (!this.debugDiv) return;
    
    this.debugDiv.innerHTML += `
      <div style="font-weight:bold; color:green;">Connection established</div>
      <div>Status: ${response.status}</div>
      <div style="font-size:9px; margin-bottom:5px;">Headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}</div>
      <hr>
    `;
    
    // Auto-scroll to bottom
    this.debugDiv.scrollTop = this.debugDiv.scrollHeight;
  }
  
  /**
   * Log processing summary at end of stream
   * @param {string} message - Summary message
   * @param {Object} stats - Processing statistics
   */
  logSummary(message, stats = {}) {
    if (!this.debugDiv) return;
    
    this.debugDiv.innerHTML += `
      <hr>
      <div style="font-weight:bold;">${message}</div>
    `;
    
    // Add details for each stat
    Object.entries(stats).forEach(([key, value]) => {
      this.debugDiv.innerHTML += `<div>${key}: ${value}</div>`;
    });
    
    // Auto-scroll to bottom
    this.debugDiv.scrollTop = this.debugDiv.scrollHeight;
  }
  
  /**
   * Clear the debug panel
   */
  clear() {
    if (!this.debugDiv) return;
    
    // Preserve the title bar
    const titleBar = this.debugDiv.querySelector('div:first-child');
    this.debugDiv.innerHTML = '';
    
    if (titleBar) {
      this.debugDiv.appendChild(titleBar);
    }
    
    this.debugDiv.innerHTML += `<div>Debug cleared at ${new Date().toLocaleTimeString()}</div><hr>`;
  }
  
  /**
   * Close the debug panel
   */
  close() {
    if (!this.debugDiv) return;
    
    if (this.debugDiv.parentNode) {
      this.debugDiv.parentNode.removeChild(this.debugDiv);
    }
    
    this.debugDiv = null;
  }
}

export default StreamDebugger;