/**
 * App Developer Domain Extractor - Enhanced Server
 * Features:
 * - Multi-term search support for app-ads.txt
 * - Advanced caching system with cleanup
 * - Robust rate limiting with Redis support
 * - Comprehensive error handling
 * - Structured logging
 * - Security enhancements
 */

'use strict';

// Core dependencies
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Worker } = require('worker_threads');

// External dependencies
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pino = require('pino');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

// Initialize logger
const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard'
    }
  },
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
});

// Custom axios retry mechanism (replaces axios-retry)
axios.interceptors.response.use(undefined, async (error) => {
  const { config } = error;
  
  // If no config object or retry not specified, reject
  if (!config || config.retry === undefined) {
    return Promise.reject(error);
  }
  
  // Set retry count if it doesn't exist
  config.__retryCount = config.__retryCount || 0;
  
  // Check if we've reached max retries
  if (config.__retryCount >= config.retry) {
    return Promise.reject(error);
  }
  
  // Increment retry count
  config.__retryCount += 1;
  
  // Create new promise with delay (exponential backoff)
  const delayTime = config.retryDelay || 1000 * Math.pow(2, config.__retryCount - 1);
  
  // Log retry attempt
  if (typeof logger !== 'undefined') {
    logger.debug({ 
      url: config.url, 
      attempt: config.__retryCount, 
      maxRetries: config.retry,
      delay: delayTime,
      status: error.response?.status,
      errorCode: error.code
    }, 'Retrying request');
  }
  
  // Wait for the delay
  await new Promise(resolve => setTimeout(resolve, delayTime));
  
  // Return the new request
  return axios(config);
});

// Set default retry values for all requests
axios.defaults.retry = 3;        // Number of retries
axios.defaults.retryDelay = 1000; // Base delay in ms

// Initialize Redis for rate limiting (optional)
let redis = null;
try {
  if (process.env.REDIS_URL) {
    const Redis = require('ioredis');
    redis = new Redis(process.env.REDIS_URL, {
      tls: {
        rejectUnauthorized: true // Set to false only for testing if you have certificate issues
      },
      reconnectOnError: (err) => {
        logger.warn({ err }, 'Redis reconnect triggered by error');
        return true;
      },
      maxRetriesPerRequest: 3
    });
    
    // Test connection
    redis.on('error', (err) => {
      logger.error({ err }, 'Redis connection error');
      redis = null; // Fall back to memory store
    });
  }
} catch (err) {
  logger.error('Redis initialization failed:', err);
  redis = null;
}

// Enable security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: []
    }
  }
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? [/\.yourdomain\.com$/] : '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(compression());

// Create necessary directories
const DIRS = {
  logs: path.join(__dirname, 'logs'),
  cache: path.join(__dirname, 'cache'),
  debug: path.join(__dirname, 'debug') // Add a debug directory
};

for (const dir of Object.values(DIRS)) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Configure request handling
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Define Redis store for rate limiting if Redis is available
class RedisStore {
  constructor({ client, prefix }) {
    this.client = client;
    this.prefix = prefix || 'rate-limit:';
  }

  async increment(key) {
    const redisKey = `${this.prefix}${key}`;
    const ttlSeconds = 60 * 15; // 15 minutes in seconds
    
    try {
      // Use Redis transaction to increment and set expiry
      const [incr] = await this.client
        .multi()
        .incr(redisKey)
        .expire(redisKey, ttlSeconds)
        .exec();
      
      const totalHits = incr[1];
      
      // Important: Return an object with resetTime as a Date object
      return {
        totalHits,
        resetTime: new Date(Date.now() + ttlSeconds * 1000) // Convert to Date object
      };
    } catch (err) {
      logger.error('Redis increment error:', err);
      // Return default response that follows the expected format
      return {
        totalHits: 1,
        resetTime: new Date(Date.now() + ttlSeconds * 1000)
      };
    }
  }

  async decrement(key) {
    const redisKey = `${this.prefix}${key}`;
    try {
      await this.client.decr(redisKey);
    } catch (err) {
      logger.error('Redis decrement error:', err);
    }
  }

  async resetKey(key) {
    const redisKey = `${this.prefix}${key}`;
    try {
      await this.client.del(redisKey);
    } catch (err) {
      logger.error('Redis resetKey error:', err);
    }
  }
}

// Rate limiting middleware
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: redis ? new RedisStore({
    client: redis,
    prefix: 'rate-limit:'
  }) : undefined
});

app.use('/api/', apiLimiter);

