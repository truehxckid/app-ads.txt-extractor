/**
 * CSV Exporter Module
 * Handles CSV export functionality
 */

import Api from './api.js';
import AppState from './app-state.js';
import DOMUtils from './dom-utils.js';
import { showNotification } from '../utils/notification.js';
import { getStoreDisplayName } from '../utils/formatting.js';

/**
 * CSV Exporter Class
 */
class CSVExporter {
  /**
   * Download visible results as CSV
   * @param {Array} results - Results data 
   */
  downloadResults(results) {
    if (!results || !results.length) {
      showNotification('No results to download', 'error');
      return;
    }
    
    try {
      showNotification('Preparing CSV for current page...', 'info');
      this.createAndDownloadCsv(results);
    } catch (err) {
      console.error('Error downloading CSV:', err);
      showNotification('Error creating CSV file', 'error');
    }
  }
  
  /**
   * Download all results via API
   * @param {string[]} bundleIds - Bundle IDs
   * @param {string[]} searchTerms - Search terms (for simple mode)
   * @param {Object} structuredParams - Structured search parameters (for advanced mode)
   */
  async downloadAllResults(bundleIds, searchTerms = [], structuredParams = null) {
    if (!bundleIds || !bundleIds.length) {
      showNotification('No bundle IDs to process', 'error');
      return;
    }
    
    try {
      showNotification('Requesting full dataset for CSV export...', 'info');
      
      // Determine the search mode based on parameters
      const isAdvancedMode = structuredParams !== null;
      console.log('📊 CSV Exporter: Using ' + (isAdvancedMode ? 'ADVANCED' : 'SIMPLE') + ' mode for export');
      
      // Call export API with appropriate parameters
      const response = await Api.exportCsv(bundleIds, searchTerms, structuredParams);
      
      if (!response.results || !response.results.length) {
        showNotification('No results received from server', 'error');
        return;
      }
      
      // Create and download CSV
      this.createAndDownloadCsv(response.results);
      
      // Show stats about the export
      showNotification(
        `CSV export completed with ${response.results.length} records (${response.errorCount} errors)`, 
        'success'
      );
    } catch (err) {
      console.error('Error exporting CSV:', err);
      
      // More detailed error message with potential solutions
      const errorMsg = err.message || 'Unknown error';
      const isNetworkError = errorMsg.includes('Network Error') || errorMsg.includes('Failed to fetch');
      
      if (isNetworkError) {
        showNotification(
          'Network error during export. Please check your connection and try again.',
          'error'
        );
      } else if (errorMsg.includes('Endpoint not found')) {
        showNotification(
          'Export error: The server doesn\'t support this feature yet. Please try the "Download Current Page" option instead.',
          'error'
        );
      } else {
        showNotification(`Export error: ${errorMsg}`, 'error');
      }
    }
  }
  
