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
    
    this.cssLoaded = false;
  }
  
  /**
   * Ensure CSS for visual indicators is loaded
   * @private
   */
  _ensureCssIsLoaded() {
    if (this.cssLoaded) return;
    
    // Check if CSS is already loaded
    const cssLinkExists = document.querySelector('link[href*="visual-indicators.css"]');
    if (!cssLinkExists) {
      console.info('Loading visual indicators CSS');
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/js/utils/visual-indicators.css';
      link.onload = () => {
        console.log('Visual indicators CSS loaded successfully');
        this.cssLoaded = true;
      };
      link.onerror = (err) => {
        console.error('Failed to load visual indicators CSS:', err);
        // Try an alternate path
        link.href = './js/utils/visual-indicators.css';
      };
      document.head.appendChild(link);
    }
    
    // Create keyframes if not already defined
    const keyframesExists = document.querySelector('style[data-visual-indicators="keyframes"]');
    if (!keyframesExists) {
      const keyframes = document.createElement('style');
      keyframes.setAttribute('data-visual-indicators', 'keyframes');
      keyframes.textContent = `
        @keyframes pulse {
          0% { box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
          100% { box-shadow: 0 0 12px rgba(52, 152, 219, 0.5); }
        }
        @keyframes dataFlow {
          0% { left: -30px; }
          100% { left: 100%; }
        }
      `;
      document.head.appendChild(keyframes);
    }
    
    this.cssLoaded = true;
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
    
    // Clear previous indicators
    this.clearIndicators();
    
    // Ensure CSS is loaded
    this._ensureCssIsLoaded();
    
    // Create indicator container
    const indicatorContainer = DOMUtils.createElement('div', {
      className: 'visual-indicators-container'
    });
    
    // Create progress bar
    const progressBar = this._createProgressBar();
    indicatorContainer.appendChild(progressBar);
    
    // Create status message
    const statusMessage = DOMUtils.createElement('div', {
      className: 'status-message info'
    }, 'Starting...');
    
    indicatorContainer.appendChild(statusMessage);
    
    // Store reference to status message
    this.indicatorElements.set('statusMessage', statusMessage);
    
    // Add detailed stats if needed
    if (showDetails) {
      const statsContainer = this._createStatsContainer();
      indicatorContainer.appendChild(statsContainer);
    }
    
    // Store references
    this.indicatorElements.set('container', indicatorContainer);
    
    // Add to DOM
    containerElement.prepend(indicatorContainer);
    
    // Add pulsing effect if animate is true
    if (animate) {
      indicatorContainer.classList.add('animated');
    }
    
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
    
    // Store references
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
    
    // Create stats counters with icon indicators
    const processedCounter = this._createCounter('processed', 'Processed', 0, '📊');
    const successCounter = this._createCounter('success', 'Success', 0, '✅');
    const errorCounter = this._createCounter('errors', 'Errors', 0, '❌');
    const appAdsCounter = this._createCounter('appAds', 'With app-ads.txt', 0, '📄');
    
    // Add rate indicator
    const rateIndicator = DOMUtils.createElement('div', {
      className: 'rate-indicator'
    }, 'Calculating rate...');
    this.indicatorElements.set('rateIndicator', rateIndicator);
    
    // Add estimated time remaining
    const timeRemaining = DOMUtils.createElement('div', {
      className: 'time-remaining'
    }, 'Estimating time...');
    this.indicatorElements.set('timeRemaining', timeRemaining);
    
    // Add all elements to stats container
    statsContainer.appendChild(processedCounter);
    statsContainer.appendChild(successCounter);
    statsContainer.appendChild(errorCounter);
    statsContainer.appendChild(appAdsCounter);
    statsContainer.appendChild(rateIndicator);
    statsContainer.appendChild(timeRemaining);
    
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
    // Update local stats with provided values
    Object.assign(this.stats, stats);
    
    // Calculate percentage
    let percent = 0;
    if (this.stats.total > 0) {
      percent = Math.min(100, Math.round((this.stats.processed / this.stats.total) * 100));
    } else {
      // If total unknown, use a time-based estimate (max 95%)
      const elapsed = Date.now() - this.stats.startTime;
      percent = Math.min(95, Math.round((elapsed / 60000) * 100));
    }
    
    // Update progress bar - with more robust error handling
    try {
      const progressBar = this.indicatorElements.get('progressBar');
      const progressPercentage = this.indicatorElements.get('progressPercentage');
      
      if (progressBar) {
        // Ensure the element is still in the DOM
        if (progressBar.isConnected) {
          progressBar.style.width = `${percent}%`;
          
          // Add classes based on percentage for visual effects
          if (percent > 25) progressBar.classList.add('quarter-complete');
          if (percent > 50) progressBar.classList.add('half-complete');
          if (percent > 75) progressBar.classList.add('three-quarter-complete');
          if (percent >= 100) progressBar.classList.add('complete');
        } else {
          console.warn('Progress bar element is no longer in the DOM');
          // Try to re-find the element
          const newProgressBar = document.querySelector('.progress-bar');
          if (newProgressBar) {
            this.indicatorElements.set('progressBar', newProgressBar);
            newProgressBar.style.width = `${percent}%`;
          }
        }
      } else {
        console.warn('Progress bar element not found in Map');
        // Try to find it directly in the DOM
        const domProgressBar = document.querySelector('.progress-bar');
        if (domProgressBar) {
          this.indicatorElements.set('progressBar', domProgressBar);
          domProgressBar.style.width = `${percent}%`;
        }
      }
      
      if (progressPercentage) {
        if (progressPercentage.isConnected) {
          progressPercentage.textContent = `${percent}%`;
        } else {
          console.warn('Progress percentage element is no longer in the DOM');
          // Try to re-find the element
          const newPercentage = document.querySelector('.completion-percentage');
          if (newPercentage) {
            this.indicatorElements.set('progressPercentage', newPercentage);
            newPercentage.textContent = `${percent}%`;
          }
        }
      } else {
        console.warn('Progress percentage element not found in Map');
        // Try to find it directly in the DOM
        const domPercentage = document.querySelector('.completion-percentage');
        if (domPercentage) {
          this.indicatorElements.set('progressPercentage', domPercentage);
          domPercentage.textContent = `${percent}%`;
        }
      }
      
      // Update counters
      this._updateCounters();
      
      // Update rate and time
      this._updateRateAndTime();
      
      // Animate data flow in the progress bar
      this._animateDataFlow();
      
      // Update fallback indicator if main one failed
      this._updateFallback();
      
    } catch (error) {
      console.error('Error updating visual indicators:', error);
      
      // Update fallback as last resort
      this._updateFallback();
    }
  }
  
  /**
   * Force update progress indicators with direct DOM manipulation
   * @param {Object} stats - Processing statistics
   */
  forceUpdate(stats = {}) {
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
    
    // Set progress to 100%
    const progressBar = this.indicatorElements.get('progressBar');
    const progressPercentage = this.indicatorElements.get('progressPercentage');
    
    if (progressBar) {
      progressBar.style.width = '100%';
      progressBar.classList.add('complete');
    }
    
    if (progressPercentage) {
      progressPercentage.textContent = '100%';
    }
    
    // Update counters one last time
    this._updateCounters();
    
    // Update status message
    this.setStatusMessage('Processing complete!', 'success');
    
    // Calculate final stats
    const elapsed = (Date.now() - this.stats.startTime) / 1000; // in seconds
    const totalProcessed = this.stats.processed;
    
    // Update rate indicator with total time
    const rateIndicator = this.indicatorElements.get('rateIndicator');
    if (rateIndicator) {
      rateIndicator.textContent = `Completed in ${elapsed.toFixed(1)}s`;
    }
    
    // Update time remaining
    const timeRemaining = this.indicatorElements.get('timeRemaining');
    if (timeRemaining) {
      const rate = elapsed > 0 ? totalProcessed / elapsed : 0;
      timeRemaining.textContent = `Average: ${rate.toFixed(1)} items/sec`;
    }
    
    // Cancel any animations
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    // Stop data flow animations
    const dataStripes = document.querySelectorAll('.data-stripe');
    dataStripes.forEach(stripe => {
      stripe.style.animation = 'none';
    });
    
    // Stop pulsing animation
    const container = this.indicatorElements.get('container');
    if (container) {
      container.classList.remove('animated');
    }
    
    // Update fallback if it exists
    if (this.fallbackIndicator) {
      this.fallbackIndicator.style.borderColor = '#27ae60';
      if (this.fallbackStatusText) {
        this.fallbackStatusText.textContent = 'Processing complete!';
      }
      if (this.fallbackProgressBar) {
        this.fallbackProgressBar.style.width = '100%';
      }
    }
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
}

export default StreamProgressUI;