// Store configuration
const STORES = {
  googleplay: {
    urlTemplate: id => `https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}`,
    extractors: [
      html => html.match(/<meta\s+name=['"]appstore:developer_url['"][^>]*content=['"]([^'"]+)['"]/i)?.[1],
      html => html.match(/href="(https:\/\/play\.google\.com\/store\/apps\/dev[^"]+)"/i)?.[1] || 
              html.match(/href="(https:\/\/play\.google\.com\/store\/apps\/developer\?[^"]+)"/i)?.[1],
      // Add new patterns for Google Play
      html => html.match(/href="(https:\/\/play\.google\.com\/store\/apps\/developer\?id=[^"]+)"/i)?.[1],
      html => html.match(/href="(https:\/\/play\.google\.com\/store\/apps\/details\?id=[^"]+).*?developer/i)?.[1],
      // Add Cheerio-based extraction as a last resort
      html => {
        try {
          const $ = cheerio.load(html);
          return $('a[href*="developer?id="]').attr('href') ||
                 $('a[itemprop="url"][href*="/dev"]').attr('href') ||
                 $('a:contains("View Developer")').attr('href');
        } catch (err) {
          logger.error({ err }, 'Cheerio extraction failed for Google Play');
          return null;
        }
      }
    ],
    rateLimit: { requests: 10, windowMs: 1000 }
  },
  appstore: {
    urlTemplate: id => `https://apps.apple.com/us/app/${encodeURIComponent(/^\d+$/.test(id) ? 'id' + id : id)}`,
    extractors: [
      html => html.match(/<a[^>]*class=['"]link\s+icon\s+icon-after\s+icon-external['"][^>]*href=['"]([^'"]+)['"]/i)?.[1],
      html => html.match(/href="(https:\/\/apps\.apple\.com[^"]+\/developer\/[^"]+)"/i)?.[1],
      // Add new patterns for App Store
      html => html.match(/href="(https:\/\/apps\.apple\.com[^"]+(?:\/developer|\/company)\/[^"]+)"/i)?.[1],
      html => html.match(/developer.*?href="([^"]+)"/i)?.[1],
      // Add Cheerio-based extraction as a last resort
      html => {
        try {
          const $ = cheerio.load(html);
          return $('.app-header a[href*="/developer/"]').attr('href') ||
                 $('.app-header a[href*="/company/"]').attr('href') ||
                 $('a:contains("Developer Website")').attr('href');
        } catch (err) {
          logger.error({ err }, 'Cheerio extraction failed for App Store');
          return null;
        }
      }
    ],
    rateLimit: { requests: 12, windowMs: 1000 }
  },
  amazon: {
    urlTemplate: id => `https://www.amazon.com/dp/${encodeURIComponent(id)}`,
    extractors: [
      html => html.match(/href="(https:\/\/www\.amazon\.com\/[^"]+\/developer\/[^"]+)"/i)?.[1],
      html => html.match(/href="([^"]+)"[^>]*>Visit the ([^<]+) Store</i)?.[1],
      // Add new patterns for Amazon
      html => html.match(/href="([^"]+)"[^>]*>Visit\s+Developer['"]?s\s+Website</i)?.[1],
      html => html.match(/href="(https:\/\/www\.amazon\.com\/gp\/product\/[^"]+)"/i)?.[1],
      // Add Cheerio-based extraction as a last resort
      html => {
        try {
          const $ = cheerio.load(html);
          return $('.a-section a[href*="/dev/"]').attr('href') ||
                 $('a:contains("Visit the")').attr('href') ||
                 $('.author-name').parent('a').attr('href');
        } catch (err) {
          logger.error({ err }, 'Cheerio extraction failed for Amazon');
          return null;
        }
      }
    ],
    rateLimit: { requests: 8, windowMs: 1500 }
  },
  roku: {
    urlTemplate: id => `https://channelstore.roku.com/details/${encodeURIComponent(id)}`,
    extractors: [
      html => html.match(/<meta\s+name=['"]appstore:developer_url['"][^>]*content=['"]([^'"]+)['"]/i)?.[1],
      html => html.match(/href="(https:\/\/channelstore\.roku\.com\/[^"]*?\/developer\/[^"]+)"/i)?.[1],
      html => html.match(/href="([^"]+)"[^>]*>More by ([^<]+)</i)?.[1],
      // Add new patterns for Roku
      html => html.match(/href="([^"]+)"[^>]*>Visit\s+Developer/i)?.[1],
      html => html.match(/Developer.*?href="([^"]+)"/i)?.[1],
      // Add Cheerio-based extraction as a last resort
      html => {
        try {
          const $ = cheerio.load(html);
          return $('.developer-link a').attr('href') ||
                 $('a:contains("More by")').attr('href') ||
                 $('a:contains("Developer")').attr('href');
        } catch (err) {
          logger.error({ err }, 'Cheerio extraction failed for Roku');
          return null;
        }
      }
    ],
    rateLimit: { requests: 4, windowMs: 3000 }
  },
  samsung: {
    urlTemplate: id => `https://www.samsung.com/us/appstore/app/${encodeURIComponent(id)}`,
    extractors: [
      html => html.match(/<meta\s+name=['"]appstore:developer_url['"][^>]*content=['"]([^'"]+)['"]/i)?.[1],
      html => html.match(/href="(https:\/\/www\.samsung\.com\/[^"]*?\/developer\/[^"]+)"/i)?.[1],
      html => html.match(/href="([^"]+)"[^>]*>More from Developer</i)?.[1],
      html => html.match(/Developer<\/dt>[^<]*<dd[^>]*>[^<]*<a[^>]*href="([^"]+)"/i)?.[1],
      // Add new patterns for Samsung
      html => html.match(/href="([^"]+)"[^>]*>Visit\s+Developer</i)?.[1],
      html => html.match(/developer.*?href="([^"]+)"/i)?.[1],
      // Add Cheerio-based extraction as a last resort
      html => {
        try {
          const $ = cheerio.load(html);
          return $('.developer-link').attr('href') ||
                 $('a:contains("Developer")').attr('href') ||
                 $('a[href*="/developer/"]').attr('href') ||
                 $('.app-dev-name a').attr('href');
        } catch (err) {
          logger.error({ err }, 'Cheerio extraction failed for Samsung');
          return null;
        }
      }
    ],
    rateLimit: { requests: 8, windowMs: 1500 }
  }
};

// Initialize rate limiters object
const rateLimiters = {};

// Enhanced cache with cleanup
class EnhancedCache {
  constructor() {
    this.memoryCache = new Map();
    this.stats = { hits: 0, misses: 0 };
    this.maxMemorySize = Math.min(1000, parseInt(process.env.MAX_MEMORY_CACHE_SIZE) || 1000);
    this.cleanupInterval = 60 * 60 * 1000; // 1 hour
    this.memoryPruneThreshold = 0.9; // Prune at 90% capacity
    this.startCleanupInterval();
  }
  
  getFilePath(key) {
    const safeKey = typeof key === 'string' ? key : String(key);
    return path.join(DIRS.cache, `${crypto.createHash('md5').update(safeKey).digest('hex')}.json`);
  }
  
  startCleanupInterval() {
    setInterval(() => this.cleanup(), this.cleanupInterval);
  }
  
  cleanup() {
    // Cleanup memory cache
    const now = Date.now();
    let memoryItemsRemoved = 0;
    
    for (const [key, item] of this.memoryCache.entries()) {
      if (now >= item.expiry) {
        this.memoryCache.delete(key);
        memoryItemsRemoved++;
      }
    }
    
    // Log memory cache cleanup results
    if (memoryItemsRemoved > 0) {
      logger.debug({ memoryItemsRemoved }, 'Memory cache cleanup completed');
    }
    
    // Cleanup file cache - process files in batches
    this.cleanupFileCache();
  }
  
  cleanupFileCache(batchSize = 100) {
    fs.readdir(DIRS.cache, (err, files) => {
      if (err) {
        logger.error({ err }, 'Error reading cache directory');
        return;
      }
      
      // Process files in batches
      const processBatch = (startIndex) => {
        if (startIndex >= files.length) {
          logger.debug({ processedFiles: files.length }, 'File cache cleanup completed');
          return;
        }
        
        const batch = files.slice(startIndex, startIndex + batchSize);
        let filesRemoved = 0;
        
        // Process each file in the batch
        batch.forEach(file => {
          const filePath = path.join(DIRS.cache, file);
          
          try {
            const stats = fs.statSync(filePath);
            const fileData = fs.readFileSync(filePath, 'utf8');
            const item = JSON.parse(fileData);
            
            if (Date.now() >= item.expiry) {
              fs.unlinkSync(filePath);
              filesRemoved++;
            }
          } catch (error) {
            // If the file can't be read or parsed, delete it
            logger.error({ error, file }, 'Error processing cache file');
            try {
              fs.unlinkSync(filePath);
              filesRemoved++;
            } catch (unlinkError) {
              logger.error({ unlinkError, file }, 'Error deleting corrupt cache file');
            }
          }
        });
        
        if (filesRemoved > 0) {
          logger.debug({ filesRemoved, batch: batch.length }, 'Batch file cleanup');
        }
        
        // Process next batch asynchronously to avoid blocking
        setImmediate(() => processBatch(startIndex + batchSize));
      };
      
      // Start processing the first batch
      processBatch(0);
    });
  }
  
  // Prune the memory cache when it gets too large
  prune() {
    if (this.memoryCache.size >= this.maxMemorySize * this.memoryPruneThreshold) {
      logger.debug('Memory cache reached prune threshold, removing oldest items');
      
      // Get entries sorted by expiry
      const entries = [...this.memoryCache.entries()]
        .sort((a, b) => a[1].expiry - b[1].expiry);
      
      // Remove oldest 20%
      const removeCount = Math.ceil(this.memoryCache.size * 0.2);
      for (let i = 0; i < removeCount && i < entries.length; i++) {
        this.memoryCache.delete(entries[i][0]);
      }
      
      logger.debug({ removed: removeCount, newSize: this.memoryCache.size }, 'Memory cache pruned');
    }
  }
  
