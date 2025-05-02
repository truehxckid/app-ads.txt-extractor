/**
 * StreamProgressUI Module
 * Handles all visual progress indicators for streaming operations
 */

import DOMUtils from '../dom-utils.js';
import { formatNumber } from '../../utils/formatting.js';

/**
 * Stream Progress UI Class
 * Creates and updates progress indicators
 */
class StreamProgressUI {
  constructor() {
    this.indicatorElements = new Map();
    this.animationFrameId = null;
    this.fallbackIndicator = null;
    this.fallbackProgressBar = null;
    this.fallbackStatusText = null;
    
    this.stats = {
      total: 0,
      processed: 0,
      success: 0,
      errors: 0,
      withAppAds: 0,
      startTime: 0
    };
  }
  
  /**
   * Initialize progress UI
   * @param {Object} options - Configuration options
   * @param {number} options.totalItems - Total items to process
   * @param {HTMLElement|string} options.container - Container element or selector
   * @param {boolean} options.showDetails - Whether to show detailed stats
   * @param {boolean} options.animate - Whether to animate the indicators
   * @returns {boolean} - Success status
   */
  initialize(options = {}) {
    const { 
      totalItems = 0, 
      container = null, 
      showDetails = true, 
      animate = true 
    } = options;
    
    // First, check if we already have an active worker progress indicator
    // If so, remove all other progress indicators to prevent overlap
    const workerProgressIndicator = document.querySelector('.worker-processing-indicator');
    if (workerProgressIndicator) {
      console.log('Active worker progress indicator found, removing other progress indicators before initializing');
      
      // Remove any existing progress indicators except the worker indicator
      const otherProgressIndicators = document.querySelectorAll('.visual-indicators-container, .progress-indicator, #streamProgress');
      otherProgressIndicators.forEach(indicator => {
        if (indicator !== workerProgressIndicator && indicator.parentNode) {
          indicator.parentNode.removeChild(indicator);
        }
      });
      
      // If worker indicator exists, we shouldn't create a new progress UI
      console.log('Skipping new progress UI creation as worker indicator already exists');
      return false;
    }
    
    // Reset stats
    this.stats = {
      total: totalItems,
      processed: 0,
      success: 0,
      errors: 0,
      withAppAds: 0,
      startTime: Date.now()
    };
    
    // Get container
    let containerElement;
    if (typeof container === 'string') {
      containerElement = document.querySelector(container);
    } else if (container instanceof HTMLElement) {
      containerElement = container;
    } else {
      containerElement = document.getElementById('result');
    }
    
    // If container is still not found, try to get by ID
    if (!containerElement) {
      console.warn('Container not found, trying to get by ID: result');
      containerElement = document.getElementById('result');
      
      if (!containerElement) {
        console.error('Container not found, visual indicators will not be displayed');
        return false;
      }
    }
    
    // Make sure container is visible
    containerElement.style.display = 'block';
    
    // Perform a thorough cleanup of all existing UI elements
    this._cleanupAllPreviousIndicators(containerElement);
    
    // Clear previous indicators from our map
    this.clearIndicators();
    
    // We're no longer creating visual indicators at all
    // Just log that we're starting
    console.log('Starting processing without UI indicators');
    
    // Create a hidden container to store references if needed, but don't display it
    const dummyContainer = DOMUtils.createElement('div', {
      className: 'hidden-progress-reference'
    });
    dummyContainer.style.display = 'none';
    
    // Store dummy container reference
    this.indicatorElements.set('container', dummyContainer);
    
    // Add to DOM but keep hidden
    containerElement.appendChild(dummyContainer);
    
    console.log('Visual indicators initialized successfully');
    return true;
  }
  
