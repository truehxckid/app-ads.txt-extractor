/**
 * Formatting utilities for App-Ads.txt Extractor
 * Provides helper functions for text formatting and display
 */

'use strict';

/**
 * Format large numbers with commas
 * @param {number} num - Number to format
 * @returns {string} - Formatted number
 */
function formatNumber(num) {
  if (typeof num !== 'number') {
    num = parseInt(num, 10);
    if (isNaN(num)) return '0';
  }
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format date to locale string
 * @param {Date|string|number} date - Date to format
 * @param {Object} options - Intl.DateTimeFormat options
 * @returns {string} - Formatted date
 */
function formatDate(date, options = {}) {
  if (!date) return '';
  
  try {
    const dateObj = typeof date === 'string' || typeof date === 'number' 
      ? new Date(date) 
      : date;
    
    const defaultOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    };
    
    return dateObj.toLocaleDateString(undefined, { ...defaultOptions, ...options });
  } catch (err) {
    console.error('Error formatting date:', err);
    return String(date);
  }
}

/**
 * Format file size in human-readable format
 * @param {number} bytes - File size in bytes
 * @param {number} decimals - Number of decimal places
 * @returns {string} - Formatted file size
 */
function formatFileSize(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Get store display name
 * @param {string} storeType - Store type identifier
 * @returns {string} - Display name
 */
function getStoreDisplayName(storeType) {
  const storeNames = {
    'googleplay': 'Google Play',
    'appstore': 'App Store',
    'amazon': 'Amazon',
    'roku': 'Roku',
    'samsung': 'Samsung',
    'unknown': 'Unknown'
  };
  
  return storeNames[storeType] || 'Unknown';
}

/**
 * Truncate text with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} - Truncated text
 */
function truncateText(text, maxLength = 100) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Format percentage
 * @param {number} value - Value to format
 * @param {number} decimals - Number of decimal places
 * @returns {string} - Formatted percentage
 */
function formatPercentage(value, decimals = 0) {
  if (typeof value !== 'number' || isNaN(value)) return '0%';
  return value.toFixed(decimals) + '%';
}

/**
 * Format time duration in ms to readable format
 * @param {number} ms - Time in milliseconds
 * @returns {string} - Formatted time
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

module.exports = {
  formatNumber,
  formatDate,
  formatFileSize,
  getStoreDisplayName,
  truncateText,
  formatPercentage,
  formatDuration
};