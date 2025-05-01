/**
 * Visual Indicators Module
 * Provides real-time visual feedback for processing operations
 */

import DOMUtils from './dom-utils.js';
import { formatNumber } from '../utils/formatting.js';

/**
 * Visual Indicators Class
 * Manages and displays various visual indicators for processing status
 */
class VisualIndicators {
  constructor() {
    this.indicatorElements = new Map();
    this.animationFrameId = null;
    this.processingStats = {
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
   * Initialize visual indicators for processing
   * @param {Object} options - Configuration options
   * @param {number} options.totalItems - Total items to process
   * @param {string|HTMLElement} options.containerSelector - CSS selector or element for the container
   * @param {boolean} options.showDetails - Whether to show detailed stats
   * @param {boolean} options.animate - Whether to use animations
   */
  initialize(options = {}) {
    const { 
      totalItems = 0, 
      containerSelector = '#result', 
      showDetails = true, 
      animate = true 
    } = options;
    
    // Reset stats
    this.processingStats = {
      total: totalItems,
      processed: 0,
      success: 0,
      errors: 0,
      withAppAds: 0,
      startTime: Date.now()
    };
    
    // Get or create container
    let container;
    if (typeof containerSelector === 'string') {
      container = document.querySelector(containerSelector);
    } else if (containerSelector instanceof HTMLElement) {
      container = containerSelector;
    }
    
    // If container is still not found, try to get by ID
    if (!container) {
      console.warn('Container not found using selector, trying to get by ID: result');
      container = document.getElementById('result');
      
      if (!container) {
        console.error('Container not found, visual indicators will not be displayed');
        return false;
      }
    }
    
    // Make sure container is visible
    container.style.display = 'block';
    
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
    container.prepend(indicatorContainer);
    
    // Add pulsing effect if animate is true
    if (animate) {
      indicatorContainer.classList.add('animated');
    }
    
    console.log('Visual indicators initialized successfully');
    return true;
  }
  
  /**
   * Create progress bar element
   * @returns {HTMLElement} The progress bar element
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
   * Update progress indicators
   * @param {Object} stats - Current processing statistics
   */
  updateProgress(stats = {}) {
    // Debug logging
    console.log(`updateProgress called with: processed=${stats.processed}, total=${stats.total}`);
    
    // Update local stats with provided values
    Object.assign(this.processingStats, stats);
    
    // Calculate percentage
    let percent = 0;
    if (this.processingStats.total > 0) {
      percent = Math.min(100, Math.round((this.processingStats.processed / this.processingStats.total) * 100));
    } else {
      // If total unknown, use a time-based estimate (max 95%)
      const elapsed = Date.now() - this.processingStats.startTime;
      percent = Math.min(95, Math.round((elapsed / 60000) * 100));
    }
    
    console.log(`Progress calculated: ${percent}% (${this.processingStats.processed}/${this.processingStats.total})`);
    
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
    } catch (error) {
      console.error('Error updating visual indicators:', error);
      
      // Try direct DOM manipulation as fallback
      try {
        const directProgressBar = document.querySelector('.progress-bar');
        if (directProgressBar) {
          directProgressBar.style.width = `${percent}%`;
        }
        
        const directPercentage = document.querySelector('.completion-percentage');
        if (directPercentage) {
          directPercentage.textContent = `${percent}%`;
        }
      } catch (fallbackError) {
        console.error('Even direct DOM update failed:', fallbackError);
      }
    }
  }
  
  /**
   * Update statistics counters
   */
  _updateCounters() {
    // Update processed counter
    const processedCounter = this.indicatorElements.get('processedCounter');
    if (processedCounter) {
      processedCounter.textContent = formatNumber(this.processingStats.processed);
      
      // Add total if available
      if (this.processingStats.total > 0) {
        processedCounter.textContent += ` / ${formatNumber(this.processingStats.total)}`;
      }
    }
    
    // Update success counter
    const successCounter = this.indicatorElements.get('successCounter');
    if (successCounter) {
      successCounter.textContent = formatNumber(this.processingStats.success);
    }
    
    // Update errors counter
    const errorsCounter = this.indicatorElements.get('errorsCounter');
    if (errorsCounter) {
      errorsCounter.textContent = formatNumber(this.processingStats.errors);
    }
    
    // Update app-ads counter
    const appAdsCounter = this.indicatorElements.get('appAdsCounter');
    if (appAdsCounter) {
      appAdsCounter.textContent = formatNumber(this.processingStats.withAppAds);
    }
  }
  
  /**
   * Update processing rate and time remaining
   */
  _updateRateAndTime() {
    const rateIndicator = this.indicatorElements.get('rateIndicator');
    const timeRemaining = this.indicatorElements.get('timeRemaining');
    
    // Skip if elements don't exist
    if (!rateIndicator && !timeRemaining) return;
    
    // Calculate processing rate (items per second)
    const elapsed = (Date.now() - this.processingStats.startTime) / 1000; // in seconds
    const itemsPerSecond = elapsed > 0 ? this.processingStats.processed / elapsed : 0;
    
    // Update rate indicator
    if (rateIndicator) {
      rateIndicator.textContent = `${itemsPerSecond.toFixed(1)} items/sec`;
    }
    
    // Update time remaining if we know the total
    if (timeRemaining && this.processingStats.total > 0 && itemsPerSecond > 0) {
      const remaining = this.processingStats.total - this.processingStats.processed;
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
   * Animate data flow in the progress bar
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
    const percent = this.processingStats.total > 0 
      ? (this.processingStats.processed / this.processingStats.total)
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
    Object.assign(this.processingStats, finalStats);
    
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
    const elapsed = (Date.now() - this.processingStats.startTime) / 1000; // in seconds
    const totalProcessed = this.processingStats.processed;
    
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
    
    // Cancel any animations
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}

// Export singleton instance
const visualIndicators = new VisualIndicators();
export default visualIndicators;