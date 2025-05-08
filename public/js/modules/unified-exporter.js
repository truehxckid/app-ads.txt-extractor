/**
 * Unified Exporter Module
 * Consolidated CSV export functionality in a single maintainable module
 */

import AppState from './app-state.js';
import DOMUtils from './dom-utils.js';
import { showNotification } from '../utils/notification.js';
import Api from './api.js';

/**
 * UnifiedExporter Class
 * Handles all export functionality for the application
 */
class UnifiedExporter {
  constructor() {
    this._lastExportTime = null;
    this._exportInProgress = false;
  }

  /**
   * Export results to CSV
   * @param {string[]} bundleIds - Bundle IDs to export
   * @param {Object} params - Export parameters
   * @param {Object|Array} params.structuredParams - Advanced search parameters
   * @param {string} params.mode - Search mode (usually "advanced")
   * @param {Object} options - Export options
   * @param {boolean} options.useServer - Whether to use server-side generation (for large datasets)
   * @param {number} options.clientSizeLimit - Maximum number of bundle IDs for client-side export (default 500)
   * @returns {Promise<boolean>} - Success status
   */
  async exportToCSV(bundleIds, params = {}, options = {}) {
    // Prevent duplicate exports
    const now = Date.now();
    
    // Check global timestamp first (takes precedence)
    if (window._lastGlobalExportTime && (now - window._lastGlobalExportTime < 5000)) {
      showNotification('Export already in progress, please wait a few seconds', 'info');
      return false;
    }
    
    // Also check local timestamp as fallback
    if (this._lastExportTime && (now - this._lastExportTime < 5000)) {
      showNotification('Export already in progress, please wait a few seconds', 'info');
      return false;
    }
    
    // Set global timestamp to prevent duplicate exports
    window._lastGlobalExportTime = now;
    this._lastExportTime = now;
    this._exportInProgress = true;
    
    try {
      // Validate inputs
      if (!bundleIds || !bundleIds.length) {
        showNotification('No bundle IDs to export', 'error');
        this._resetExportState();
        return false;
      }
      
      // Process parameters
      const structuredParams = params.structuredParams || null;
      
      // Set default options
      const clientSizeLimit = options.clientSizeLimit || 500;
      const forceServerSide = options.useServer === true;
      
      // Determine if we should use server-side export
      const useServerSide = forceServerSide || bundleIds.length > clientSizeLimit;
      
      // Log export configuration for debugging
      console.log('UnifiedExporter: Export configuration', {
        bundleIds: bundleIds.length,
        params,
        structuredParams,
        useServerSide,
        forceServerSide,
        clientSizeLimit
      });
      
      // Get the results container to show progress
      const resultElement = DOMUtils.getElement('result');
      if (!resultElement) {
        showNotification('Results container not found', 'error');
        this._resetExportState();
        return false;
      }
      
      // Show starting notification
      showNotification('Preparing CSV export...', 'info');
      
      // Create progress indicator
      this._createProgressIndicator(resultElement);
      
      // Use appropriate export method based on dataset size
      if (useServerSide) {
        // SERVER-SIDE EXPORT (for large datasets)
        return await this._serverSideExport(bundleIds, structuredParams, resultElement);
      } else {
        // CLIENT-SIDE EXPORT (for normal datasets)
        return await this._clientSideExport(bundleIds, structuredParams, resultElement);
      }
    } catch (error) {
      console.error('CSV export error:', error);
      showNotification(`Export error: ${error.message}`, 'error');
      this._resetExportState();
      return false;
    }
  }
  
  /**
   * Perform client-side CSV export (for smaller datasets)
   * @param {string[]} bundleIds - Bundle IDs to export
   * @param {Object|Array} structuredParams - Structured search parameters
   * @param {HTMLElement} resultElement - Container for progress UI
   * @returns {Promise<boolean>} - Success status
   * @private
   */
  async _clientSideExport(bundleIds, structuredParams, resultElement) {
    try {
      // Update progress indicator
      this._updateProgressIndicator(0.1, 'Loading export data...');
      
      // Get the full set of results to export
      const results = window.AppState?.results || [];
      
      if (results.length === 0) {
        showNotification('No results available to export', 'warning');
        this._resetExportState();
        return false;
      }
      
      // Update progress indicator
      this._updateProgressIndicator(0.3, 'Generating CSV data...');
      
      // Create CSV content
      const csvContent = this._generateCSV(results, structuredParams);
      
      // Update progress
      this._updateProgressIndicator(0.8, 'Creating download file...');
      
      // Trigger download
      this._downloadCSV(csvContent);
      
      // Clean up and notify
      this._updateProgressIndicator(1.0, 'CSV export complete!');
      showNotification('CSV download started successfully', 'success');
      
      // Clean up after a delay
      setTimeout(() => {
        this._removeProgressIndicator();
        this._resetExportState();
      }, 3000);
      
      return true;
    } catch (error) {
      console.error('Client-side export error:', error);
      showNotification(`Export error: ${error.message}`, 'error');
      this._resetExportState();
      return false;
    }
  }
  