  /**
   * Create a fallback indicator when the main one fails
   * @param {HTMLElement} container - Container element
   * @param {number} totalItems - Total items to process
   */
  createFallback(container, totalItems) {
    if (!container) return;
    
    // Create indicator container
    const indicator = document.createElement('div');
    indicator.className = 'fallback-indicator';
    indicator.style.cssText = 'margin-bottom: 20px; padding: 15px; border-radius: 8px; background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border: 1px solid #e0e0e0;';
    
    // Create content
    indicator.innerHTML = `
      <div style="margin-bottom: 10px; font-weight: bold;">Processing ${totalItems} bundle IDs</div>
      <div style="height: 20px; background: #f0f0f0; border-radius: 10px; overflow: hidden; margin-bottom: 10px;">
        <div class="fallback-progress-bar" style="height: 100%; width: 10%; background: linear-gradient(90deg, #3498db, #2980b9); transition: width 0.5s ease;"></div>
      </div>
      <div class="fallback-status-text">Starting process...</div>
    `;
    
    // Insert at the beginning of the container
    container.insertBefore(indicator, container.firstChild);
    
    // Store references
    this.fallbackIndicator = indicator;
    this.fallbackProgressBar = indicator.querySelector('.fallback-progress-bar');
    this.fallbackStatusText = indicator.querySelector('.fallback-status-text');
    
    console.log('Fallback indicator created');
  }
  
  /**
   * Create progress bar element
   * @returns {HTMLElement} The progress bar element
   * @private
   */
  _createProgressBar() {
    const barContainer = DOMUtils.createElement('div', {
      className: 'progress-bar-container'
    });
    
    const barWrapper = DOMUtils.createElement('div', {
      className: 'progress-bar-wrapper'
    });
    
    const bar = DOMUtils.createElement('div', {
      className: 'progress-bar'
    });
    
    // Create data visualizer stripes inside the bar
    const dataStripes = DOMUtils.createElement('div', {
      className: 'data-stripes'
    });
    
    // Add stripes to represent data chunks
    for (let i = 0; i < 4; i++) {
      const stripe = DOMUtils.createElement('div', {
        className: 'data-stripe'
      });
      dataStripes.appendChild(stripe);
    }
    
    // Add completion percentage
    const percentage = DOMUtils.createElement('span', {
      className: 'completion-percentage'
    }, '0%');
    
    bar.appendChild(dataStripes);
    barWrapper.appendChild(bar);
    barContainer.appendChild(barWrapper);
    barContainer.appendChild(percentage);
    
    // Store references in our map for easier access later
    this.indicatorElements.set('progressBar', bar);
    this.indicatorElements.set('progressPercentage', percentage);
    
    return barContainer;
  }
  
  /**
   * Create stats container
   * @returns {HTMLElement} The stats container element
   * @private
   */
  _createStatsContainer() {
    const statsContainer = DOMUtils.createElement('div', {
      className: 'stats-container'
    });
    
    // Create a flexbox layout for the stats
    statsContainer.style.display = 'grid';
    statsContainer.style.gridTemplateColumns = 'repeat(2, 1fr)';
    statsContainer.style.gridGap = '10px';
    statsContainer.style.margin = '15px 0';
    
    // Create stats counters with icon indicators
    const processedCounter = this._createCounter('processed', 'Processed', 0, '📊');
    const successCounter = this._createCounter('success', 'Success', 0, '✅');
    const errorCounter = this._createCounter('errors', 'Errors', 0, '❌');
    const appAdsCounter = this._createCounter('appAds', 'With app-ads.txt', 0, '📄');
    
    // Add rate indicator
    const rateIndicator = DOMUtils.createElement('div', {
      className: 'rate-indicator'
    }, 'Calculating rate...');
    rateIndicator.style.textAlign = 'right';
    this.indicatorElements.set('rateIndicator', rateIndicator);
    
    // Add estimated time remaining
    const timeRemaining = DOMUtils.createElement('div', {
      className: 'time-remaining'
    }, 'Estimating time...');
    timeRemaining.style.textAlign = 'right';
    this.indicatorElements.set('timeRemaining', timeRemaining);
    
    // Create a container for the bottom row (errors and app-ads)
    const bottomRowContainer = DOMUtils.createElement('div', {
      className: 'bottom-stats-row'
    });
    bottomRowContainer.style.gridColumn = '1 / span 2';
    bottomRowContainer.style.display = 'flex';
    bottomRowContainer.style.justifyContent = 'space-between';
    
    // Add elements to bottom row container
    bottomRowContainer.appendChild(errorCounter);
    bottomRowContainer.appendChild(appAdsCounter);
    
    // Add all elements to stats container in a grid layout
    statsContainer.appendChild(processedCounter);
    statsContainer.appendChild(rateIndicator);
    statsContainer.appendChild(successCounter);
    statsContainer.appendChild(timeRemaining);
    statsContainer.appendChild(bottomRowContainer);
    
    return statsContainer;
  }
  
