/**
 * CSV Utilities
 * Provides functions for CSV parsing and processing
 */

/**
 * CSV Utilities Class
 */
class CSVUtils {
  /**
   * Parse CSV data with header detection
   * @param {string} csvData - CSV data
   * @returns {Object} - Parsed CSV data
   */
  parseCSV(csvData) {
    const lines = csvData.split(/\r\n|\n|\r/).filter(line => line.trim());
    
    if (lines.length === 0) {
      throw new Error('CSV file is empty');
    }
    
    // Detect delimiter by checking first line
    const firstLine = lines[0];
    let delimiter = ',';
    
    if (firstLine.includes('\t')) {
      delimiter = '\t';
    } else if (firstLine.includes(';')) {
      delimiter = ';';
    }
    
    // Parse header
    const header = firstLine.split(delimiter).map(col => col.trim());
    
    // Detect if first row is header (check if all fields are text-like)
    const hasHeader = !header.some(field => /^\d+$/.test(field));
    
    const startRow = hasHeader ? 1 : 0;
    const results = [];
    
    // If no header, generate column names
    const columnNames = hasHeader ? 
      header : Array.from({ length: header.length }, (_, i) => `Column${i + 1}`);
    
    // Parse data rows
    for (let i = startRow; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Split by delimiter and handle quoted fields
      const fields = this.splitCSVLine(line, delimiter);
      
      if (fields.length > 0) {
        const row = {};
        fields.forEach((field, index) => {
          if (index < columnNames.length) {
            row[columnNames[index]] = field.trim();
          }
        });
        results.push(row);
      }
    }
    
    return {
      data: results,
      header: columnNames,
      hasHeader,
      rowCount: results.length,
      delimiter
    };
  }
  
  /**
   * Split CSV line handling quotes properly
   * @param {string} line - CSV line
   * @param {string} delimiter - Delimiter
   * @returns {string[]} - Fields
   */
  splitCSVLine(line, delimiter = ',') {
    const fields = [];
    let currentField = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        // Check if it's an escaped quote
        if (i + 1 < line.length && line[i + 1] === '"') {
          currentField += '"';
          i++; // Skip the next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        fields.push(currentField);
        currentField = '';
      } else {
        currentField += char;
      }
    }
    
    // Add the last field
    fields.push(currentField);
    
    return fields;
  }
  
  /**
   * Find column containing bundle IDs
   * @param {string[]} header - CSV header fields
   * @returns {string} - Bundle ID column name
   */
  findBundleIdColumn(header) {
    // Common column names for bundle IDs
    const possibleColumns = [
      'bundle', 'bundle_id', 'bundleid', 'bundle id', 
      'id', 'app id', 'app_id', 'appid',
      'package', 'package_name', 'packagename', 'package name',
      'app', 'application'
    ];
    
    // First try exact matches
    for (const colName of header) {
      const lowerColName = colName.toLowerCase();
      if (possibleColumns.includes(lowerColName)) {
        return colName;
      }
    }
    
    // Then try partial matches
    for (const colName of header) {
      const lowerColName = colName.toLowerCase();
      if (possibleColumns.some(name => lowerColName.includes(name))) {
        return colName;
      }
    }
    
    // If no obvious column found, use first column
    if (header.length > 0) {
      return header[0];
    }
    
    throw new Error('Could not identify a column containing bundle IDs');
  }
  
  /**
   * Extract bundle IDs from CSV data
   * @param {Array<Object>} data - Parsed CSV data
   * @param {string} bundleIdColumn - Column containing bundle IDs
   * @returns {string[]} - Array of bundle IDs
   */
  extractBundleIds(data, bundleIdColumn) {
    if (!data || !Array.isArray(data) || data.length === 0) {
      throw new Error('No data to extract bundle IDs from');
    }
    
    if (!bundleIdColumn) {
      throw new Error('No bundle ID column specified');
    }
    
    // Extract bundle IDs, filtering out empty values
    const bundleIds = data
      .map(row => row[bundleIdColumn]?.trim())
      .filter(Boolean);
    
    // Remove duplicates
    const uniqueBundleIds = [...new Set(bundleIds)];
    
    return uniqueBundleIds;
  }
  
  /**
   * Convert array of objects to CSV string
   * @param {Array<Object>} data - Array of objects
   * @param {string[]} columns - Column names to include
   * @param {string[]} headers - Column headers (optional)
   * @returns {string} - CSV string
   */
  objectsToCSV(data, columns, headers = null) {
    if (!data || !columns) {
      throw new Error('Data and columns are required');
    }
    
    // Use provided headers or column names
    const headerRow = headers || columns;
    
    // Create CSV header
    let csv = headerRow.map(h => `"${String(h).replace(/"/g, '""')}"`).join(',') + '\n';
    
    // Add data rows
    data.forEach(item => {
      const row = columns.map(col => {
        const value = item[col] !== undefined ? item[col] : '';
        return typeof value === 'string' 
          ? `"${value.replace(/"/g, '""')}"`
          : String(value);
      });
      csv += row.join(',') + '\n';
    });
    
    return csv;
  }
}

// Export singleton instance
const csvUtils = new CSVUtils();
export default csvUtils;