  get(key) {
    if (!key) {
      return null;
    }
    
    // Try memory cache first
    if (this.memoryCache.has(key)) {
      const item = this.memoryCache.get(key);
      if (Date.now() < item.expiry) {
        this.stats.hits++;
        return item.value;
      }
      this.memoryCache.delete(key);
    }
    
    // Try file cache
    const filePath = this.getFilePath(key);
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        if (Date.now() < data.expiry) {
          // Cache hit - store in memory too if space available
          if (this.memoryCache.size < this.maxMemorySize) {
            this.memoryCache.set(key, {
              value: data.value,
              expiry: data.expiry
            });
          }
          this.stats.hits++;
          return data.value;
        }
        
        // Expired file - delete it
        try {
          fs.unlinkSync(filePath);
        } catch (unlinkErr) {
          logger.error({ unlinkErr, key }, 'Error deleting expired cache file');
        }
      } catch (readErr) {
        logger.error({ readErr, key }, 'Error reading cache file');
        
        // Try to delete corrupted file
        try {
          fs.unlinkSync(filePath);
        } catch (unlinkErr) {
          logger.error({ unlinkErr, key }, 'Error deleting corrupted cache file');
        }
      }
    }
    
    this.stats.misses++;
    return null;
  }
  
  set(key, value, ttlHours = 24) {
    if (!key || value === undefined || value === null) {
      return false;
    }
    
    // Run prune before adding new items
    this.prune();
    
    try {
      const expiry = Date.now() + (ttlHours * 60 * 60 * 1000);
      
      // Save to memory if space available
      if (this.memoryCache.size < this.maxMemorySize) {
        this.memoryCache.set(key, {
          value,
          expiry
        });
      }
      
      // Save to file
      const data = { expiry, value };
      const filePath = this.getFilePath(key);
      
      // Create a temporary file and then rename it to avoid partial writes
      const tempFilePath = `${filePath}.tmp`;
      fs.writeFileSync(tempFilePath, JSON.stringify(data));
      fs.renameSync(tempFilePath, filePath);
      
      return true;
    } catch (err) {
      logger.error({ err, key }, 'Error writing to cache');
      return false;
    }
  }
  
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? Math.round((this.stats.hits / total) * 100) + '%' : '0%',
      memorySize: this.memoryCache.size
    };
  }
}

// Initialize cache
const cache = new EnhancedCache();

// Worker pool implementation
class WorkerPool {
  constructor(filename, maxWorkers = 4) {
    this.filename = filename;
    this.maxWorkers = maxWorkers;
    this.workers = [];
    this.queue = [];
    this.activeWorkers = 0;
  }
  
  async runTask(workerData) {
    return new Promise((resolve, reject) => {
      const task = { workerData, resolve, reject };
      
      if (this.activeWorkers < this.maxWorkers) {
        this.runWorker(task);
      } else {
        this.queue.push(task);
      }
    });
  }
  
  runWorker(task) {
    this.activeWorkers++;
    
    const worker = new Worker(this.filename, {
      workerData: task.workerData
    });
    
    let timeoutId;
    
    const cleanup = () => {
      clearTimeout(timeoutId);
      this.activeWorkers--;
      
      // Process next task in queue if any
      if (this.queue.length > 0) {
        const nextTask = this.queue.shift();
        this.runWorker(nextTask);
      }
    };
    
    // Set timeout to prevent hanging workers
    timeoutId = setTimeout(() => {
      worker.terminate();
      task.reject(new Error('Worker processing timed out'));
      cleanup();
    }, 30000);
    
    worker.on('message', (result) => {
      task.resolve(result);
      worker.terminate();
      cleanup();
    });
    
    worker.on('error', (err) => {
      task.reject(err);
      worker.terminate();
      cleanup();
    });
    
    worker.on('exit', (code) => {
      if (code !== 0) {
        task.reject(new Error(`Worker stopped with exit code ${code}`));
      }
      cleanup();
    });
  }
}

// Initialize worker pool
const appAdsWorkerPool = new WorkerPool(
  path.join(__dirname, 'app-ads-parser.worker.js'),
  Math.max(1, Math.floor(require('os').cpus().length / 2))
);

// Function to run a worker thread for app-ads.txt processing
function runWorker(content, searchTerms) {
  return appAdsWorkerPool.runTask({
    content,
    searchTerms
  });
}

// Function to save HTML responses for debugging
function saveHtmlForDebugging(storeType, bundleId, html) {
  try {
    if (!process.env.DEBUG_STORE_RESPONSES && process.env.DEBUG_STORE_RESPONSES !== 'true') {
      return;
    }
    
    const debugDir = path.join(__dirname, 'debug');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    
    const safeId = bundleId.replace(/[^a-zA-Z0-9]/g, '_');
    fs.writeFileSync(
      path.join(debugDir, `${storeType}_${safeId}_${Date.now()}.html`),
      html
    );
    logger.debug({ storeType, bundleId }, 'Saved HTML for debugging');
  } catch (err) {
    logger.error({ err }, 'Failed to save HTML for debugging');
  }
}

// Enhanced user agent rotation
function getRandomUserAgent() {
  const agents = [
    // Your existing agents plus additional ones:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
  ];
  return agents[Math.floor(Math.random() * agents.length)];
}

// Helper function for generating case-aware cache keys
function getCaseAwareCacheKey(storeType, bundleId) {
  // Define stores where case matters in the ID
  const caseSensitiveStores = ['googleplay', 'samsung'];
  
  // For these stores, use lowercase in the cache key for consistency
  if (caseSensitiveStores.includes(storeType)) {
    return `store-${storeType}-${bundleId.toLowerCase()}`;
  }
  return `store-${storeType}-${bundleId}`;
}

// Input validation
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
  
  return trimmedId;
}