  /**
   * Create a counter element with label and value
   * @param {string} id - Counter ID
   * @param {string} label - Counter label
   * @param {number} initialValue - Initial counter value
   * @param {string} icon - Counter icon
   * @returns {HTMLElement} The counter element
   * @private
   */
  _createCounter(id, label, initialValue = 0, icon = '') {
    const counter = DOMUtils.createElement('div', {
      className: `counter ${id}-counter`
    });
    
    // Add icon if provided
    if (icon) {
      const iconElement = DOMUtils.createElement('span', {
        className: 'counter-icon'
      }, icon);
      counter.appendChild(iconElement);
    }
    
    // Add label
    const labelElement = DOMUtils.createElement('span', {
      className: 'counter-label'
    }, label);
    
    // Add value
    const valueElement = DOMUtils.createElement('span', {
      className: 'counter-value'
    }, formatNumber(initialValue));
    
    counter.appendChild(labelElement);
    counter.appendChild(valueElement);
    
    // Store reference to value element
    this.indicatorElements.set(`${id}Counter`, valueElement);
    
    return counter;
  }
  
  /**
   * Update progress indicators with stats
   * @param {Object} stats - Processing statistics
   */
  updateProgress(stats = {}) {
    // Store stats without unnecessary logging to reduce console spam
    Object.assign(this.stats, stats);
    
    // Calculate percentage for logging purposes only
    let percent = 0;
    
    // If percent is directly provided in stats, use it
    if (typeof stats.percent === 'number') {
      percent = stats.percent;
    } else if (this.stats.total > 0) {
      // Calculate percentage based on processed/total
      percent = Math.min(100, Math.round((this.stats.processed / this.stats.total) * 100));
    }
    
    // Just log progress - no UI updates
    console.log(`Processing progress: ${percent}% (${this.stats.processed || 0} of ${this.stats.total || 0})`);
    
    // Update the worker indicator directly instead of using our own indicators
    const workerIndicator = document.querySelector('.worker-processing-indicator h3');
    if (workerIndicator) {
      workerIndicator.textContent = `⚙️ Worker Processing... ${percent}% complete (${this.stats.processed || 0} of ${this.stats.total || 0})`;
      
      // Also update the progress bar if it exists
      const workerProgressBar = document.querySelector('.worker-processing-indicator .progress-bar');
      if (workerProgressBar) {
        workerProgressBar.style.width = `${percent}%`;
      }
    }
  }
  
