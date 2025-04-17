/**
 * Filesystem utilities for App-Ads.txt Extractor
 * Provides helper functions for directory and file operations
 */

'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const zlib = require('zlib');
const crypto = require('crypto');
const { getLogger } = require('./logger');

const logger = getLogger('fs');

// Promisify zlib functions
const gzip = util.promisify(zlib.gzip);
const gunzip = util.promisify(zlib.gunzip);

/**
 * Create directories if they don't exist
 * @param {string[]} directories - Array of directory paths to create
 */
function createDirs(directories) {
  if (!Array.isArray(directories)) {
    directories = [directories];
  }
  
  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        logger.debug({ directory: dir }, 'Created directory');
      } catch (err) {
        logger.error({ err, directory: dir }, 'Failed to create directory');
        throw err;
      }
    }
  });
}

/**
 * Convert a key/identifier to a safe filename
 * @param {string} key - Key to convert to filename
 * @returns {string} - MD5 hash as filename
 */
function keyToFilename(key) {
  const safeKey = typeof key === 'string' ? key : String(key);
  return crypto.createHash('md5').update(safeKey).digest('hex') + '.json';
}

/**
 * Save data to file with compression option
 * @param {string} filePath - Path to save the file
 * @param {object|string} data - Data to save
 * @param {boolean} compress - Whether to compress the data
 * @returns {Promise<boolean>} - Success status
 */
async function saveToFile(filePath, data, compress = false) {
  try {
    // Convert data to string if it's an object
    const stringData = typeof data === 'string' 
      ? data 
      : JSON.stringify(data);
    
    // Create the directory if it doesn't exist
    const dirPath = path.dirname(filePath);
    createDirs([dirPath]);
    
    // Use a temporary file and rename to avoid partial writes
    const tempFilePath = `${filePath}.tmp`;
    
    if (compress && stringData.length > 1000) {
      // Compress data for large strings
      const compressedData = await gzip(Buffer.from(stringData));
      fs.writeFileSync(`${tempFilePath}.gz`, compressedData);
      fs.renameSync(`${tempFilePath}.gz`, `${filePath}.gz`);
      return true;
    } else {
      // Write without compression for smaller strings
      fs.writeFileSync(tempFilePath, stringData);
      fs.renameSync(tempFilePath, filePath);
      return true;
    }
  } catch (err) {
    logger.error({ err, filePath }, 'Error saving file');
    return false;
  }
}

/**
 * Read data from file with decompression support
 * @param {string} filePath - Path to read the file from
 * @param {boolean} isJson - Whether to parse the content as JSON
 * @returns {Promise<any>} - File data
 */
async function readFromFile(filePath, isJson = true) {
  try {
    // Check if compressed version exists
    if (fs.existsSync(`${filePath}.gz`)) {
      const compressedData = fs.readFileSync(`${filePath}.gz`);
      const decompressedData = await gunzip(compressedData);
      const content = decompressedData.toString('utf8');
      
      return isJson ? JSON.parse(content) : content;
    } 
    
    // Read uncompressed file
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return isJson ? JSON.parse(content) : content;
    }
    
    return null;
  } catch (err) {
    logger.error({ err, filePath }, 'Error reading file');
    
    // Try to remove corrupted file
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (fs.existsSync(`${filePath}.gz`)) fs.unlinkSync(`${filePath}.gz`);
    } catch (removeErr) {
      logger.error({ removeErr, filePath }, 'Error removing corrupted file');
    }
    
    return null;
  }
}

/**
 * Delete a file if it exists
 * @param {string} filePath - Path to the file to delete
 * @returns {boolean} - Whether the file was deleted
 */
function deleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    
    // Check for compressed version
    if (fs.existsSync(`${filePath}.gz`)) {
      fs.unlinkSync(`${filePath}.gz`);
      return true;
    }
    
    return false;
  } catch (err) {
    logger.error({ err, filePath }, 'Error deleting file');
    return false;
  }
}

/**
 * Scan directory for files matching a pattern
 * @param {string} dirPath - Directory path
 * @param {RegExp} pattern - Regex pattern to match filenames
 * @returns {string[]} - Array of matching file paths
 */
function scanDirectory(dirPath, pattern = null) {
  try {
    if (!fs.existsSync(dirPath)) {
      return [];
    }
    
    const files = fs.readdirSync(dirPath);
    
    if (pattern) {
      return files
        .filter(file => pattern.test(file))
        .map(file => path.join(dirPath, file));
    }
    
    return files.map(file => path.join(dirPath, file));
  } catch (err) {
    logger.error({ err, dirPath }, 'Error scanning directory');
    return [];
  }
}

module.exports = {
  createDirs,
  keyToFilename,
  saveToFile,
  readFromFile,
  deleteFile,
  scanDirectory,
  gzip,
  gunzip
};