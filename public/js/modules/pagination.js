/**
 * Pagination Manager Module
 * Handles pagination functionality
 */

import DOMUtils from './dom-utils.js';

/**
 * Pagination Manager Class
 */
class PaginationManager {
  /**
   * Render pagination controls
   * @param {Object} pagination - Pagination data
   * @returns {string} - HTML for pagination controls
   */
  renderPagination(pagination) {
    if (!pagination || !pagination.totalPages || pagination.totalPages <= 1) {
      return '';
    }
    
    const { currentPage, totalPages, totalItems, pageSize } = pagination;
    
    // Calculate which page numbers to show
    let pageNumbers = [];
    if (totalPages <= 7) {
      // Show all pages if there are 7 or fewer
      pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
    } else {
      // Always include first and last page
      pageNumbers.push(1);
      
      // Always include current page and pages +/- 1 from current
      const startRange = Math.max(2, currentPage - 1);
      const endRange = Math.min(totalPages - 1, currentPage + 1);
      
      // Add ellipsis if needed
      if (startRange > 2) {
        pageNumbers.push('...');
      }
      
      // Add the current range
      for (let i = startRange; i <= endRange; i++) {
        pageNumbers.push(i);
      }
      
      // Add ellipsis if needed
      if (endRange < totalPages - 1) {
        pageNumbers.push('...');
      }
      
      pageNumbers.push(totalPages);
    }
    
    // Create the pagination HTML
    let paginationHtml = `
      <div class="pagination-container">
        <div class="pagination-info">
          Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, totalItems)} of ${totalItems} results
        </div>
        <div class="pagination-controls">
    `;
    
    // Previous button
    paginationHtml += `
      <button class="pagination-btn ${currentPage === 1 ? 'disabled' : ''}" 
        data-action="pagination" data-page="${currentPage - 1}" 
        ${currentPage === 1 ? 'disabled' : ''} aria-label="Previous page">
        &laquo;
      </button>
    `;
    
    // Page numbers
    pageNumbers.forEach(page => {
      if (page === '...') {
        paginationHtml += `<span class="pagination-ellipsis">...</span>`;
      } else {
        paginationHtml += `
          <button class="pagination-btn ${currentPage === page ? 'active' : ''}" 
            data-action="pagination" data-page="${page}"
            aria-label="Page ${page}" ${currentPage === page ? 'aria-current="page"' : ''}>
            ${page}
          </button>
        `;
      }
    });
    
    // Next button
    paginationHtml += `
      <button class="pagination-btn ${currentPage === totalPages ? 'disabled' : ''}" 
        data-action="pagination" data-page="${currentPage + 1}" 
        ${currentPage === totalPages ? 'disabled' : ''} aria-label="Next page">
        &raquo;
      </button>
    `;
    
    paginationHtml += `
        </div>
      </div>
    `;
    
    return paginationHtml;
  }
  
  /**
   * Create custom pagination settings
   * @param {number} currentPage - Current page
   * @param {number} totalItems - Total number of items
   * @param {number} pageSize - Items per page
   * @returns {Object} - Pagination object
   */
  createPagination(currentPage, totalItems, pageSize) {
    const totalPages = Math.ceil(totalItems / pageSize);
    return {
      currentPage: Math.min(currentPage, totalPages),
      pageSize,
      totalPages,
      totalItems,
      hasNextPage: currentPage < totalPages,
      hasPrevPage: currentPage > 1,
      startItem: (currentPage - 1) * pageSize + 1,
      endItem: Math.min(currentPage * pageSize, totalItems)
    };
  }
  
  /**
   * Paginate an array of items
   * @param {Array} items - Array of items to paginate
   * @param {number} page - Current page
   * @param {number} pageSize - Items per page 
   * @returns {Object} - Paginated results
   */
  paginateItems(items, page, pageSize) {
    const currentPage = page || 1;
    const itemsPerPage = pageSize || 20;
    const totalItems = items.length;
    
    // Create pagination info
    const pagination = this.createPagination(currentPage, totalItems, itemsPerPage);
    
    // Get items for current page
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const paginatedItems = items.slice(startIndex, endIndex);
    
    return {
      items: paginatedItems,
      pagination
    };
  }
}

// Export singleton instance
const paginationManager = new PaginationManager();
export default paginationManager;