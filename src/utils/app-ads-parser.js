/**
 * App-Ads.txt Parser Utility
 * Provides utilities for parsing and querying app-ads.txt entries
 */

'use strict';

const { getLogger } = require('./logger');

const logger = getLogger('app-ads-parser');

/**
 * Parse a single app-ads.txt line into structured components
 * @param {string} line - A single line from an app-ads.txt file
 * @returns {Object|null} - Parsed components or null if invalid
 */
function parseAppAdsLine(line) {
  try {
    if (!line || typeof line !== 'string') {
      return null;
    }
    
    // Remove comments
    const commentIndex = line.indexOf('#');
    const cleanLine = commentIndex >= 0 ? line.substring(0, commentIndex).trim() : line.trim();
    
    if (!cleanLine) {
      return null; // Empty line or just a comment
    }
    
    // Split into fields using comma as separator
    let fields = cleanLine.split(',').map(f => f.trim());
    
    // Requires at least 3 fields per IAB spec
    if (fields.length < 3) {
      return null;
    }
    
    // Extract basic components
    const domain = fields[0].toLowerCase();
    const publisherId = fields[1].trim();
    const relationship = fields[2].toLowerCase();
    
    // Optional tag ID/auth ID (field 4)
    const tagId = fields.length > 3 ? fields[3].trim() : null;
    
    return {
      domain,
      publisherId, 
      relationship,
      tagId,
      raw: cleanLine
    };
  } catch (err) {
    logger.debug({ line, error: err.message }, 'Error parsing app-ads.txt line');
    return null;
  }
}

/**
 * Match a structured query against a parsed app-ads.txt entry
 * @param {Object} entry - Parsed app-ads.txt entry
 * @param {Object} query - Structured query (domain, publisherId, relationship, tagId)
 * @returns {boolean} - Whether the entry matches the query
 */
function matchStructuredQuery(entry, query) {
  if (!entry || !query) return false;
  
  // For each field in the query, check if it matches the entry
  for (const field of ['domain', 'publisherId', 'relationship', 'tagId']) {
    if (query[field] && query[field].trim()) {
      // Skip if field doesn't exist in entry (e.g., tagId might be null)
      if (entry[field] === null || entry[field] === undefined) {
        return false;
      }
      
      // Case-insensitive compare for string fields
      const queryValue = query[field].toLowerCase().trim();
      const entryValue = String(entry[field]).toLowerCase().trim();
      
      // For publisherId and tagId, normalize by removing all spaces
      // This solves the problem of "appnexus.com, 12447" vs "appnexus.com,12447"
      if (field === 'publisherId' || field === 'tagId') {
        const normalizedQuery = queryValue.replace(/\s+/g, '');
        const normalizedEntry = entryValue.replace(/\s+/g, '');
        
        if (normalizedQuery !== normalizedEntry) {
          return false;
        }
      } else if (field === 'relationship') {
        // Special handling for relationship field - partial match is okay
        // This allows searching for just "DIRECT" or "RESELLER" without case sensitivity
        if (!entryValue.includes(queryValue)) {
          return false;
        }
      } else if (entryValue !== queryValue) {
        // Exact match for other fields
        return false;
      }
    }
  }
  
  // If we get here, all specified fields in the query matched
  return true;
}

/**
 * Parse entire app-ads.txt content and search for structured query matches
 * @param {string} content - Full app-ads.txt content
 * @param {Object} query - Structured query object
 * @returns {Object} - Search results with matching entries
 */
function searchStructured(content, query) {
  try {
    if (!content || !query) {
      return {
        success: false,
        matches: [],
        count: 0,
        error: 'Invalid content or query'
      };
    }
    
    // Split content into lines - fix the regex pattern
    const lines = content.split(/\r?\n/);
    const matches = [];
    let lineNumber = 0;
    
    // Process each line
    for (const line of lines) {
      lineNumber++;
      
      // Parse the line
      const parsedLine = parseAppAdsLine(line);
      
      // If valid entry and matches query, add to results
      if (parsedLine && matchStructuredQuery(parsedLine, query)) {
        matches.push({
          lineNumber,
          content: line.trim(),
          parsedComponents: parsedLine
        });
      }
    }
    
    return {
      success: true,
      matches,
      count: matches.length
    };
  } catch (err) {
    logger.error({ error: err.message, query }, 'Error in structured search');
    return {
      success: false,
      matches: [],
      count: 0,
      error: err.message
    };
  }
}

module.exports = {
  parseAppAdsLine,
  matchStructuredQuery,
  searchStructured
};