function validateSearchTerms(terms) {
  if (!terms) return null;
  
  if (typeof terms === 'string') {
    const trimmed = terms.toLowerCase().trim();
    // Limit length and reject potentially dangerous inputs
    if (!trimmed || trimmed.length > 100 || /[<>{}()[\]"`\\]/.test(trimmed)) {
      return null;
    }
    return [trimmed];
  }
  
  if (Array.isArray(terms)) {
    // Limit number of terms
    if (terms.length > 10) return null;
    
    const validTerms = terms
      .filter(term => term && typeof term === 'string')
      .map(term => {
        const trimmed = term.toLowerCase().trim();
        // Reject potentially dangerous terms
        if (trimmed.length > 100 || /[<>{}()[\]"`\\]/.test(trimmed)) return null;
        return trimmed;
      })
      .filter(Boolean);
    
    return validTerms.length > 0 ? validTerms : null;
  }
  
  throw new Error('Invalid search terms: must be a string or array of strings');
}

/**
 * Detect store type from bundle ID format
 * @param {string} bundleId - Bundle ID
 * @returns {string} Store type
 */
function detectStoreType(bundleId) {
  try {
    const validId = validateBundleId(bundleId);
    
    // Check for complex Roku ID (most specific pattern first)
    if (/^[a-f0-9]{32}:[a-f0-9]{32}$/i.test(validId)) return 'roku';
    
    // Check for Samsung ID (G/g followed by 11 digits)
    if (/^[gG]\d{11}$/i.test(validId)) return 'samsung';
    
    // Check for Amazon ID (B/b followed by 9 alphanumeric characters)
    if (/^[bB][0-9A-Z]{9}$/i.test(validId)) return 'amazon';
    
    // Check for Apple App Store ID (exactly 9 digits, with optional "id" prefix)
    if (/^(id)?\d{9}$/i.test(validId)) return 'appstore';
    
    // Check for simple Roku ID (2-6 digits)
    if (/^\d{2,6}$/i.test(validId)) return 'roku';
    
    // Check for Google Play ID (package name format)
    if (/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(validId)) return 'googleplay';
    
    // Unknown store type
    return 'unknown';
  } catch (err) {
    logger.error({ err, bundleId }, 'Error detecting store type');
    return 'unknown';
  }
}

// Enhanced domain extraction with validation
function extractDomain(url) {
  try {
    if (!url || typeof url !== 'string') return '';
    
    // Remove protocol and path
    const match = url.match(/^(?:https?:\/\/)?([^\/]+)/i);
    if (!match) return '';
    
    const hostname = match[1];
    const parts = hostname.split('.');
    
    // If only two parts (e.g., example.com), return the whole thing
    if (parts.length <= 2) return hostname;
    
    // Expanded list of special TLDs that should be treated as a single unit
    const specialTlds = [
      'co.uk', 'co.jp', 'co.nz', 'co.za', 'co.kr', 'co.id', 'co.il', 'co.th', 
      'com.au', 'com.br', 'com.tw', 'com.sg', 'com.tr', 'com.mx', 'com.ar', 'com.hk',
      'com.ph', 'com.my', 'com.vn', 'org.uk', 'net.au', 'or.jp', 'ne.jp', 'ac.uk',
      'edu.au', 'gov.au', 'org.au'
    ];
    
    // Check if the last two parts form a special TLD
    const lastTwo = parts.slice(-2).join('.');
    
    // If it's a special TLD, take the last three parts; otherwise just the last two
    const extractedDomain = specialTlds.includes(lastTwo) ? 
      parts.slice(-3).join('.') : 
      parts.slice(-2).join('.');
    
    // Basic domain validation
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(extractedDomain)) {
      logger.warn({ url, extractedDomain }, 'Potentially invalid domain extracted');
      return '';
    }
    
    return extractedDomain;
  } catch (err) {
    logger.error({ err, url }, 'Error extracting domain');
    return '';
  }
}

// Enhanced rate limiting with Redis support and proper error handling
async function applyRateLimit(storeType) {
  try {
    const store = STORES[storeType];
    if (!store?.rateLimit) return;
    
    // Special handling for Roku
    if (storeType === 'roku') {
      // Add a random delay between 1-3 seconds for Roku
      const jitter = Math.floor(Math.random() * 2000) + 1000;
      await new Promise(resolve => setTimeout(resolve, jitter));
    }
    
    const { requests, windowMs } = store.rateLimit;
    
    if (redis) {
      const key = `rate-limit:${storeType}`;
      
      try {
        const current = await redis.incr(key);
        if (current === 1) {
          await redis.expire(key, Math.ceil(windowMs / 1000));
        }
        
        if (current > requests) {
          const ttl = await redis.ttl(key);
          const waitTime = ttl > 0 ? ttl * 1000 : windowMs;
          
          logger.debug({ storeType, waitTime }, 'Rate limit exceeded, waiting');
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      } catch (redisErr) {
        logger.error({ redisErr, storeType }, 'Redis rate limiting error, falling back to memory rate limiting');
        await memoryRateLimit(storeType, requests, windowMs);
      }
    } else {
      await memoryRateLimit(storeType, requests, windowMs);
    }
  } catch (err) {
    logger.error({ err, storeType }, 'Rate limiting error');
    // Default delay to be safe
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// Memory-based rate limiting as a fallback
async function memoryRateLimit(storeType, requests, windowMs) {
  const now = Date.now();
  
  // Initialize or update the rate limiter for this store type
  if (!rateLimiters[storeType]) {
    rateLimiters[storeType] = {
      requests: 1,
      resetTime: now + windowMs,
      lastRequest: now
    };
    return;
  }
  
  const limiter = rateLimiters[storeType];
  
  // Reset counter if window has passed
  if (now > limiter.resetTime) {
    limiter.requests = 1;
    limiter.resetTime = now + windowMs;
    limiter.lastRequest = now;
    return;
  }
  
  // Apply rate limiting
  if (limiter.requests >= requests) {
    const timeElapsed = now - limiter.lastRequest;
    if (timeElapsed < windowMs) {
      const waitTime = windowMs - timeElapsed;
      logger.debug({ storeType, waitTime }, 'Memory rate limit exceeded, waiting');
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Reset after waiting
    limiter.requests = 1;
    limiter.resetTime = now + windowMs;
  } else {
    limiter.requests++;
  }
  
  limiter.lastRequest = Date.now();
}

// Enhanced app-ads.txt checking with worker threads
async function checkAppAdsTxt(domain, searchTerms = null) {
  const startTime = Date.now();
  let fileSize = 0;
  let processingMethod = 'none';
  let finalDomain = domain;  // Track the final domain after redirects
  
  if (!domain) {
    return { exists: false };
  }
  
  // Validate domain format to avoid potential security issues
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    logger.warn({ domain }, 'Invalid domain format, skipping app-ads.txt check');
    return { exists: false, error: 'Invalid domain format' };
  }
  
  try {
    const normalizedSearchTerms = validateSearchTerms(searchTerms);
    const searchTermsKey = normalizedSearchTerms?.length > 0 
      ? normalizedSearchTerms.sort().join('-') 
      : 'none';
    const cacheKey = `app-ads-txt-${domain}-${searchTermsKey}`;
    
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    
    const protocols = ['https', 'http'];
    let content = null;
    let usedProtocol = null;
    let fetchErrors = [];
    let redirectUrl = null;
    let analyzed = null;
    let searchResults = null;
    
    for (const protocol of protocols) {
      if (content) break;
      
      try {
        // Apply rate limiting to avoid overloading servers
        await applyRateLimit('appstore');
        
        const url = `${protocol}://${domain}/app-ads.txt`;
        logger.debug({ url }, 'Fetching app-ads.txt');
        
        // Modified to follow redirects by default and capture the final URL
        const response = await axios.get(url, {
          timeout: 10000,
          retry: 3, // Use custom retry
          headers: {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/plain,text/html',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Upgrade-Insecure-Requests': '1'
          },
          validateStatus: status => status === 200,
          maxRedirects: 5, // Follow up to 5 redirects
          withCredentials: false // Ensure cookies aren't sent for security
        });
        
        // Check if we were redirected and update the domain
        if (response.request.res.responseUrl) {
          redirectUrl = response.request.res.responseUrl;
          try {
            const redirectUrlObj = new URL(redirectUrl);
            // Only update if it's a different domain
            const redirectDomain = extractDomain(redirectUrlObj.hostname);
            if (redirectDomain && redirectDomain !== domain) {
              finalDomain = redirectDomain;
              logger.info({ 
                originalDomain: domain, 
                redirectDomain: finalDomain 
              }, 'Followed redirect to new domain');
            }
          } catch (urlErr) {
            logger.warn({ 
              redirectUrl, 
              error: urlErr.message 
            }, 'Failed to parse redirect URL');
          }
        }
        
        // If response.request.path doesn't end with app-ads.txt, we might have been redirected elsewhere
        const finalPath = response.request.path;
        if (!finalPath.endsWith('/app-ads.txt') && !finalPath.endsWith('/app-ads.txt/')) {
          logger.warn({ 
            originalUrl: url, 
            finalPath: finalPath 
          }, 'Redirected to non-app-ads.txt path');
          continue; // Skip this result as it might not be app-ads.txt content
        }
        
        if (response.data && typeof response.data === 'string') {
          content = response.data.trim();
          usedProtocol = protocol;
          break;
        }
      } catch (err) {
        // Check if we were redirected before the error
        if (err.response?.request?.res?.responseUrl) {
          redirectUrl = err.response.request.res.responseUrl;
          try {
            const redirectUrlObj = new URL(redirectUrl);
            const redirectDomain = extractDomain(redirectUrlObj.hostname);
            if (redirectDomain && redirectDomain !== domain) {
              finalDomain = redirectDomain;
              
              // If we got redirected to a new domain but still had an error,
              // try the new domain directly in the next iteration
              logger.info({ 
                originalDomain: domain, 
                redirectDomain: finalDomain 
              }, 'Redirect detected before error, will try new domain');
              
              // Now try the new domain directly
              try {
                const newDomainUrl = `${protocol}://${finalDomain}/app-ads.txt`;
                logger.debug({ url: newDomainUrl }, 'Fetching app-ads.txt from redirect domain');
                
                const newResponse = await axios.get(newDomainUrl, {
                  timeout: 10000,
                  retry: 3,
                  headers: {
                    'User-Agent': getRandomUserAgent(),
                    'Accept': 'text/plain,text/html',
                    'Accept-Encoding': 'gzip, deflate, br'
                  },
                  validateStatus: status => status === 200
                });
                
                if (newResponse.data && typeof newResponse.data === 'string') {
                  content = newResponse.data.trim();
                  usedProtocol = protocol;
                  break;
                }
              } catch (newErr) {
                // Log but continue with the next protocol
                logger.debug({ 
                  error: newErr.message, 
                  redirectDomain: finalDomain 
                }, 'Failed to fetch from redirect domain');
              }
            }
          } catch (urlErr) {
            logger.debug({ redirectUrl }, 'Failed to parse redirect URL');
          }
        }
        
        const errorDetails = {
          protocol,
          domain,
          message: err.message,
          status: err.response?.status,
          statusText: err.response?.statusText
        };
        
        fetchErrors.push(errorDetails);
        logger.debug(errorDetails, 'Failed to fetch app-ads.txt');
      }
    }
    
    if (!content) {
      const result = { 
        exists: false,
        fetchErrors: fetchErrors.length > 0 ? fetchErrors : undefined,
        originalDomain: domain,
        finalDomain: finalDomain !== domain ? finalDomain : undefined
      };
      cache.set(cacheKey, result, 6); // Cache non-existing files for shorter period
      return result;
    }
    
    fileSize = content.length;
    
    // Process content with worker
    try {
      processingMethod = 'worker';
      const workerResult = await runWorker(content, normalizedSearchTerms);
      if (workerResult.success) {
        analyzed = workerResult.analyzed;
        searchResults = workerResult.searchResults;
      } else {
        // If worker fails, log the error and continue with default values
        logger.error({ 
          err: workerResult.error, 
          domain: finalDomain 
        }, 'Worker processing failed');
        
        // Set defaults
        analyzed = {
          totalLines: content.split(/\r\n|\n|\r/).length,
          validLines: 0,
          commentLines: 0,
          emptyLines: 0,
          invalidLines: 0,
          uniquePublishers: 0,
          relationships: { direct: 0, reseller: 0, other: 0 }
        };
        
        searchResults = normalizedSearchTerms ? {
          terms: normalizedSearchTerms,
          count: 0,
          matchingLines: []
        } : null;
      }
    } catch (workerErr) {
      logger.error({ err: workerErr, domain: finalDomain }, 'Worker execution failed');
      
      // Process without worker as fallback
      processingMethod = 'fallback';
      const lines = content.split(/\r\n|\n|\r/);
      
      // Basic analysis
      analyzed = {
        totalLines: lines.length,
        validLines: lines.filter(line => {
          const cleanLine = line.split('#')[0].trim();
          return cleanLine && cleanLine.split(',').length >= 3;
        }).length,
        commentLines: lines.filter(line => line.trim().startsWith('#')).length,
        emptyLines: lines.filter(line => !line.trim()).length,
        uniquePublishers: new Set(
          lines
            .map(line => line.split('#')[0].trim())
            .filter(Boolean)
            .map(line => line.split(',')[0]?.trim()?.toLowerCase())
            .filter(Boolean)
        ).size,
        relationships: { direct: 0, reseller: 0, other: 0 }
      };
      
      analyzed.invalidLines = analyzed.totalLines - analyzed.validLines - 
        analyzed.commentLines - analyzed.emptyLines;
      
      // Basic search if search terms provided
      if (normalizedSearchTerms && normalizedSearchTerms.length > 0) {
        const matchingLines = [];
        
        lines.forEach((line, index) => {
          const lowerLine = line.toLowerCase();
          if (normalizedSearchTerms.some(term => lowerLine.includes(term))) {
            matchingLines.push({
              lineNumber: index + 1,
              content: line
            });
          }
        });
        
        searchResults = {
          terms: normalizedSearchTerms,
          count: matchingLines.length,
          matchingLines
        };
      } else {
        searchResults = null;
      }
    }
    
    // Create the result object
    const result = {
      exists: true,
      url: `${usedProtocol}://${finalDomain}/app-ads.txt`,
      originalDomain: domain,
      finalDomain: finalDomain !== domain ? finalDomain : undefined,
      content: content.length > 100000 
        ? content.substring(0, 100000) + '\n... (truncated, file too large)' 
        : content,
      contentLength: content.length,
      analyzed,
      searchResults,
      processingMethod
    };
    
    const processingTime = Date.now() - startTime;
    logger.debug({
      domain,
      finalDomain,
      fileSize,
      processingMethod,
      processingTime: `${processingTime}ms`,
      hasSearchTerms: !!normalizedSearchTerms?.length
    }, 'app-ads.txt processing complete');
    
    cache.set(cacheKey, result, 12);
    return result;
  } catch (err) {
    logger.error({ err, domain }, 'Error checking app-ads.txt');
    
    const result = { 
      exists: false, 
      error: 'Internal error processing app-ads.txt',
      originalDomain: domain,
      finalDomain: finalDomain !== domain ? finalDomain : undefined
    };
    
    cache.set(cacheKey, result, 1); // Short cache time for errors
    return result;
  }
}

async function extractFromStore(bundleId, storeType, searchTerms = null) {
  try {
    const store = STORES[storeType];
    if (!store) {
      throw new Error(`Unsupported store type: ${storeType}`);
    }
    
    const validId = validateBundleId(bundleId);
    const url = store.urlTemplate(validId);
    const cacheKey = getCaseAwareCacheKey(storeType, validId);
    
    // Check cache first - use case-aware cache key
    const cached = cache.get(cacheKey);
    if (cached) {
      if (cached.success && cached.domain && searchTerms) {
        const cachedTerms = cached.searchTerms || [];
        const newTerms = Array.isArray(searchTerms) ? searchTerms : [searchTerms];
        
        // If search terms are different, recheck app-ads.txt with new terms
        if (JSON.stringify(cachedTerms.sort()) !== JSON.stringify(newTerms.sort())) {
          try {
            const appAdsTxt = await checkAppAdsTxt(cached.domain, searchTerms);
            return {...cached, appAdsTxt, searchTerms: newTerms};
          } catch (appAdsErr) {
            logger.error({ appAdsErr, domain: cached.domain }, 'Error checking app-ads.txt with new search terms');
            return cached; // Return cached result without new search terms
          }
        }
      }
      return cached;
    }
    
    // Apply rate limiting
    await applyRateLimit(storeType);
    
    logger.debug({ bundleId, storeType, url }, 'Extracting from store');
    
    // Fetch store page
    let data;
    let response;
    
try {
  response = await axios.get(url, {
    timeout: 15000,
    retry: 3,
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Referer': storeType === 'roku' ? 'https://www.roku.com/search/browse' : 'https://www.google.com/',
      // Add this Cookie header for Roku
      ...(storeType === 'roku' ? {'Cookie': 'visitor_id='+Math.random().toString(36).substring(2,15)} : {})
    }
  });
      
      if (!response.data || typeof response.data !== 'string') {
        throw new Error(`Empty or invalid response from ${storeType}`);
      }
      
      data = response.data;
      
      // Save HTML for debugging if enabled
      saveHtmlForDebugging(storeType, validId, data);
      
      // Check if the response might be a captcha or block page
      if (data.includes('captcha') || data.includes('security check') || 
    data.includes('automated access') || data.includes('blocked') ||
    data.includes('suspicious activity') || data.includes('verify you are a human') ||
    (storeType === 'roku' && (data.includes('unusual traffic') || data.includes('access denied')))) {
  logger.warn({ bundleId, storeType }, 'Possible captcha or access blocked');
  throw new Error(`Access to ${storeType} might be temporarily blocked. Try changing your IP address.`);
}
    } catch (fetchErr) {
      // Case sensitivity handling for 404 errors
      if (fetchErr.response?.status === 404) {
        // Define which stores are case-sensitive and the alternative case to try
        const caseSensitivityOptions = {
          'googleplay': validId !== validId.toLowerCase() ? validId.toLowerCase() : null,
          'samsung': validId.startsWith('G') ? 'g' + validId.substring(1) : 
                    validId.startsWith('g') ? 'G' + validId.substring(1) : null
        };
        
        // If this is a case-sensitive store and we have an alternative to try
        const alternativeId = caseSensitivityOptions[storeType];
        
        if (alternativeId) {
          logger.info({ 
            originalId: validId, 
            alternativeId,
            storeType 
          }, 'Trying alternative case for bundle ID');
          
          try {
            // Try with alternative case bundle ID
            const alternativeUrl = store.urlTemplate(alternativeId);
            const alternativeResponse = await axios.get(alternativeUrl, {
              timeout: 15000,
              retry: 3,
              headers: {
                'User-Agent': getRandomUserAgent(),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache'
              }
            });
            
            // If we get here, the alternative case worked
            if (!alternativeResponse.data || typeof alternativeResponse.data !== 'string') {
              throw new Error(`Empty or invalid response from ${storeType} with alternative case`);
            }
            
            // Process the successful response with alternative case
            const alternativeData = alternativeResponse.data;
            
            // Save HTML for debugging if enabled
            saveHtmlForDebugging(storeType, alternativeId, alternativeData);
            
            let alternativeDeveloperUrl = null;
            
            // Try pattern-based extractors with alternative case
            for (const extractor of store.extractors) {
              try {
                alternativeDeveloperUrl = extractor(alternativeData);
                if (alternativeDeveloperUrl) break;
              } catch (extractErr) {
                logger.error({ extractErr, storeType }, 'Error in extractor with alternative case');
              }
            }
            
            // If pattern-based extraction failed, try using Cheerio
            if (!alternativeDeveloperUrl) {
              try {
                const $ = cheerio.load(alternativeData);
                const selectors = [
                  'meta[name="appstore:developer_url"]',
                  'a[href*="/developer/"]',
                  'a.link.icon.icon-after.icon-external',
                  'a:contains("Visit the")',
                  'a:contains("More by")'
                ];
                
                for (const selector of selectors) {
                  const el = $(selector);
                  if (el.length > 0) {
                    alternativeDeveloperUrl = el.attr('content') || el.attr('href');
                    if (alternativeDeveloperUrl) break;
                  }
                }
              } catch (cheerioErr) {
                logger.error({ cheerioErr, storeType }, 'Error using Cheerio for extraction with alternative case');
              }
            }
            
            if (!alternativeDeveloperUrl) {
              throw new Error(`Could not find developer URL for ${alternativeId} in ${storeType}`);
            }
            
            // Extract domain from developer URL
            const alternativeDomain = extractDomain(alternativeDeveloperUrl);
            if (!alternativeDomain) {
              throw new Error(`Could not extract valid domain from developer URL: ${alternativeDeveloperUrl}`);
            }
            
            // Check for app-ads.txt
            const alternativeAppAdsTxt = await checkAppAdsTxt(alternativeDomain, searchTerms);
            
            // Prepare result with alternative ID
            const alternativeResult = {
              bundleId: validId, // Keep original ID in result
              alternativeBundleId: alternativeId, // Store the ID that actually worked
              developerUrl: alternativeDeveloperUrl,
              domain: alternativeDomain,
              storeType,
              appAdsTxt: alternativeAppAdsTxt,
              searchTerms: searchTerms ? (Array.isArray(searchTerms) ? searchTerms : [searchTerms]) : null,
              success: true,
              caseCorrected: true, // Indicate case was corrected
              timestamp: Date.now()
            };
            
            // Cache result with both original and alternative keys
            cache.set(getCaseAwareCacheKey(storeType, validId), alternativeResult, 24);
            cache.set(getCaseAwareCacheKey(storeType, alternativeId), alternativeResult, 24);
            
            return alternativeResult;
          } catch (altErr) {
            // Alternative case also failed, log and continue with original error
            logger.debug({
              alternativeId,
              error: altErr.message
            }, 'Alternative case bundle ID also failed');
          }
        }
      }
      
      // Process the original error if we couldn't handle it with case sensitivity
      let errorMessage;
      if (fetchErr.code === 'ECONNABORTED') {
        errorMessage = 'The request timed out. The app store might be temporarily unavailable.';
      } else if (fetchErr.response?.status === 404) {
        errorMessage = 'The bundle ID was not found in this store.';
      } else if (fetchErr.response?.status === 429) {
        errorMessage = 'Too many requests. Please try again later.';
      } else {
        errorMessage = fetchErr.message || 'An unknown error occurred';
      }
      
      logger.error({ 
        err: errorMessage, 
        bundleId, 
        storeType,
        url: fetchErr.config?.url,
        status: fetchErr.response?.status
      }, 'Error extracting from store');
      
      const errorResult = { 
        bundleId: validId, 
        storeType, 
        success: false, 
        error: errorMessage,
        suggestedAction: fetchErr.code === 'ECONNABORTED' ? 'retry' : undefined,
        timestamp: Date.now()
      };
      
      // Cache errors for a shorter period, using case-aware key
      cache.set(getCaseAwareCacheKey(storeType, validId), errorResult, 1);
      throw fetchErr;
    }
    
    // If we get here, we have a successful response
    let developerUrl = null;
    
    // Try pattern-based extractors first
    for (const extractor of store.extractors) {
      try {
        developerUrl = extractor(data);
        if (developerUrl) break;
      } catch (extractErr) {
        logger.error({ extractErr, storeType }, 'Error in extractor');
      }
    }
    
    // If pattern-based extraction failed, try using Cheerio
    if (!developerUrl) {
      try {
        const $ = cheerio.load(data);
        const selectors = [
          'meta[name="appstore:developer_url"]',
          'a[href*="/developer/"]',
          'a.link.icon.icon-after.icon-external',
          'a:contains("Visit the")',
          'a:contains("More by")'
        ];
        
        for (const selector of selectors) {
          const el = $(selector);
          if (el.length > 0) {
            developerUrl = el.attr('content') || el.attr('href');
            if (developerUrl) break;
          }
        }
      } catch (cheerioErr) {
        logger.error({ cheerioErr, storeType }, 'Error using Cheerio for extraction');
      }
    }
    
    // When checking for developer URL, add more detailed logging
    if (!developerUrl) {
      // Log a sample of the HTML to help debug extraction patterns
      const htmlSample = data.length > 500 ? data.substring(0, 500) + '...' : data;
      logger.warn({ 
        bundleId, 
        storeType,
        htmlSample,
        patternCount: store.extractors.length
      }, 'Developer URL extraction failed');
      
      // Try to guess the domain from the bundle ID for Google Play apps
      if (storeType === 'googleplay' && /^[a-zA-Z0-9.]+\.[a-zA-Z0-9.]+(\.[a-zA-Z0-9]+)+$/i.test(validId)) {
        const parts = validId.toLowerCase().split('.');
        if (parts.length >= 2) {
          // Try to construct a domain from the bundle parts
          const possibleDomain = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
          logger.info({ bundleId: validId, guessedDomain: possibleDomain }, 'Attempting domain guess from bundle ID');
          
          // Check if this is a valid domain with app-ads.txt
          try {
            const appAdsCheck = await checkAppAdsTxt(possibleDomain, searchTerms);
            if (appAdsCheck.exists) {
              // We found a valid app-ads.txt at the guessed domain!
              logger.info({ bundleId: validId, domain: possibleDomain }, 'Successfully guessed domain from bundle ID');
              return {
                bundleId: validId,
                developerUrl: `https://${possibleDomain}`,
                domain: possibleDomain,
                storeType,
                appAdsTxt: appAdsCheck,
                searchTerms: searchTerms ? (Array.isArray(searchTerms) ? searchTerms : [searchTerms]) : null,
                success: true,
                guessedDomain: true,
                timestamp: Date.now()
              };
            }
          } catch (guessErr) {
            logger.debug({ err: guessErr.message, domain: possibleDomain }, 'Domain guess did not have app-ads.txt');
          }
        }
      }
      
      throw new Error(`Could not find developer URL for ${bundleId} in ${storeType}`);
    }
    
    // Extract domain from developer URL
    const domain = extractDomain(developerUrl);
    if (!domain) {
      throw new Error(`Could not extract valid domain from developer URL: ${developerUrl}`);
    }
    
    // Check for app-ads.txt
    const appAdsTxt = await checkAppAdsTxt(domain, searchTerms);
    
    // Prepare result
    const result = {
      bundleId: validId,
      developerUrl,
      domain,
      storeType,
      appAdsTxt,
      searchTerms: searchTerms ? (Array.isArray(searchTerms) ? searchTerms : [searchTerms]) : null,
      success: true,
      timestamp: Date.now()
    };
    
    // Cache result using case-aware key
    cache.set(cacheKey, result, 24);
    return result;
  } catch (err) {
    // This is the main error handler for the function
    logger.error({ 
      err: err.message, 
      bundleId, 
      storeType
    }, 'Final error in extractFromStore');
    
    throw err;
  }
}

// Enhanced store trying with better error handling and logging
async function tryAllStores(bundleId, searchTerms = null) {
  const validId = validateBundleId(bundleId);
  const results = [];
  const errors = [];
  
  logger.info({ bundleId: validId }, 'Trying all stores');
  
   for (const storeType of Object.keys(STORES)) {
    try {
      // Add delay between store attempts
      if (storeType !== Object.keys(STORES)[0]) {  // Skip delay for first store
        // Add longer delay for Roku
        const delay = storeType === 'roku' ? 3000 : 1500;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      // If Roku failed in the last hour, skip it to avoid blocking
      if (storeType === 'roku' && cache.get(`roku-blocked-${new Date().getHours()}`)) {
        logger.info({ bundleId, storeType }, 'Skipping Roku due to recent blocking');
        continue;
      }
      
      const result = await extractFromStore(validId, storeType, searchTerms);
      
      const result = await extractFromStore(validId, storeType, searchTerms);
      
      if (result.success) {
        logger.info({ bundleId: validId, storeType, domain: result.domain }, 'Successfully extracted from store');
        return result;
      }
      
      results.push(result);
    } catch (err) {
      // If this is a Roku blocking error, mark Roku as blocked for this hour
      if (storeType === 'roku' && 
          (err.message.includes('blocked') || err.message.includes('captcha'))) {
        cache.set(`roku-blocked-${new Date().getHours()}`, true, 1); // Cache for 1 hour
        logger.warn({ bundleId }, 'Marking Roku API as blocked for this hour');
      }
      logger.error({ 
        err: err.message, 
        bundleId: validId, 
        storeType,
        storeErrors: errors // Include all store errors
      }, 'Error trying store');
      
      errors.push({
        storeType,
        error: err.message,
        statusCode: err.response?.status
      });
      
      results.push({ 
        bundleId: validId, 
        storeType, 
        error: err.message, 
        success: false,
        timestamp: Date.now()
      });
    }
  }
  
  // If we get here, all stores failed
  const errorResult = {
    bundleId: validId,
    success: false,
    error: 'Failed to extract from any store',
    attemptedStores: Object.keys(STORES),
    storeErrors: errors,
    timestamp: Date.now()
  };
  
  // Cache the combined error result
  cache.set(`all-stores-${validId}`, errorResult, 1);
  
  throw new Error('Failed to extract from any store');
}

// Enhanced main extraction function with better error handling
async function getDeveloperInfo(bundleId, searchTerms = null) {
  try {
    const validId = validateBundleId(bundleId);
    const storeType = detectStoreType(validId);
    
    logger.debug({ bundleId: validId, storeType, hasSearchTerms: !!searchTerms }, 'Getting developer info');
    
    // Try the detected store type first, if known
    if (storeType !== 'unknown') {
      try {
        return await extractFromStore(validId, storeType, searchTerms);
      } catch (err) {
        logger.info({ 
          err: err.message, 
          bundleId: validId, 
          detectedStoreType: storeType 
        }, 'Failed with detected store type, trying all stores');
        
        // If the detected store failed, try all stores
        return await tryAllStores(validId, searchTerms);
      }
    } else {
      // Unknown store type, try all stores
      return await tryAllStores(validId, searchTerms);
    }
  } catch (err) {
    logger.error({ err, bundleId }, 'Error getting developer info');
    throw err;
  }
}

// Enhanced domain relationship analysis with improved safety
function analyzeDomainRelationships(results) {
  try {
    const validResults = results.filter(r => r.success && r.domain && typeof r.domain === 'string');
    
    if (validResults.length <= 1) {
      return {
        sharedDomains: [],
        appAdsTxtStats: {
          withAppAdsTxt: validResults.length > 0 && validResults[0].appAdsTxt?.exists ? 1 : 0,
          withoutAppAdsTxt: validResults.length > 0 && !validResults[0].appAdsTxt?.exists ? 1 : 0,
          percentageWithAppAdsTxt: validResults.length > 0 && validResults[0].appAdsTxt?.exists ? 100 : 0
        }
      };
    }
    
    const domains = {};
    validResults.forEach(r => {
      try {
        const domain = r.domain.toLowerCase();
        domains[domain] = (domains[domain] || 0) + 1;
      } catch (err) {
        logger.error({ err, result: r }, 'Error processing result in domain analysis');
      }
    });
    
    const sharedDomains = Object.entries(domains)
      .filter(([_, count]) => count > 1)
      .map(([domain, count]) => ({
        domain,
        count,
        percentage: Math.round((count / validResults.length) * 100)
      }))
      .sort((a, b) => b.count - a.count);
    
    const withAppAdsTxt = validResults.filter(r => r.appAdsTxt?.exists).length;
    
    return {
      sharedDomains,
      appAdsTxtStats: {
        withAppAdsTxt,
        withoutAppAdsTxt: validResults.length - withAppAdsTxt,
        percentageWithAppAdsTxt: Math.round((withAppAdsTxt / validResults.length) * 100)
      }
    };
  } catch (err) {
    logger.error({ err }, 'Error analyzing domain relationships');
    return {
      sharedDomains: [],
      appAdsTxtStats: {
        withAppAdsTxt: 0,
        withoutAppAdsTxt: 0,
        percentageWithAppAdsTxt: 0
      },
      error: 'Error analyzing domains'
    };
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  try {
    const uptime = process.uptime();
    const formattedUptime = formatUptime(uptime);
    
    res.json({
      status: 'up',
      uptime: formattedUptime,
      cacheStats: cache.getStats(),
      redis: redis ? 'connected' : 'not configured',
      version: process.env.npm_package_version || '2.1.0',
      nodeVersion: process.version
    });
  } catch (err) {
    logger.error({ err }, 'Health check error');
    res.status(500).json({ status: 'error', error: 'Health check failed' });
  }
});

// Format uptime in a readable way
function formatUptime(uptime) {
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  
  return parts.join(' ');
}

// API endpoint for processing multiple bundle IDs
app.post('/api/extract-multiple', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { bundleIds, searchTerms } = req.body;
    
    if (!bundleIds || !Array.isArray(bundleIds) || bundleIds.length === 0) {
      return res.status(400).json({ 
        error: 'Missing or invalid bundle IDs. Please provide an array of bundle IDs.', 
        success: false 
      });
    }
    
    // Limit the number of bundle IDs to prevent abuse
    const MAX_BUNDLE_IDS = 100;
    if (bundleIds.length > MAX_BUNDLE_IDS) {
      return res.status(400).json({
        error: `Too many bundle IDs. Maximum allowed is ${MAX_BUNDLE_IDS}.`,
        success: false
      });
    }
    
    const normalizedSearchTerms = validateSearchTerms(searchTerms);
    
    // Define case-sensitive stores
    const caseSensitiveStores = ['googleplay', 'samsung'];
    
    // Filter and deduplicate bundle IDs with case sensitivity awareness
    const uniqueIdsMap = new Map();
    
    bundleIds
      .filter(id => id && typeof id === 'string')
      .map(id => id.trim())
      .filter(Boolean)
      .forEach(id => {
        const storeType = detectStoreType(id);
        
        // For case-sensitive stores, use lowercase as the key but preserve original case in value
        const mapKey = caseSensitiveStores.includes(storeType) ? id.toLowerCase() : id;
        
        // Only add if we haven't seen this ID yet (case-insensitively for sensitive stores)
        // or replace if the new ID is from a case-sensitive store but the existing one isn't
        if (!uniqueIdsMap.has(mapKey) || 
            (caseSensitiveStores.includes(storeType) && 
             !caseSensitiveStores.includes(detectStoreType(uniqueIdsMap.get(mapKey))))) {
          uniqueIdsMap.set(mapKey, id);
        }
      });
    
    const uniqueIds = Array.from(uniqueIdsMap.values());
    
    if (uniqueIds.length === 0) {
      return res.status(400).json({
        error: 'No valid bundle IDs provided after filtering.',
        success: false
      });
    }
    
    logger.info({
      bundleIdsCount: uniqueIds.length,
      searchTermsCount: normalizedSearchTerms?.length || 0,
      clientIp: req.ip
    }, 'Processing bundle IDs');
    
    // Limit concurrency to avoid overloading
    const MAX_CONCURRENT = Math.min(5, uniqueIds.length);
    const results = [];
    const errors = [];
    let completed = 0;
    let skipped = 0;
    
    // Process in batches
    for (let i = 0; i < uniqueIds.length; i += MAX_CONCURRENT) {
      const batch = uniqueIds.slice(i, Math.min(i + MAX_CONCURRENT, uniqueIds.length));
      
      const batchPromises = batch.map(bundleId => (async () => {
        try {
          // Skip obviously invalid bundle IDs early
          if (!bundleId || bundleId.length < 2) {
            skipped++;
            return { 
              bundleId, 
              success: false, 
              error: 'Invalid bundle ID format',
              skipped: true
            };
          }
          
          const result = await getDeveloperInfo(bundleId, normalizedSearchTerms);
          completed++;
          return result;
        } catch (err) {
          completed++;
          errors.push({ bundleId, error: err.message });
          return { 
            bundleId, 
            success: false, 
            error: err.message,
            timestamp: Date.now()
          };
        }
      })());
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Log progress for large batches
      if (uniqueIds.length > 20) {
        logger.info({
          progress: `${Math.min((i + MAX_CONCURRENT), uniqueIds.length)}/${uniqueIds.length}`,
          timeElapsed: `${Math.round((Date.now() - startTime) / 1000)}s`
        }, 'Batch processing progress');
      }
    }
    
    // Calculate statistics
    const successResults = results.filter(r => r.success);
    const appsWithAppAdsTxt = successResults.filter(r => r.appAdsTxt?.exists).length;
    
    // Search statistics if applicable
    let searchStats = null;
    if (normalizedSearchTerms?.length > 0) {
      const appsWithMatches = successResults.filter(r => 
        r.appAdsTxt?.exists && r.appAdsTxt.searchResults?.count > 0
      ).length;
      
      const totalMatches = successResults.reduce((sum, r) => 
        sum + (r.appAdsTxt?.exists ? r.appAdsTxt.searchResults?.count || 0 : 0), 0
      );
      
      searchStats = {
        terms: normalizedSearchTerms,
        appsWithMatches,
        totalMatches
      };
    }
    
    // Domain relationship analysis
    const domainAnalysis = analyzeDomainRelationships(results);
    const processingTime = Date.now() - startTime;
    
    logger.info({
      completed,
      skipped,
      processingTime,
      errorCount: errors.length,
      successCount: successResults.length
    }, 'Completed processing');
    
    // Return the results
    return res.json({
      results,
      errorCount: errors.length,
      successCount: successResults.length,
      skippedCount: skipped,
      totalProcessed: uniqueIds.length,
      appsWithAppAdsTxt,
      searchStats,
      domainAnalysis,
      cacheStats: cache.getStats(),
      success: true,
      processingTime: `${processingTime}ms`
    });
  } catch (err) {
    const processingTime = Date.now() - startTime;
    logger.error({ err, processingTime }, 'API error');
    
    return res.status(500).json({ 
      error: 'Internal server error processing your request', 
      success: false,
      processingTime: `${processingTime}ms`
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error({ 
    err, 
    url: req.url, 
    method: req.method,
    ip: req.ip
  }, 'Unhandled error');
  
  res.status(500).json({
    error: 'Internal Server Error',
    success: false
  });
});

// Start the server
const server = app.listen(PORT, () => {
  logger.info({ 
    port: PORT, 
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version
  }, 'Server started');
});

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
  logger.info('Received shutdown signal, closing server gracefully');
  
  server.close(() => {
    logger.info('HTTP server closed');
    
    if (redis) {
      redis.quit().then(() => {
        logger.info('Redis connection closed');
        process.exit(0);
      }).catch(err => {
        logger.error({ err }, 'Error closing Redis connection');
        process.exit(1);
      });
    } else {
      process.exit(0);
    }
  });
  
  // Force shutdown after 10 seconds if server hasn't closed
  setTimeout(() => {
    logger.error('Server did not close in time, forcing shutdown');
    process.exit(1);
  }, 10000);
}

module.exports = app; // For testing