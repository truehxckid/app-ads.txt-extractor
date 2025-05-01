/**
 * Streaming Module for App-Ads.txt Extractor
 * Handles client-side streaming processing for large datasets
 */

import AppState from './app-state.js';
import DOMUtils from './dom-utils.js';
import { showNotification } from '../utils/notification.js';
import { formatNumber, getStoreDisplayName } from '../utils/formatting.js';
import VisualIndicators from './visual-indicators.js';

/**
 * Streaming processor class
 */
class StreamingProcessor {
  constructor() {
    this.initialized = false;
    this.worker = null;
    this.streamController = null;
    this.decoder = new TextDecoder();
    
    // Initialize stats
    this.stats = {
      processedCount: 0,
      successCount: 0,
      errorCount: 0,
      withAppAdsTxtCount: 0,
      startTime: 0,
      totalBundleIds: 0,
      lastRenderTime: 0
    };
    
    // Results storage
    this.results = [];
    this.searchTerms = [];
    
    // Progressive rendering buffers
    this.resultBuffer = [];
    this.lastRenderTime = 0;
    this.renderThrottleTime = 200; // ms between renders
    this.isRendering = false;
    this.animationFrameId = null;
  }
  
  /**
   * Initialize the streaming processor
   */
  initialize() {
    if (this.initialized) return;
    
    // Check if browser supports streaming
    if (!window.ReadableStream || !window.TextDecoder) {
      console.warn('Browser does not support streaming, falling back to regular processing');
      return false;
    }
    
    // Try to initialize web worker if supported
    try {
      if (window.Worker) {
        this.worker = new Worker('/js/workers/stream-worker.js');
        
        // Set up event listener for worker messages
        this.worker.onmessage = (e) => {
          this._handleWorkerMessage(e.data);
        };
      }
    } catch (err) {
      console.warn('Failed to initialize streaming worker:', err);
    }
    
    this.initialized = true;
    return true;
  }
  
  /**
   * Process bundle IDs using streaming
   * @param {string[]} bundleIds - Bundle IDs to process
   * @param {string[]} searchTerms - Search terms (optional)
   * @returns {Promise<boolean>} - Success status
   */
  async processBundleIds(bundleIds, searchTerms = []) {
    // Initialize if not already
    if (!this.initialized) {
      if (!this.initialize()) {
        showNotification('Streaming not supported in this browser, using regular processing instead', 'warning');
        return false;
      }
    }
    
    // Reset state
    this.resetState();
    this.searchTerms = searchTerms;
    this.stats.startTime = Date.now();
    this.stats.totalBundleIds = bundleIds.length;
    
    // Get result element and create initial UI
    const resultElement = DOMUtils.getElement('result');
    if (!resultElement) return false;
    
    // Initialize visual indicators
    VisualIndicators.initialize({
      totalItems: bundleIds.length,
      containerSelector: resultElement,
      showDetails: true,
      animate: true
    });
    
    // Set initial status message
    VisualIndicators.setStatusMessage('Starting streaming process...', 'info');
    
    try {
      // If worker is available and initialized, use it
      if (this.worker) {
        console.log('Using Web Worker for streaming processing');
        VisualIndicators.setStatusMessage('Processing with Web Worker...', 'info');
        
        this.worker.postMessage({
          type: 'processBundleIds',
          bundleIds,
          searchTerms,
          totalBundleIds: bundleIds.length
        });
        
        // Worker handles the UI updates, so we just return
        return true;
      }
      
      // If no worker, process with main thread
      VisualIndicators.setStatusMessage('Processing on main thread...', 'info');
      return await this._processBundleIdsMainThread(bundleIds, searchTerms);
    } catch (err) {
      console.error('Error starting streaming process:', err);
      showNotification(`Streaming error: ${err.message}`, 'error');
      VisualIndicators.showError(`Streaming error: ${err.message}`);
      return false;
    }
  }
  
