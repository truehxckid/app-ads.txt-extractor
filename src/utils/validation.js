/**
 * Input validation utilities for App-Ads.txt Extractor
 * Provides consistent validation across the application
 */

'use strict';

const { getLogger } = require('./logger');
const logger = getLogger('validation');

/**
 * Check if string is a numeric Roku Bundle ID
 * @param {string} id - Bundle ID to check
 * @returns {boolean} - Whether ID is a numeric Roku ID
 */
function isNumericRokuId(id) {
  if (!id || typeof id !== 'string') return false;
  return /^\d{4,6}$/.test(id.trim());
}

/**
 * Validate bundle ID
 * @param {string} id - Bundle ID to validate
 * @returns {string} - Validated and trimmed bundle ID
 * @throws {Error} - If validation fails
 */
function validateBundleId(id) {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid bundle ID: must be a non-empty string');
  }
  
  const trimmedId = id.trim();
  if (!trimmedId) {
    throw new Error('Invalid bundle ID: cannot be empty or whitespace');
  }
  
  // Ensure the ID doesn't contain potentially harmful characters
  if (/[<>"'&;]/.test(trimmedId)) {
    throw new Error('Invalid bundle ID: contains disallowed characters');
  }
  
  // Ensure the ID isn't excessively long
  if (trimmedId.length > 100) {
    throw new Error('Invalid bundle ID: exceeds maximum length (100 characters)');
  }
  
  return trimmedId;
}

/**
 * Validate search terms
 * @param {string|string[]|object[]} terms - Search terms to validate
 * @returns {(string|object)[]} - Array of validated search terms or null if no valid terms
 * @throws {Error} - If terms format is invalid
 */
function validateSearchTerms(terms) {
  if (!terms) return null;
  
  // Handle single string term
  if (typeof terms === 'string') {
    const trimmed = terms.toLowerCase().trim();
    return trimmed ? [trimmed] : null;
  }
  
  // Handle arrays (which may contain strings or objects with exactMatch)
  if (Array.isArray(terms)) {
    const validTerms = terms
      .filter(term => {
        // Check for valid string terms
        if (term && typeof term === 'string') return true;
        
        // Check for valid object terms with exactMatch property
        if (term && typeof term === 'object' && term.exactMatch && 
            typeof term.exactMatch === 'string' && term.exactMatch.trim()) {
          return true;
        }
        
        return false;
      })
      .map(term => {
        // Process string terms
        if (typeof term === 'string') {
          return term.toLowerCase().trim();
        }
        
        // Process object terms
        if (typeof term === 'object' && term.exactMatch) {
          return {
            exactMatch: term.exactMatch.toLowerCase().trim()
          };
        }
        
        return null;
      })
      .filter(Boolean);
    
    return validTerms.length > 0 ? validTerms : null;
  }
  
  // Handle single object with exactMatch property
  if (typeof terms === 'object' && terms.exactMatch && 
      typeof terms.exactMatch === 'string' && terms.exactMatch.trim()) {
    return [{
      exactMatch: terms.exactMatch.toLowerCase().trim()
    }];
  }
  
  throw new Error('Invalid search terms: must be a string, object with exactMatch, or array');
}

/**
 * Validate domain format
 * @param {string} domain - Domain to validate
 * @returns {boolean} - Whether domain format is valid
 */
function isValidDomain(domain) {
  if (!domain || typeof domain !== 'string') return false;
  
  // Basic domain validation regex
  // This checks for domain with at least one dot and valid characters
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(domain);
}

/**
 * Validate URL format
 * @param {string} url - URL to validate
 * @returns {boolean} - Whether URL format is valid
 */
function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (err) {
    return false;
  }
}

/**
 * Validate multiple bundle IDs
 * @param {string[]} bundleIds - Array of bundle IDs to validate
 * @param {number} maxCount - Maximum allowed number of bundle IDs
 * @returns {object} - Object with valid IDs and validation results
 */
function validateBundleIds(bundleIds, maxCount = 100) {
  if (!Array.isArray(bundleIds)) {
    throw new Error('Bundle IDs must be provided as an array');
  }
  
  // Filter and deduplicate bundle IDs
  const uniqueIds = [...new Set(
    bundleIds
      .filter(id => id && typeof id === 'string')
      .map(id => id.trim())
      .filter(Boolean)
  )];
  
  if (uniqueIds.length === 0) {
    throw new Error('No valid bundle IDs provided after filtering');
  }
  
  if (uniqueIds.length > maxCount) {
    throw new Error(`Too many bundle IDs. Maximum allowed is ${maxCount}`);
  }
  
  // Validate each ID
  const validationResults = uniqueIds.map(id => {
    try {
      return { 
        bundleId: id, 
        validatedId: validateBundleId(id),
        isValid: true 
      };
    } catch (error) {
      logger.debug({ bundleId: id, error: error.message }, 'Bundle ID validation failed');
      return { 
        bundleId: id, 
        error: error.message,
        isValid: false 
      };
    }
  });
  
  const validIds = validationResults
    .filter(result => result.isValid)
    .map(result => result.validatedId);
  
  return {
    validIds,
    results: validationResults,
    total: uniqueIds.length,
    valid: validIds.length,
    invalid: uniqueIds.length - validIds.length
  };
}

module.exports = {
  validateBundleId,
  validateSearchTerms,
  isValidDomain,
  isValidUrl,
  validateBundleIds,
  isNumericRokuId
};