  /**
   * Create and download CSV file from results
   * @param {Array} results - Results to include in CSV
   */
  createAndDownloadCsv(results) {
    // Check if search was performed
    const hasSearchResults = results.some(r => r.success && r.appAdsTxt?.searchResults);
    const searchTerms = hasSearchResults && results.find(r => r.appAdsTxt?.searchResults)?.appAdsTxt.searchResults?.terms;
    
    // Create CSV header
    let csvHeader = "Bundle ID,Store,Domain,Has App-Ads.txt,App-Ads.txt URL";
    
    // Detect if we're dealing with advanced search parameters
    const isAdvancedSearch = results.some(r => 
      r.success && 
      r.appAdsTxt?.searchResults?.mode === 'advanced' &&
      r.appAdsTxt?.searchResults?.advancedParams
    );
    
    // Add search columns based on search mode
    let foundTerms = [];
    
    if (isAdvancedSearch) {
      // For advanced search, use a simplified header structure
      csvHeader += ",Advanced Search Results,Match Count,Matching Lines";
    } 
    else if (searchTerms && searchTerms.length > 0) {
      // For simple search, use a consolidated format
      // Instead of separate term columns, just add search-related columns
      csvHeader += ",Matches,Details";
    }
    
    // Complete the header
    csvHeader += ",Success,Error\n";
    
    // Create blob with stream-like approach for better memory usage
    const csvParts = [csvHeader];
    
    // Process in chunks to avoid memory issues with large datasets
    const CHUNK_SIZE = 100;
    for (let i = 0; i < results.length; i += CHUNK_SIZE) {
      let chunkCsv = '';
      const chunk = results.slice(i, Math.min(i + CHUNK_SIZE, results.length));
      
      for (const result of chunk) {
        const hasAppAds = result.success && result.appAdsTxt?.exists;
        
        // Basic columns
        const basicCols = [
          `"${(result.bundleId || '').replace(/"/g, '""')}"`,
          `"${(result.storeType ? getStoreDisplayName(result.storeType) : '').replace(/"/g, '""')}"`,
          `"${(result.domain || '').replace(/"/g, '""')}"`,
          hasAppAds ? "Yes" : "No",
          `"${(hasAppAds ? result.appAdsTxt.url : '').replace(/"/g, '""')}"`
        ].join(',');
        
        // Search columns
        let searchCols = '';
        
        // Detect if this result contains advanced search data
        const isAdvancedResult = hasAppAds && 
          result.appAdsTxt.searchResults?.mode === 'advanced' &&
          result.appAdsTxt.searchResults?.advancedParams;
        
        if (isAdvancedResult) {
          // Handle advanced search format
          const hasMatches = hasAppAds && result.appAdsTxt.searchResults?.count > 0;
          const matchCount = hasMatches ? result.appAdsTxt.searchResults.count : 0;
          
          // Format advanced search results
          let advancedSearchInfo = '';
          if (hasMatches && result.appAdsTxt.searchResults?.advancedParams) {
            const params = result.appAdsTxt.searchResults.advancedParams;
            
            // Format each parameter as a readable string
            if (Array.isArray(params)) {
              const paramStrings = params.map(param => {
                const parts = [];
                if (param.domain) parts.push(`domain: ${param.domain}`);
                if (param.publisherId) parts.push(`publisherId: ${param.publisherId}`);
                if (param.relationship) parts.push(`relationship: ${param.relationship}`);
                if (param.tagId) parts.push(`tagId: ${param.tagId}`);
                return parts.join(', ');
              });
              advancedSearchInfo = paramStrings.join(' | ');
            } else {
              // Single parameter object
              const parts = [];
              if (params.domain) parts.push(`domain: ${params.domain}`);
              if (params.publisherId) parts.push(`publisherId: ${params.publisherId}`);
              if (params.relationship) parts.push(`relationship: ${params.relationship}`);
              if (params.tagId) parts.push(`tagId: ${params.tagId}`);
              advancedSearchInfo = parts.join(', ');
            }
          }
          
          // Add advanced search info
          searchCols += `,${`"${advancedSearchInfo}"`}`;
          
          // Add match count
          searchCols += `,${matchCount}`;
          
          // Get matching lines
          let matchingLinesText = '';
          if (hasMatches && result.appAdsTxt.searchResults?.matchingLines) {
            const matchingLines = result.appAdsTxt.searchResults.matchingLines;
            if (matchingLines.length > 0) {
              const formattedLines = matchingLines.map(line => 
                `Line ${line.lineNumber}: ${line.content.replace(/"/g, '""')}`
              );
              
              // Limit to 5 lines
              const limitedLines = formattedLines.slice(0, 5).join(' | ');
              matchingLinesText = formattedLines.length > 5 ?
                `${limitedLines} (+ ${formattedLines.length - 5} more)` :
                limitedLines;
            }
          }
          
          // Add matching lines
          searchCols += `,${`"${matchingLinesText}"`}`;
        }
        else if (searchTerms && searchTerms.length > 0) {
          // Simplified logic for simple search
          const hasMatches = hasAppAds && result.appAdsTxt.searchResults?.count > 0;
          const matchCount = hasMatches ? result.appAdsTxt.searchResults.count : 0;
          
          // Add match count
          searchCols += `,${matchCount}`;
          
          // Add matching details in one column
          let matchDetails = '';
          if (hasMatches && result.appAdsTxt.searchResults?.termResults) {
            // Collect matches for each term into a summary string
            const termMatches = [];
            
            if (Array.isArray(result.appAdsTxt.searchResults.termResults)) {
              result.appAdsTxt.searchResults.termResults.forEach((termResult, index) => {
                if (termResult && termResult.count > 0 && searchTerms[index]) {
                  // Get the term display name
                  const term = typeof searchTerms[index] === 'object' ? 
                    searchTerms[index].exactMatch : searchTerms[index];
                    
                  termMatches.push(`"${term}": ${termResult.count} matches`);
                }
              });
            }
            
            // Create summary text of term matches
            if (termMatches.length > 0) {
              matchDetails = termMatches.join(' | ');
            }
            
            // Add sample matching lines if available
            if (matchDetails && result.appAdsTxt.searchResults.matchingLines?.length > 0) {
              const lines = result.appAdsTxt.searchResults.matchingLines;
              const lineSamples = lines.slice(0, 3).map(line => 
                `Line ${line.lineNumber}: ${line.content.replace(/"/g, '""')}`
              ).join(' | ');
              
              if (lineSamples) {
                matchDetails += ` | ${lineSamples}`;
                
                // Add indication if there are more lines
                if (lines.length > 3) {
                  matchDetails += ` (+ ${lines.length - 3} more lines)`;
                }
              }
            }
          }
          
          // Add matching details
          searchCols += `,${`"${matchDetails}"`}`;
        }
        
        // Status columns
        const statusCols = `,${result.success ? "Yes" : "No"},${`"${(result.error || '').replace(/"/g, '""')}"`}`;
        
        // Build the complete row
        chunkCsv += basicCols + searchCols + statusCols + "\n";
      }
      
      csvParts.push(chunkCsv);
    }
    
    // Create download link
    const blob = new Blob(csvParts, { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    // Set download attributes
    link.setAttribute('href', url);
    link.setAttribute('download', `developer_domains_${new Date().toISOString().slice(0, 10)}.csv`);
    
    // Trigger download and clean up
    document.body.appendChild(link);
    link.click();
    
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      showNotification(`CSV download started with ${results.length} records`, 'success');
    }, 100);
  }
}

// Export singleton instance
const csvExporter = new CSVExporter();
export default csvExporter;