  /**
   * Process bundle IDs using streaming on the main thread
   * @param {string[]} bundleIds - Bundle IDs to process
   * @param {string[]} searchTerms - Search terms (optional)
   * @returns {Promise<boolean>} - Success status
   */
  async _processBundleIdsMainThread(bundleIds, searchTerms = []) {
    try {
      // Prepare the DOM for streaming results
      this._initializeResultsUI(searchTerms.length > 0);
      
      // Start streaming process
      const response = await fetch('/api/stream/extract-multiple', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ bundleIds, searchTerms })
      });
      
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }
      
      if (!response.body) {
        throw new Error('ReadableStream not supported in this browser');
      }
      
      // Process the stream
      await this._processResponseStream(response.body);
      
      // Update the UI when complete
      this._finalizeUI();
      
      return true;
    } catch (err) {
      console.error('Streaming error:', err);
      showNotification(`Streaming error: ${err.message}`, 'error');
      DOMUtils.showError('result', err.message);
      return false;
    }
  }
  
  /**
   * Process response body as a stream
   * @param {ReadableStream} stream - Response body stream
   */
  async _processResponseStream(stream) {
    // Get stream reader
    const reader = stream.getReader();
    let buffer = '';
    let jsonStarted = false;
    let resultArrayStarted = false;
    let parseCount = 0;
    
    try {
      // Process the stream
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }
        
        // Decode the chunk and add to buffer
        const chunk = this.decoder.decode(value, { stream: true });
        buffer += chunk;
        
        // Process buffer for complete JSON objects
        if (!jsonStarted && buffer.includes('{"success":')) {
          jsonStarted = true;
          
          // Extract any initial metadata
          const resultsStart = buffer.indexOf('"results":[');
          if (resultsStart !== -1) {
            resultArrayStarted = true;
            buffer = buffer.substring(resultsStart + 11); // Skip over "results":[
          }
        }
        
        if (resultArrayStarted) {
          // Try to extract complete JSON objects from the array
          let objectStart = 0;
          let objectDepth = 0;
          let inString = false;
          let escapeNext = false;
          
          for (let i = 0; i < buffer.length; i++) {
            const char = buffer[i];
            
            if (escapeNext) {
              escapeNext = false;
              continue;
            }
            
            if (char === '\\') {
              escapeNext = true;
              continue;
            }
            
            if (char === '"' && !escapeNext) {
              inString = !inString;
              continue;
            }
            
            if (inString) continue;
            
            if (char === '{') {
              if (objectDepth === 0) {
                objectStart = i;
              }
              objectDepth++;
            } else if (char === '}') {
              objectDepth--;
              
              if (objectDepth === 0) {
                // We have a complete object
                try {
                  const objectStr = buffer.substring(objectStart, i + 1);
                  const resultObject = JSON.parse(objectStr);
                  
                  // Process the result
                  this._processResult(resultObject);
                  
                  // Update progress every 5 items
                  if (++parseCount % 5 === 0) {
                    this._updateProgressUI();
                  }
                  
                  // Remove processed object from buffer
                  buffer = buffer.substring(i + 1);
                  
                  // Check if next character is a comma (likely), and skip it
                  if (buffer.charAt(0) === ',') {
                    buffer = buffer.substring(1);
                  }
                  
                  // Reset parser state
                  i = -1; // Next iteration will be at index 0
                } catch (parseErr) {
                  console.debug('Incomplete JSON object, continuing collection', parseErr);
                  // Don't modify buffer, continue collecting
                }
              }
            }
          }
        }
      }
      
      // Final buffer processing for any trailing metadata
      if (buffer.includes('"totalProcessed":')) {
        const totalProcessedMatch = buffer.match(/"totalProcessed":(\d+)/);
        if (totalProcessedMatch && totalProcessedMatch[1]) {
          const totalProcessed = parseInt(totalProcessedMatch[1], 10);
          console.log(`Total processed according to server: ${totalProcessed}`);
        }
      }
    } catch (err) {
      console.error('Error processing stream:', err);
      throw err;
    } finally {
      reader.releaseLock();
    }
  }
  
  /**
   * Process a single result from the stream
   * @param {Object} result - Result object
   */
  _processResult(result) {
    // Update statistics
    this.stats.processedCount++;
    
    if (result.success) {
      this.stats.successCount++;
      if (result.appAdsTxt?.exists) {
        this.stats.withAppAdsTxtCount++;
      }
    } else {
      this.stats.errorCount++;
    }
    
    // Add to results array
    this.results.push(result);
    
    // Add to buffer for progressive rendering
    this.resultBuffer.push(result);
    
    // Update visual indicators
    VisualIndicators.updateProgress({
      processed: this.stats.processedCount,
      success: this.stats.successCount,
      errors: this.stats.errorCount,
      withAppAds: this.stats.withAppAdsTxtCount,
      total: this.stats.totalBundleIds
    });
    
    // Update status message periodically
    if (this.stats.processedCount % 10 === 0) {
      const percent = this.stats.totalBundleIds > 0 
        ? Math.round((this.stats.processedCount / this.stats.totalBundleIds) * 100)
        : 0;
      
      VisualIndicators.setStatusMessage(
        `Processing... ${percent}% complete (${this.stats.processedCount} of ${this.stats.totalBundleIds})`,
        'info'
      );
    }
    
    // Schedule rendering if not already in progress
    this._scheduleRender();
  }
  
  /**
   * Schedule a batched render operation using requestAnimationFrame
   */
  _scheduleRender() {
    // If already rendering or if buffer is empty, do nothing
    if (this.isRendering || this.resultBuffer.length === 0) {
      return;
    }
    
    const now = Date.now();
    
    // Check if we should render now (either first render or enough time has passed)
    if (this.lastRenderTime === 0 || (now - this.lastRenderTime) > this.renderThrottleTime) {
      this.isRendering = true;
      this.animationFrameId = requestAnimationFrame(() => this._renderResultsBatch());
    }
  }
  
  /**
   * Render a batch of results using a document fragment for efficiency
   */
  _renderResultsBatch() {
    const tbody = document.getElementById('results-tbody');
    const detailsContainer = document.getElementById('details-container');
    
    if (!tbody) {
      // If no tbody, clear buffer and return
      this.resultBuffer = [];
      this.isRendering = false;
      return;
    }
    
    // Create a document fragment for batch DOM updates
    const fragment = document.createDocumentFragment();
    const tempDiv = document.createElement('div');
    
    // Process all buffered results
    this.resultBuffer.forEach(result => {
      // Create row HTML
      const rowHtml = this._createResultRow(result);
      tempDiv.innerHTML = rowHtml;
      
      // Append row from temp div to fragment
      while (tempDiv.firstChild) {
        fragment.appendChild(tempDiv.firstChild);
      }
      
      // If detailed app-ads.txt info was provided, add to details container
      if (result.success && result.appAdsTxt?.exists && detailsContainer) {
        const detailsId = `app-ads-details-${this.results.indexOf(result) + 1}`;
        this._addAppAdsDetails(result, detailsId);
      }
    });
    
    // Update the DOM in a single operation
    tbody.appendChild(fragment);
    
    // Update progress UI
    this._updateProgressUI();
    
    // Clear buffer and reset rendering state
    this.resultBuffer = [];
    this.lastRenderTime = Date.now();
    this.isRendering = false;
    
    // Schedule next batch if there are more results
    if (this.resultBuffer.length > 0) {
      this.animationFrameId = requestAnimationFrame(() => this._renderResultsBatch());
    } else {
      this.animationFrameId = null;
    }
  }
  
  /**
   * Initialize the UI for streaming results
   * @param {boolean} hasSearchTerms - Whether search terms are present
   */
  _initializeResultsUI(hasSearchTerms) {
    const resultElement = DOMUtils.getElement('result');
    if (!resultElement) return;
    
    // Create initial structure
    resultElement.innerHTML = `
      <div class="results-summary">
        <div class="summary-stats">
          <span>Processing: <strong>0</strong></span>
          <span class="success-count">Success: <strong>0</strong></span>
          <span class="error-count">Errors: <strong>0</strong></span>
          <span class="app-ads-count">With app-ads.txt: <strong>0</strong></span>
        </div>
        <div class="action-buttons">
          <button class="download-btn" data-action="download-csv" disabled>Download Results</button>
        </div>
      </div>
      <div id="streamProgress" class="progress-indicator" style="display: flex;">
        <div class="progress-bar">
          <div style="width: 0%;"></div>
        </div>
        <span class="progress-text">0%</span>
      </div>
      <div class="results-table-container">
        <table class="results-table">
          <thead>
            <tr>
              <th scope="col">Bundle ID</th>
              <th scope="col">Store</th>
              <th scope="col">Domain</th>
              <th scope="col">App-ads.txt</th>
              ${hasSearchTerms ? '<th scope="col">Search Matches</th>' : ''}
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody id="results-tbody">
          </tbody>
        </table>
      </div>
      <div class="details-container" id="details-container"></div>
    `;
    
    // Show the result element
    resultElement.style.display = 'block';
  }
  
  /**
   * Update progress UI during streaming
   */
  _updateProgressUI() {
    // Update summary stats
    const summaryStats = document.querySelector('.summary-stats');
    if (summaryStats) {
      summaryStats.innerHTML = `
        <span>Processing: <strong>${formatNumber(this.stats.processedCount)}</strong>${
          this.stats.totalBundleIds > 0 ? ` / ${formatNumber(this.stats.totalBundleIds)}` : ''
        }</span>
        <span class="success-count">Success: <strong>${formatNumber(this.stats.successCount)}</strong></span>
        <span class="error-count">Errors: <strong>${formatNumber(this.stats.errorCount)}</strong></span>
        <span class="app-ads-count">With app-ads.txt: <strong>${formatNumber(this.stats.withAppAdsTxtCount)}</strong></span>
      `;
    }
    
    // Update progress bar
    const progressElement = document.getElementById('streamProgress');
    if (progressElement) {
      let percent;
      let statusText;
      
      // Calculate percentage based on total if available, otherwise use time-based estimate
      if (this.stats.totalBundleIds > 0) {
        percent = Math.round((this.stats.processedCount / this.stats.totalBundleIds) * 100);
        statusText = `${percent}% (${formatNumber(this.stats.processedCount)} of ${formatNumber(this.stats.totalBundleIds)})`;
      } else {
        // Fallback: Assume we don't know the total, so base percentage on time elapsed
        const elapsed = Date.now() - this.stats.startTime;
        // Estimate 100% after 60 seconds max
        percent = Math.min(95, Math.round((elapsed / 60000) * 100));
        statusText = `${formatNumber(this.stats.processedCount)} processed`;
      }
      
      // Calculate processing rate (items per second)
      const elapsed = (Date.now() - this.stats.startTime) / 1000; // in seconds
      const itemsPerSecond = elapsed > 0 ? this.stats.processedCount / elapsed : 0;
      
      // Estimate remaining time if we know total
      let remainingText = '';
      if (this.stats.totalBundleIds > 0 && itemsPerSecond > 0) {
        const remaining = this.stats.totalBundleIds - this.stats.processedCount;
        const remainingSecs = Math.round(remaining / itemsPerSecond);
        
        if (remainingSecs > 0) {
          remainingText = remainingSecs > 60 
            ? ` - est. ${Math.round(remainingSecs/60)} min remaining`
            : ` - est. ${remainingSecs} sec remaining`;
        }
      }
      
      const progressBar = progressElement.querySelector('.progress-bar > div');
      const progressText = progressElement.querySelector('.progress-text');
      
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (progressText) progressText.textContent = `${statusText}${remainingText}`;
      
      // Display progress element if it was hidden
      progressElement.style.display = 'flex';
    }
  }
  
  /**
   * Create a result row HTML
   * @param {Object} result - Result object
   * @returns {string} - HTML for table row
   */
  _createResultRow(result) {
    if (result.success) {
      const hasAppAds = result.appAdsTxt?.exists;
      const detailsId = hasAppAds ? `app-ads-details-${this.stats.processedCount}` : '';
      
      // Check if there are search matches
      const hasSearchMatches = hasAppAds && result.appAdsTxt.searchResults && 
                              result.appAdsTxt.searchResults.count > 0;
      const searchMatchCount = hasSearchMatches ? result.appAdsTxt.searchResults.count : 0;
      
      let html = `
        <tr class="success-row ${hasAppAds ? 'has-app-ads' : ''} ${hasSearchMatches ? 'has-search-matches' : ''}">
          <td>${DOMUtils.escapeHtml(result.bundleId)}</td>
          <td>${DOMUtils.escapeHtml(getStoreDisplayName(result.storeType))}</td>
          <td class="domain-cell">${DOMUtils.escapeHtml(result.domain || 'N/A')}</td>
          <td class="app-ads-cell">
      `;
      
      if (hasAppAds) {
        html += `
          <span class="app-ads-found">Found</span>
          <button class="toggle-app-ads" data-action="toggle-ads" data-target="${detailsId}" 
            type="button" aria-expanded="false" aria-controls="${detailsId}">
            Show app-ads.txt
          </button>
        `;
      } else {
        html += `<span class="app-ads-missing">Not found</span>`;
      }
      
      html += `</td>`;
      
      // Search matches cell if search terms provided
      if (this.searchTerms.length > 0) {
        html += `<td class="search-matches-cell">`;
        
        if (hasSearchMatches) {
          html += `<span class="search-matches-found">`;
          
          // For multi-term search, show color-coded indicators
          if (result.appAdsTxt.searchResults.termResults) {
            // Generate colored indicators for each term
            result.appAdsTxt.searchResults.termResults.forEach((termResult, termIndex) => {
              if (termResult.count > 0) {
                const colorClass = `term-match-${termIndex % 5}`;
                html += `<span class="term-match-indicator ${colorClass}">${termResult.count}</span> `;
              }
            });
          } else {
            // Fallback for single-term search
            html += `${searchMatchCount} matches`;
          }
          
          html += `</span>`;
          
          if (searchMatchCount > 0) {
            const targetId = `search-${detailsId}`;
            html += `
              <button class="toggle-search-matches" data-action="toggle-matches" data-target="${targetId}" 
                type="button" aria-expanded="false" aria-controls="${targetId}">
                Show matches
              </button>
            `;
          }
        } else {
          html += `<span class="search-matches-missing">No matches</span>`;
        }
        
        html += `</td>`;
      }
      
      // Actions cell
      html += `
        <td>
          <button class="table-copy-btn" data-action="copy" data-copy="${result.domain || ''}" 
            type="button" title="Copy domain to clipboard">Copy</button>
        </td>
      </tr>
      `;
      
      return html;
    } else {
      // Error row
      return `
        <tr class="error-row">
          <td>${DOMUtils.escapeHtml(result.bundleId)}</td>
          <td class="error-message" colspan="${this.searchTerms.length > 0 ? 4 : 3}">
            Error: ${DOMUtils.escapeHtml(result.error || 'Unknown error')}
          </td>
          <td></td>
        </tr>
      `;
    }
  }
  
  /**
   * Add app-ads.txt details to the details container
   * @param {Object} result - Result object
   * @param {string} [customDetailsId] - Custom details ID, if provided
   */
  _addAppAdsDetails(result, customDetailsId) {
    const detailsContainer = document.getElementById('details-container');
    if (!detailsContainer) return;
    
    const detailsId = customDetailsId || `app-ads-details-${this.stats.processedCount}`;
    
    // Limit content length for better performance
    const contentText = result.appAdsTxt.content && result.appAdsTxt.content.length > 10000 
      ? result.appAdsTxt.content.substring(0, 10000) + '...\n(truncated for performance)' 
      : (result.appAdsTxt.content || 'Content not available in streaming mode');
    
    // Create a document fragment for better performance
    const tempDiv = document.createElement('div');
    
    tempDiv.innerHTML = `
      <div id="${detailsId}" class="app-ads-details" style="display:none;">
        <h4>app-ads.txt for ${DOMUtils.escapeHtml(result.domain)}</h4>
        <div class="app-ads-url"><strong>URL:</strong> <a href="${DOMUtils.escapeHtml(result.appAdsTxt.url)}" target="_blank" rel="noopener noreferrer">${DOMUtils.escapeHtml(result.appAdsTxt.url)}</a></div>
        <div class="app-ads-stats">
          <strong>Stats:</strong> 
          ${result.appAdsTxt.analyzed.totalLines} lines, 
          ${result.appAdsTxt.analyzed.validLines} valid entries
        </div>
        <div class="app-ads-content">
          <pre>${DOMUtils.escapeHtml(contentText)}</pre>
        </div>
      </div>
    `;
    
    // Add search matches section if there are matches
    const hasSearchMatches = result.appAdsTxt.searchResults && 
                            result.appAdsTxt.searchResults.count > 0;
    
    if (hasSearchMatches) {
      // Create tabs for search results if multiple terms are available
      const hasMultipleTerms = result.appAdsTxt.searchResults.termResults && 
                              result.appAdsTxt.searchResults.termResults.length > 1;
      
      let tabsHtml = '<div class="search-matches-tabs" role="tablist">';
      let tabContentsHtml = '';
      
      // "All Matches" tab (always present)
      const allTabId = `all-${detailsId}`;
      tabsHtml += `<button class="search-tab active" data-action="tab-switch" data-tab="${allTabId}" role="tab" aria-selected="true" aria-controls="${allTabId}" id="tab-${allTabId}">All Matches</button>`;
      
      // Generate the all matches tab content
      const allMatchingLinesHtml = result.appAdsTxt.searchResults.matchingLines
        .slice(0, 100) // Limit to 100 matches for performance
        .map(line => `
          <tr>
            <td>${line.lineNumber}</td>
            <td class="search-match-content">${this._highlightSearchTerms(
              line.content, 
              result.appAdsTxt.searchResults.terms || this.searchTerms
            )}</td>
          </tr>
        `).join('');
      
      // Search terms legend
      const searchTermsForLegend = result.appAdsTxt.searchResults.terms || this.searchTerms;
      const legendHtml = this._generateSearchTermLegend(searchTermsForLegend);
      
      tabContentsHtml += `
        <div id="${allTabId}" class="search-tab-content active" role="tabpanel" aria-labelledby="tab-${allTabId}">
          <div class="search-matches-count">
            <strong>Total matches:</strong> ${result.appAdsTxt.searchResults.count}
            ${legendHtml}
          </div>
          <div class="search-matches-list">
            <table class="search-matches-table">
              <thead>
                <tr>
                  <th scope="col">Line #</th>
                  <th scope="col">Content</th>
                </tr>
              </thead>
              <tbody>
                ${allMatchingLinesHtml}
                ${result.appAdsTxt.searchResults.matchingLines.length > 100 ? 
                  `<tr><td colspan="2">(${result.appAdsTxt.searchResults.matchingLines.length - 100} more matches not shown for performance)</td></tr>` : ''}
              </tbody>
            </table>
          </div>
        </div>
      `;
      
      // Add per-term tabs if available
      if (hasMultipleTerms) {
        result.appAdsTxt.searchResults.termResults.forEach((termResult, termIndex) => {
          if (termResult.count > 0) {
            const termTabId = `term-${termIndex}-${detailsId}`;
            const colorClass = `term-match-${termIndex % 5}`;
            
            tabsHtml += `<button class="search-tab ${colorClass}" data-action="tab-switch" data-tab="${termTabId}" role="tab" aria-selected="false" aria-controls="${termTabId}" id="tab-${termTabId}">${DOMUtils.escapeHtml(termResult.term)}</button>`;
            
            // Generate the term-specific tab content
            const termMatchingLinesHtml = termResult.matchingLines
              .slice(0, 100) // Limit to 100 matches for performance
              .map(line => `
                <tr>
                  <td>${line.lineNumber}</td>
                  <td class="search-match-content">${this._highlightSearchTerms(
                    line.content, 
                    [termResult.term]
                  )}</td>
                </tr>
              `).join('');
            
            tabContentsHtml += `
              <div id="${termTabId}" class="search-tab-content" role="tabpanel" aria-labelledby="tab-${termTabId}" aria-hidden="true">
                <div class="search-matches-count">
                  <strong>Matches for "${DOMUtils.escapeHtml(termResult.term)}":</strong> ${termResult.count}
                </div>
                <div class="search-matches-list">
                  <table class="search-matches-table">
                    <thead>
                      <tr>
                        <th scope="col">Line #</th>
                        <th scope="col">Content</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${termMatchingLinesHtml}
                      ${termResult.matchingLines.length > 100 ? 
                        `<tr><td colspan="2">(${termResult.matchingLines.length - 100} more matches not shown for performance)</td></tr>` : ''}
                    </tbody>
                  </table>
                </div>
              </div>
            `;
          }
        });
      }
      
      tabsHtml += '</div>'; // Close tabs container
      
      tempDiv.innerHTML += `
        <div id="search-${detailsId}" class="search-matches-details" style="display:none;">
          <h4>Search Matches in ${DOMUtils.escapeHtml(result.domain)}</h4>
          ${tabsHtml}
          ${tabContentsHtml}
        </div>
      `;
    }
    
    // Add to details container using document fragment for better performance
    const fragment = document.createDocumentFragment();
    while (tempDiv.firstChild) {
      fragment.appendChild(tempDiv.firstChild);
    }
    
    detailsContainer.appendChild(fragment);
  }
  
  /**
   * Highlight search terms in text
   * @param {string} text - Text to highlight
   * @param {string[]} terms - Search terms
   * @returns {string} - Highlighted HTML
   */
  _highlightSearchTerms(text, terms) {
    if (!text || !terms || !terms.length) {
      return DOMUtils.escapeHtml(text);
    }
    
    let escapedText = DOMUtils.escapeHtml(text);
    
    // Create positions array to avoid overlapping highlights
    const positions = [];
    
    terms.forEach((term, termIndex) => {
      if (!term) return;
      
      const termLower = term.toLowerCase();
      let textLower = text.toLowerCase();
      let lastIndex = 0;
      let startIndex;
      
      while ((startIndex = textLower.indexOf(termLower, lastIndex)) !== -1) {
        positions.push({
          start: startIndex,
          end: startIndex + term.length,
          termIndex: termIndex % 5 // Limit to 5 different colors
        });
        
        lastIndex = startIndex + termLower.length;
      }
    });
    
    // Sort positions by start index (descending) to avoid index shifts during replacement
    positions.sort((a, b) => b.start - a.start);
    
    // Apply highlights
    positions.forEach(pos => {
      const before = escapedText.substring(0, pos.start);
      const match = escapedText.substring(pos.start, pos.end);
      const after = escapedText.substring(pos.end);
      
      escapedText = `${before}<span class="search-highlight term-match-${pos.termIndex}">${match}</span>${after}`;
    });
    
    return escapedText;
  }
  
  /**
   * Generate search term legend
   * @param {string[]} terms - Search terms
   * @returns {string} - HTML for search term legend
   */
  _generateSearchTermLegend(terms) {
    if (!terms || !terms.length) return '';
    
    let html = '<div class="search-terms-legend"><strong>Search terms:</strong> ';
    
    terms.forEach((term, index) => {
      const colorClass = `term-match-${index % 5}`;
      html += `<span class="search-highlight ${colorClass}">${DOMUtils.escapeHtml(term)}</span> `;
    });
    
    html += '</div>';
    return html;
  }
  
  /**
   * Finalize UI after streaming is complete
   */
  _finalizeUI() {
    // Update summary stats one last time
    this._updateProgressUI();
    
    // Hide progress indicator
    const progressElement = document.getElementById('streamProgress');
    if (progressElement) {
      progressElement.style.display = 'none';
    }
    
    // Enable download button
    const downloadBtn = document.querySelector('[data-action="download-csv"]');
    if (downloadBtn) {
      downloadBtn.disabled = false;
    }
    
    // Set results in app state
    AppState.setResults(this.results);
    
    // Complete visual indicators
    const processingTime = Date.now() - this.stats.startTime;
    VisualIndicators.complete({
      processed: this.stats.processedCount,
      success: this.stats.successCount,
      errors: this.stats.errorCount,
      withAppAds: this.stats.withAppAdsTxtCount,
      total: this.stats.totalBundleIds
    });
    
    // Format the time in a more readable format
    const timeInSeconds = processingTime / 1000;
    const timeDisplay = timeInSeconds >= 60 
      ? `${(timeInSeconds / 60).toFixed(1)} minutes`
      : `${timeInSeconds.toFixed(1)} seconds`;
    
    // Add final status message
    VisualIndicators.setStatusMessage(
      `Completed processing ${this.stats.processedCount} bundle IDs (${this.stats.errorCount} errors) in ${timeDisplay}`,
      'success'
    );
    
    // Show completion notification
    const message = `Completed processing ${this.stats.processedCount} bundle IDs (${this.stats.errorCount} errors) in ${timeDisplay}`;
    showNotification(message, 'success');
  }
  
  /**
   * Reset state for a new streaming job
   */
  resetState() {
    this.stats = {
      processedCount: 0,
      successCount: 0,
      errorCount: 0,
      withAppAdsTxtCount: 0,
      startTime: 0,
      totalBundleIds: 0,
      lastRenderTime: 0
    };
    
    this.results = [];
    this.searchTerms = [];
    this.resultBuffer = [];
    this.lastRenderTime = 0;
    this.isRendering = false;
    
    // Cancel any pending animation frame
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
  
  /**
   * Handle messages from the web worker
   * @param {Object} message - Message from worker
   */
  _handleWorkerMessage(message) {
    const { type, data } = message;
    
    switch (type) {
      case 'initialize':
        this._initializeResultsUI(data.hasSearchTerms);
        break;
        
      case 'progress':
        // Update stats from worker
        this.stats.processedCount = data.processedCount;
        this.stats.successCount = data.successCount;
        this.stats.errorCount = data.errorCount;
        this.stats.withAppAdsTxtCount = data.withAppAdsTxtCount;
        
        // Update visual indicators
        VisualIndicators.updateProgress({
          processed: this.stats.processedCount,
          success: this.stats.successCount,
          errors: this.stats.errorCount,
          withAppAds: this.stats.withAppAdsTxtCount,
          total: this.stats.totalBundleIds
        });
        
        // Update status message periodically
        if (this.stats.processedCount % 10 === 0) {
          const percent = this.stats.totalBundleIds > 0 
            ? Math.round((this.stats.processedCount / this.stats.totalBundleIds) * 100)
            : 0;
          
          VisualIndicators.setStatusMessage(
            `Worker processing... ${percent}% complete (${this.stats.processedCount} of ${this.stats.totalBundleIds})`,
            'info'
          );
        }
        
        // Update legacy UI
        this._updateProgressUI();
        
        // Update progress bar with percentage if provided
        if (data.percent) {
          const progressElement = document.getElementById('streamProgress');
          if (progressElement) {
            const progressBar = progressElement.querySelector('.progress-bar > div');
            const progressText = progressElement.querySelector('.progress-text');
            
            if (progressBar) progressBar.style.width = `${data.percent}%`;
            if (progressText) progressText.textContent = `${data.percent}%`;
          }
        }
        break;
        
      case 'result':
        // Process individual result
        if (data.result) {
          this._processResult(data.result);
        }
        break;
        
      case 'complete':
        // Store final results
        this.results = data.results || this.results;
        
        // Update final stats
        this.stats.processedCount = data.processedCount || this.stats.processedCount;
        this.stats.successCount = data.successCount || this.stats.successCount;
        this.stats.errorCount = data.errorCount || this.stats.errorCount;
        this.stats.withAppAdsTxtCount = data.withAppAdsTxtCount || this.stats.withAppAdsTxtCount;
        
        // Finalize UI
        this._finalizeUI();
        break;
        
      case 'error':
        console.error('Worker error:', data.message);
        showNotification(`Worker error: ${data.message}`, 'error');
        VisualIndicators.showError(`Worker error: ${data.message}`);
        break;
    }
  }
  
  /**
   * Export results to CSV via streaming
   * @param {string[]} bundleIds - Bundle IDs
   * @param {string[]} searchTerms - Search terms
   */
  async exportCsv(bundleIds, searchTerms = []) {
    if (!bundleIds || !bundleIds.length) {
      showNotification('No bundle IDs to export', 'error');
      return;
    }
    
    // Get the results container to show progress
    const resultElement = DOMUtils.getElement('result');
    if (!resultElement) return;
    
    try {
      // Initialize visual indicators for export
      VisualIndicators.initialize({
        totalItems: bundleIds.length,
        containerSelector: resultElement,
        showDetails: false,
        animate: true
      });
      
      // Set initial status message
      VisualIndicators.setStatusMessage('Preparing CSV export stream...', 'info');
      showNotification('Starting CSV export stream...', 'info');
      
      // Create a download link
      const downloadLink = document.createElement('a');
      downloadLink.href = `/api/stream/export-csv?ts=${Date.now()}`; // Add timestamp to prevent caching
      downloadLink.download = `developer_domains_${new Date().toISOString().slice(0, 10)}.csv`;
      downloadLink.style.display = 'none';
      
      // Update visual progress indicators
      VisualIndicators.updateProgress({
        processed: 0,
        total: bundleIds.length
      });
      VisualIndicators.setStatusMessage('Connecting to server...', 'info');
      
      // Set up fetch for streaming response
      const response = await fetch('/api/stream/export-csv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ bundleIds, searchTerms })
      });
      
      if (!response.ok) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }
      
      // Update progress indicators
      VisualIndicators.updateProgress({
        processed: Math.floor(bundleIds.length * 0.1), // Show some progress
        total: bundleIds.length
      });
      VisualIndicators.setStatusMessage('Processing data on server...', 'info');
      
      // Get the blob from the response
      const blob = await response.blob();
      
      // Update progress to 80%
      VisualIndicators.updateProgress({
        processed: Math.floor(bundleIds.length * 0.8),
        total: bundleIds.length
      });
      VisualIndicators.setStatusMessage('Creating download file...', 'info');
      
      // Create object URL for the blob
      const url = URL.createObjectURL(blob);
      
      // Update progress to 90%
      VisualIndicators.updateProgress({
        processed: Math.floor(bundleIds.length * 0.9),
        total: bundleIds.length
      });
      
      // Set the link's href to the object URL
      downloadLink.href = url;
      
      // Append link to body and trigger click
      document.body.appendChild(downloadLink);
      downloadLink.click();
      
      // Clean up
      setTimeout(() => {
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(url);
      }, 100);
      
      // Complete the indicators
      VisualIndicators.complete({
        processed: bundleIds.length,
        total: bundleIds.length
      });
      VisualIndicators.setStatusMessage('CSV export complete! Download starting...', 'success');
      
      showNotification('CSV export complete', 'success');
    } catch (err) {
      console.error('CSV export error:', err);
      showNotification(`Export error: ${err.message}`, 'error');
      VisualIndicators.showError(`Export error: ${err.message}`);
    }
  }
}

// Export singleton instance
const streamingProcessor = new StreamingProcessor();
export default streamingProcessor;