  /**
   * Perform server-side CSV export (for larger datasets)
   * @param {string[]} bundleIds - Bundle IDs to export
   * @param {Object|Array} structuredParams - Structured search parameters
   * @param {HTMLElement} resultElement - Container for progress UI
   * @returns {Promise<boolean>} - Success status
   * @private
   */
  async _serverSideExport(bundleIds, structuredParams, resultElement) {
    try {
      // Update progress indicator
      this._updateProgressIndicator(0.1, 'Connecting to server...');
      
      // Prepare search terms (for backward compatibility with API)
      // API expects either searchTerms array or structuredParams
      const searchTerms = [];
      
      // Prepare request data
      const requestData = {
        bundleIds,
        searchTerms,
        structuredParams: structuredParams
      };
      
      // Add existing results if available - server can use them instead of regenerating
      if (window.AppState?.results && window.AppState.results.length > 0) {
        requestData.existingResults = window.AppState.results;
      }
      
      // Update progress indicator
      this._updateProgressIndicator(0.2, 'Requesting export from server...');
      
      try {
        // Use the API module to make the server request
        const response = await fetch('/api/stream/export-csv', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/csv'
          },
          body: JSON.stringify(requestData)
        });
        
        // Check for successful response
        if (!response.ok) {
          // Try to get error message from response
          let errorMessage = 'Server error';
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || `Server error: ${response.status}`;
          } catch (e) {
            errorMessage = `Server error: ${response.status}`;
          }
          
          throw new Error(errorMessage);
        }
        
        // Update progress indicator
        this._updateProgressIndicator(0.5, 'Downloading CSV data...');
        
        // Get the CSV blob from response
        const csvBlob = await response.blob();
        
        // Update progress indicator
        this._updateProgressIndicator(0.8, 'Preparing download...');
        