  /**
   * Force update progress indicators with direct DOM manipulation
   * @param {Object} stats - Processing statistics
   */
  forceUpdate(stats = {}) {
    console.log('⚡ StreamProgressUI.forceUpdate: Emergency direct DOM update with:', stats);
    
    // Update our stats
    this.updateProgress(stats);
    
    // Perform direct DOM updates to ensure the UI is updated
    try {
      // Calculate percent
      const percent = this.stats.total > 0 
        ? Math.min(100, Math.round((this.stats.processed / this.stats.total) * 100))
        : 0;
      
      // DIRECT DOM UPDATES - Find all processing indicators and hide them
      const processingIndicators = document.querySelectorAll('.processing-indicator');
      processingIndicators.forEach(indicator => {
        indicator.style.display = 'none';
      });
      
      // Update main progress bar element directly
      const mainProgressBar = document.querySelector('.visual-indicators-container .progress-bar');
      if (mainProgressBar) {
        mainProgressBar.style.width = `${percent}%`;
      } else {
        // Try broader selectors
        const anyProgressBar = document.querySelector('.progress-bar');
        if (anyProgressBar) {
          anyProgressBar.style.width = `${percent}%`;
        }
      }
      
      // Stream progress container - check if it exists, create if not
      let streamProgressBar = document.querySelector('#streamProgress .progress-bar > div');
      const streamProgress = document.getElementById('streamProgress');
      
      if (!streamProgress) {
        // Create progress element if it doesn't exist
        const progressElem = document.createElement('div');
        progressElem.id = 'streamProgress';
        progressElem.className = 'progress-indicator';
        progressElem.style.display = 'flex';
        progressElem.style.margin = '10px 0';
        progressElem.innerHTML = `
          <div class="progress-bar" style="flex: 1; background: #f0f0f0; border-radius: 4px; overflow: hidden; height: 20px; margin-right: 10px;">
            <div style="height: 100%; width: ${percent}%; background: linear-gradient(90deg, #3498db, #2980b9); transition: width 0.3s ease;"></div>
          </div>
          <span class="progress-text" style="font-size: 14px; white-space: nowrap;">${percent}% (${this.stats.processed}/${this.stats.total})</span>
        `;
        
        // Insert into result container
        const resultElement = document.getElementById('result');
        if (resultElement) {
          const insertBefore = resultElement.querySelector('.results-table-container') || resultElement.firstChild;
          resultElement.insertBefore(progressElem, insertBefore);
          streamProgressBar = progressElem.querySelector('.progress-bar > div');
        }
      } else if (streamProgressBar) {
        streamProgressBar.style.width = `${percent}%`;
        
        const streamPercentText = document.querySelector('#streamProgress .progress-text');
        if (streamPercentText) {
          streamPercentText.textContent = `${percent}% (${this.stats.processed}/${this.stats.total})`;
        }
      }
    } catch (err) {
      console.error('Error during direct DOM update:', err);
    }
  }
  
  /**
   * Update fallback progress indicator
   * @private
   */
  _updateFallback() {
    // If no fallback, skip
    if (!this.fallbackProgressBar || !this.fallbackStatusText) return;
    
    // Calculate percentage
    let percent = 0;
    if (this.stats.total > 0) {
      percent = Math.min(100, Math.round((this.stats.processed / this.stats.total) * 100));
    } else {
      // If total unknown, use a time-based estimate (max 95%)
      const elapsed = Date.now() - this.stats.startTime;
      percent = Math.min(95, Math.round((elapsed / 60000) * 100));
    }
    
    // Update progress bar
    this.fallbackProgressBar.style.width = `${percent}%`;
    
    // Update status text
    this.fallbackStatusText.textContent = `Processing... ${percent}% complete (${this.stats.processed} of ${this.stats.total})`;
    
    // Add completion class if done
    if (percent >= 100) {
      this.fallbackIndicator.style.borderColor = '#27ae60';
      this.fallbackStatusText.textContent = 'Processing complete!';
    }
  }
  
  /**
   * Update statistics counters
   * @private
   */
  _updateCounters() {
    // Update processed counter
    const processedCounter = this.indicatorElements.get('processedCounter');
    if (processedCounter) {
      processedCounter.textContent = formatNumber(this.stats.processed);
      
      // Add total if available
      if (this.stats.total > 0) {
        processedCounter.textContent += ` / ${formatNumber(this.stats.total)}`;
      }
    }
    
    // Update success counter
    const successCounter = this.indicatorElements.get('successCounter');
    if (successCounter) {
      successCounter.textContent = formatNumber(this.stats.success);
    }
    
    // Update errors counter
    const errorsCounter = this.indicatorElements.get('errorsCounter');
    if (errorsCounter) {
      errorsCounter.textContent = formatNumber(this.stats.errors);
    }
    
    // Update app-ads counter
    const appAdsCounter = this.indicatorElements.get('appAdsCounter');
    if (appAdsCounter) {
      appAdsCounter.textContent = formatNumber(this.stats.withAppAds);
    }
  }
  
