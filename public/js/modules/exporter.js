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
   * @param {string[]} searchTerms - Search terms
   */
  async downloadAllResults(bundleIds, searchTerms) {
    if (!bundleIds || !bundleIds.length) {
      showNotification('No bundle IDs to process', 'error');
      return;
    }
    
    try {
      showNotification('Requesting full dataset for CSV export...', 'info');
      
      // Call export API
      const response = await Api.exportCsv(bundleIds, searchTerms);
      
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
    
    // Add search columns if needed
    if (searchTerms && searchTerms.length > 0) {
      // First add a column for each search term's presence
      searchTerms.forEach((term, index) => {
        const termDisplay = typeof term === 'object' ? term.exactMatch : term;
        csvHeader += `,Term ${index + 1} (${termDisplay})`;
      });
      
      // Then add columns for each search term's matching lines
      searchTerms.forEach((term, index) => {
        const termDisplay = typeof term === 'object' ? term.exactMatch : term;
        csvHeader += `,Term ${index + 1} Lines`;
      });
      
      csvHeader += `,Total Matches`;
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
        if (searchTerms && searchTerms.length > 0) {
          const hasMatches = hasAppAds && result.appAdsTxt.searchResults?.count > 0;
          const matchCount = hasMatches ? result.appAdsTxt.searchResults.count : 0;
          
          // First add term presence columns
          searchTerms.forEach((term, index) => {
            const termValue = typeof term === 'object' ? term.exactMatch : term;
            
            if (hasMatches && result.appAdsTxt.searchResults?.termResults) {
              // Get the specific term result if available
              const termResult = result.appAdsTxt.searchResults.termResults[index];
              const hasTermMatches = termResult && termResult.count > 0;
              searchCols += `,${hasTermMatches ? "Yes" : "No"}`;
            } else {
              searchCols += ",No";
            }
          });
          
          // Then add term matching lines columns
          searchTerms.forEach((term, index) => {
            if (hasMatches && result.appAdsTxt.searchResults?.termResults) {
              // Get the specific term result if available
              const termResult = result.appAdsTxt.searchResults.termResults[index];
              
              if (termResult && termResult.matchingLines && termResult.matchingLines.length > 0) {
                // Limit to first 5 matches per term
                const termLines = termResult.matchingLines
                  .slice(0, 5)
                  .map(line => `Line ${line.lineNumber}: ${line.content.replace(/"/g, '""')}`)
                  .join(' | ');
                
                const termLinesSummary = termResult.matchingLines.length > 5 ?
                  `${termLines} (+ ${termResult.matchingLines.length - 5} more)` :
                  termLines;
                
                searchCols += `,${`"${termLinesSummary}"`}`;
              } else {
                searchCols += `,""`;
              }
            } else {
              searchCols += `,""`;
            }
          });
          
          // Add total match count
          searchCols += `,${matchCount}`;
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