        // Create and trigger download
        const url = window.URL.createObjectURL(csvBlob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `developer_domains_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        
        // Trigger download
        link.click();
        
        // Clean up the URL and link
        setTimeout(() => {
          window.URL.revokeObjectURL(url);
          document.body.removeChild(link);
        }, 100);
        
        // Update progress indicator
        this._updateProgressIndicator(1.0, 'CSV export complete!');
        showNotification('Server export completed successfully', 'success');
        
        // Clean up after a delay
        setTimeout(() => {
          this._removeProgressIndicator();
          this._resetExportState();
        }, 3000);
        
        return true;
      } catch (apiError) {
        // Specific error handling for API issues
        console.error('Server export API error:', apiError);
        
        // Try client-side export as fallback
        this._updateProgressIndicator(0.2, 'Server export failed, trying client-side export...');
        showNotification('Server export failed, trying client-side export instead', 'warning');
        
        // Wait a moment to show the message
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Try client-side export as fallback
        return await this._clientSideExport(bundleIds, structuredParams, resultElement);
      }
    } catch (error) {
      console.error('Server-side export error:', error);
      showNotification(`Export error: ${error.message}`, 'error');
      this._resetExportState();
      return false;
    }
  }
  
  /**
   * Reset export state variables
   * @private
   */
  _resetExportState() {
    window._lastGlobalExportTime = null;
    this._lastExportTime = null;
    this._exportInProgress = false;
  }
  
  /**
   * Create progress indicator in the UI
   * @param {HTMLElement} container - Container element
   * @private
   */
  _createProgressIndicator(container) {
    // Remove any existing indicators
    const existingIndicators = document.querySelectorAll('.export-progress-indicator');
    existingIndicators.forEach(el => el.remove());
    
    // Create new indicator
    const indicator = document.createElement('div');
    indicator.className = 'export-progress-indicator';
    indicator.style.cssText = 'margin: 15px 0; background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px; padding: 15px;';
    
    indicator.innerHTML = `
      <h3 style="margin-top: 0;">CSV Export Progress</h3>
      <div class="progress-bar-container" style="height: 20px; background: #e0e0e0; border-radius: 10px; overflow: hidden; margin: 10px 0;">
        <div class="progress-bar" style="height: 100%; width: 0%; background: #4caf50; transition: width 0.3s;"></div>
      </div>
      <div class="progress-status" style="text-align: center; font-size: 14px;">Preparing CSV export...</div>
    `;
    
    container.prepend(indicator);
  }
  
  /**
   * Update progress indicator
   * @param {number} progress - Progress value (0-1)
   * @param {string} message - Status message
   * @private
   */
  _updateProgressIndicator(progress, message) {
    const indicator = document.querySelector('.export-progress-indicator');
    if (!indicator) return;
    
    const progressBar = indicator.querySelector('.progress-bar');
    const statusText = indicator.querySelector('.progress-status');
    
    if (progressBar) {
      progressBar.style.width = `${Math.min(100, Math.round(progress * 100))}%`;
    }
    
    if (statusText && message) {
      statusText.textContent = message;
    }
  }
  
  /**
   * Remove progress indicator
   * @private
   */
  _removeProgressIndicator() {
    const indicator = document.querySelector('.export-progress-indicator');
    if (indicator && indicator.parentNode) {
      indicator.parentNode.removeChild(indicator);
    }
  }
  
  /**
   * Generate CSV content from results
   * @param {Array} results - Results array
   * @param {Object|Array} structuredParams - Advanced search parameters
   * @returns {string} - CSV content
   * @private
   */
  _generateCSV(results, structuredParams) {
    // Create CSV header
    let csvContent = "Bundle ID,Store,Domain,Has App-Ads.txt,App-Ads.txt URL,Advanced Search Results,Match Count,Matching Lines,Success,Error\n";
    
    // Process results in batches to avoid memory issues
    const BATCH_SIZE = 100;
    for (let i = 0; i < results.length; i += BATCH_SIZE) {
      const batch = results.slice(i, Math.min(i + BATCH_SIZE, results.length));
      
      for (const result of batch) {
        csvContent += this._formatResultRow(result, structuredParams);
      }
    }
    
    return csvContent;
  }
  
  /**
   * Format a single result as CSV row
   * @param {Object} result - Result object
   * @param {Object|Array} structuredParams - Advanced search parameters
   * @returns {string} - CSV row
   * @private
   */
  _formatResultRow(result, structuredParams) {
    if (!result) return '';
    
    // Helper function to escape CSV fields
    const escapeCSV = (field) => {
      if (field === null || field === undefined) return '';
      const str = String(field);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    
    // Extract basic data
    const hasAppAds = result.success && (result.hasAppAds || result.appAdsTxt?.exists);
    const store = result.storeType ? this._formatStoreDisplayName(result.storeType) : '';
    const domain = result.domain || '';
    const appAdsTxtUrl = hasAppAds && result.appAdsTxt?.url ? result.appAdsTxt.url : '';
    const success = result.success ? 'Yes' : 'No';
    const error = result.error || '';
    
    // Process advanced search results
    let advancedSearchInfo = '';
    let matchCount = '0';
    let matchingLinesSummary = '';
    
    // Check if we have structured params (advanced search)
    const isAdvancedSearch = structuredParams && (
      Array.isArray(structuredParams) ? structuredParams.length > 0 : 
      (typeof structuredParams === 'object' && Object.keys(structuredParams).length > 0)
    );
    
    // Always include search parameters for advanced search
    if (isAdvancedSearch) {
      const params = Array.isArray(structuredParams) ? structuredParams[0] : structuredParams;
      let searchDescription = '';
      if (params.domain) searchDescription += `${params.domain}`;
      if (params.publisherId) searchDescription += `${searchDescription ? " | " : ""}publisherId: ${params.publisherId}`;
      if (params.relationship) searchDescription += `${searchDescription ? " | " : ""}rel: ${params.relationship}`;
      if (params.tagId) searchDescription += `${searchDescription ? " | " : ""}tagId: ${params.tagId}`;
      advancedSearchInfo = searchDescription || "Advanced search";
    }
    
    // Check for matching search results
    if (hasAppAds && result.appAdsTxt?.searchResults) {
      const searchResults = result.appAdsTxt.searchResults;
      
      // Calculate real match count by counting unique matching lines
      const uniqueMatchingLines = new Set();
      
      // Collect all unique matching lines from all term results
      if (searchResults.termResults && searchResults.termResults.length > 0) {
        searchResults.termResults.forEach(tr => {
          if (tr.matches && tr.matches.length > 0) {
            tr.matches.forEach(match => uniqueMatchingLines.add(match));
          } else if (tr.matchingLines && tr.matchingLines.length > 0) {
            tr.matchingLines.forEach(line => {
              if (line.content) uniqueMatchingLines.add(line.content);
            });
          }
        });
      }
      
      // Use the number of unique matches instead of the raw count from server
      matchCount = String(uniqueMatchingLines.size || 0);
      
      // Process matching lines
      if (searchResults.termResults && searchResults.termResults.length > 0) {
        matchingLinesSummary = searchResults.termResults
          .map(tr => {
            if (tr.matches && tr.matches.length > 0) {
              return `${tr.term}: ${tr.matches.join(', ')}`;
            }
            return tr.term;
          })
          .join(' | ');
      }
    }
    
    // Also check for matchInfo format (used in some implementations)
    if (result.matchInfo) {
      // Calculate real match count by counting unique matching lines
      const uniqueMatchingLines = new Set();
      
      // Collect all unique matching lines from all term results
      if (result.matchInfo.termResults && result.matchInfo.termResults.length > 0) {
        result.matchInfo.termResults.forEach(tr => {
          if (tr.matches && tr.matches.length > 0) {
            tr.matches.forEach(match => uniqueMatchingLines.add(match));
          } else if (tr.matchingLines && tr.matchingLines.length > 0) {
            tr.matchingLines.forEach(line => {
              if (line.content) uniqueMatchingLines.add(line.content);
            });
          }
        });
      }
      
      // Use the number of unique matches
      matchCount = String(uniqueMatchingLines.size || 0);
      
      if (result.matchInfo.termResults && result.matchInfo.termResults.length > 0) {
        matchingLinesSummary = result.matchInfo.termResults
          .map(tr => {
            if (tr.matches && tr.matches.length > 0) {
              return `${tr.term}: ${tr.matches.join(', ')}`;
            }
            return tr.term;
          })
          .join(' | ');
      }
    }
    
    // Last resort - if structured params exists but no matching info was found,
    // add placeholder data to ensure columns appear
    if (isAdvancedSearch && !advancedSearchInfo) {
      const params = Array.isArray(structuredParams) ? structuredParams[0] : structuredParams;
      let searchDescription = '';
      if (params.domain) searchDescription += `${params.domain}`;
      if (params.publisherId) searchDescription += `${searchDescription ? " | " : ""}publisherId: ${params.publisherId}`;
      if (params.relationship) searchDescription += `${searchDescription ? " | " : ""}rel: ${params.relationship}`;
      if (params.tagId) searchDescription += `${searchDescription ? " | " : ""}tagId: ${params.tagId}`;
      advancedSearchInfo = searchDescription || "Advanced search parameters";
    }
    
    // Build and return CSV row
    return [
      escapeCSV(result.bundleId),
      escapeCSV(store),
      escapeCSV(domain),
      hasAppAds ? 'Yes' : 'No',
      escapeCSV(appAdsTxtUrl),
      escapeCSV(advancedSearchInfo),
      matchCount,
      escapeCSV(matchingLinesSummary),
      success,
      escapeCSV(error)
    ].join(',') + '\n';
  }
  
  /**
   * Format store display name
   * @param {string} storeType - Store type code
   * @returns {string} - Store display name
   * @private
   */
  _formatStoreDisplayName(storeType) {
    const storeMap = {
      'googleplay': 'Google Play',
      'appstore': 'App Store',
      'amazon': 'Amazon',
      'huawei': 'Huawei',
      'samsung': 'Samsung',
      'roku': 'Roku'
    };
    return storeMap[storeType.toLowerCase()] || storeType;
  }
  
  /**
   * Download CSV file
   * @param {string} csvContent - CSV content
   * @private
   */
  _downloadCSV(csvContent) {
    // Create blob from CSV content
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    // Create download link
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = `developer_domains_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadLink.style.display = 'none';
    document.body.appendChild(downloadLink);
    
    // Trigger download
    downloadLink.click();
    
    // Clean up
    setTimeout(() => {
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(url);
      showNotification('CSV download started', 'success');
    }, 100);
  }
}

// Export singleton instance
const unifiedExporter = new UnifiedExporter();
export default unifiedExporter;