  /**
   * Update processing rate and time remaining
   * @private
   */
  _updateRateAndTime() {
    const rateIndicator = this.indicatorElements.get('rateIndicator');
    const timeRemaining = this.indicatorElements.get('timeRemaining');
    
    // Skip if elements don't exist
    if (!rateIndicator && !timeRemaining) return;
    
    // Calculate processing rate (items per second)
    const elapsed = (Date.now() - this.stats.startTime) / 1000; // in seconds
    const itemsPerSecond = elapsed > 0 ? this.stats.processed / elapsed : 0;
    
    // Update rate indicator
    if (rateIndicator) {
      rateIndicator.textContent = `${itemsPerSecond.toFixed(1)} items/sec`;
      rateIndicator.style.textAlign = 'right'; // Right align for better visual alignment
    }
    
    // Update time remaining if we know the total
    if (timeRemaining && this.stats.total > 0 && itemsPerSecond > 0) {
      const remaining = this.stats.total - this.stats.processed;
      const remainingSecs = Math.round(remaining / itemsPerSecond);
      
      if (remainingSecs > 0) {
        if (remainingSecs > 60) {
          const mins = Math.floor(remainingSecs / 60);
          const secs = remainingSecs % 60;
          timeRemaining.textContent = `${mins}m ${secs}s remaining`;
        } else {
          timeRemaining.textContent = `${remainingSecs}s remaining`;
        }
      } else {
        timeRemaining.textContent = 'Finishing up...';
      }
      timeRemaining.style.textAlign = 'right'; // Right align for better visual alignment
    }
  }
  
  /**
   * Animate data flow in the progress bar for visual feedback
   * @private
   */
  _animateDataFlow() {
    // Cancel any existing animation
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    // Get data stripes
    const dataStripes = document.querySelectorAll('.data-stripe');
    if (!dataStripes.length) return;
    
    // Apply animation based on progress
    const percent = this.stats.total > 0 
      ? (this.stats.processed / this.stats.total)
      : 0.5; // Default to 50% if no total
    
    // Speed up animation as progress increases
    const baseSpeed = 1000; // ms
    const minSpeed = 300; // ms
    const speed = Math.max(minSpeed, baseSpeed * (1 - percent * 0.7));
    
    // Animate each stripe with varying delay
    dataStripes.forEach((stripe, index) => {
      // Apply css animation with custom properties
      stripe.style.setProperty('--flow-duration', `${speed}ms`);
      stripe.style.setProperty('--flow-delay', `${index * 250}ms`);
      
      // Reset animation
      stripe.style.animation = 'none';
      
      // Force reflow
      void stripe.offsetWidth;
      
      // Apply new animation (using the CSS variables)
      stripe.style.animation = 'dataFlow var(--flow-duration) var(--flow-delay) infinite';
    });
  }
  
  /**
   * Set status message
   * @param {string} message - Status message
   * @param {string} type - Message type (info, success, warning, error)
   */
  setStatusMessage(message, type = 'info') {
    const statusMessage = this.indicatorElements.get('statusMessage');
    if (!statusMessage) return;
    
    // Remove previous status types
    statusMessage.classList.remove('info', 'success', 'warning', 'error');
    
    // Add new status message and type
    statusMessage.textContent = message;
    statusMessage.classList.add(type);
  }
  
  /**
   * Complete the processing and update indicators
   * @param {Object} finalStats - Final processing statistics
   */
  complete(finalStats = {}) {
    // Update stats with final values
    Object.assign(this.stats, finalStats);
    
    // Final update to worker indicator
    const workerIndicator = document.querySelector('.worker-processing-indicator h3');
    if (workerIndicator) {
      workerIndicator.textContent = `✅ Processing Complete (${this.stats.processed || 0} of ${this.stats.total || 0})`;
      
      // Update the progress bar to 100%
      const workerProgressBar = document.querySelector('.worker-processing-indicator .progress-bar');
      if (workerProgressBar) {
        workerProgressBar.style.width = '100%';
        workerProgressBar.style.background = '#2ecc71'; // Change to green for completion
      }
    }
    
    // Calculate elapsed time for logging
    const elapsed = (Date.now() - this.stats.startTime) / 1000; // in seconds
    console.log(`Processing complete! Processed ${this.stats.processed} items in ${elapsed.toFixed(1)} seconds`);
  }
  
  /**
   * Show error in indicators
   * @param {string} errorMessage - Error message
   */
  showError(errorMessage) {
    // Set status message
    this.setStatusMessage(errorMessage, 'error');
    
    // Add error class to container
    const container = this.indicatorElements.get('container');
    if (container) {
      container.classList.add('error');
      container.classList.remove('animated');
    }
    
    // Stop animations
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    // Stop data flow animations
    const dataStripes = document.querySelectorAll('.data-stripe');
    dataStripes.forEach(stripe => {
      stripe.style.animation = 'none';
    });
    
    // Update fallback if it exists
    if (this.fallbackIndicator) {
      this.fallbackIndicator.style.borderColor = '#e74c3c';
      if (this.fallbackStatusText) {
        this.fallbackStatusText.textContent = `Error: ${errorMessage}`;
      }
    }
  }
  
  /**
   * Clear all indicators
   */
  clearIndicators() {
    // Clear element references except the container
    const container = this.indicatorElements.get('container');
    this.indicatorElements.clear();
    
    // Remove container from DOM if it exists
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    
    // Remove fallback indicator if it exists
    if (this.fallbackIndicator && this.fallbackIndicator.parentNode) {
      this.fallbackIndicator.parentNode.removeChild(this.fallbackIndicator);
      this.fallbackIndicator = null;
      this.fallbackProgressBar = null;
      this.fallbackStatusText = null;
    }
    
    // Cancel any animations
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
  
  /**
   * Clean up all previous indicators and UI elements
   * @param {HTMLElement} container - Container element
   * @private
   */
  _cleanupAllPreviousIndicators(container) {
    console.log('StreamProgressUI: Cleaning up all previous indicators');
    
    if (!container) return;
    
    // Check if worker indicator exists - if so, we should preserve it
    // and remove other indicators to prevent overlap
    const workerIndicator = document.querySelector('.worker-processing-indicator');
    
    // List of all selectors to clean up
    const selectorsToRemove = [
      '.progress-indicator',
      '.visual-indicators-container',
      '.streaming-info-banner:not(.worker-processing-indicator)', // Don't remove worker indicator
      '.processing-indicator',
      '.streaming-mode-indicator',
      '.streaming-confirmation',
      '.completion-banner',
      '.streaming-completion-banner',
      '#streamProgress',
      '.completion-percentage',
      '.progress-bar-container',
      '.status-message',
      '.rate-indicator',
      '.time-remaining',
      '.counter'
    ];
    
    // First, check the container for these elements
    selectorsToRemove.forEach(selector => {
      const elements = container.querySelectorAll(selector);
      elements.forEach(element => {
        // Do not remove the worker indicator - we want to keep it visible
        if (!workerIndicator || element !== workerIndicator) {
          console.log(`StreamProgressUI: Removing ${selector} from container`);
          element.remove();
        }
      });
    });
    
    // Then, check the entire document for these elements
    // (some might have been added outside the container)
    selectorsToRemove.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(element => {
        // Do not remove the worker indicator - we want to keep it visible
        if (!workerIndicator || element !== workerIndicator) {
          console.log(`StreamProgressUI: Removing ${selector} from document`);
          element.remove();
        }
      });
    });
    
    // Also clean up any elements with progress-related text content
    const allElements = container.querySelectorAll('*');
    allElements.forEach(element => {
      // Skip the worker indicator - do not remove it
      if (workerIndicator && (element === workerIndicator || workerIndicator.contains(element))) {
        return;
      }
      
      if (element.textContent && (
          element.textContent.includes('Processing...') || 
          element.textContent.includes('Sending request') ||
          element.textContent.includes('Worker Processing'))) {
        console.log('StreamProgressUI: Removing element with progress text');
        element.remove();
      }
    });
  }
}

// Create and export a singleton instance
const streamProgressUI = new StreamProgressUI();
export default streamProgressUI;