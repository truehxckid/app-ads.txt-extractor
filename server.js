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
const axiosRetry = require('axios-retry'); // This returns the function itself
const cheerio = require('cheerio');
const psl = require('psl');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pino = require('pino');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Redis for rate limiting (optional)
let redis = null;
try {
  if (process.env.REDIS_URL) {
    const Redis = require('ioredis');
    redis = new Redis(process.env.REDIS_URL);
    
    // Test connection
    redis.on('error', (err) => {
      logger.error({ err }, 'Redis connection error. Falling back to memory store');
      redis = null;
    });
  }
} catch (err) {
  console.error('Redis initialization failed:', err);
}

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

// Comment out or remove the axios-retry code
// const axiosRetry = require('axios-retry');
// 
// axiosRetry(axios, {
//   retries: 3,
//   retryDelay: (retryCount) => {
//     return retryCount * 1000;
//   },
//   retryCondition: (error) => {
//     return (
//       axiosRetry.isNetworkOrIdempotentRequestError(error) ||
//       (error.response && error.response.status === 429)
//     );
//   }
// });

// Enable security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
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
  cache: path.join(__dirname, 'cache')
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
    
    try {
      const results = await this.client
        .multi()
        .incr(redisKey)
        .expire(redisKey, 60 * 15) // 15 minutes in seconds
        .exec();
        
      // Extract the incremented value from multi results
      return results[0][1]; // This accesses the value from the INCR operation
    } catch (err) {
      logger.error({ err, key: redisKey }, 'Redis increment error');
      return 1; // Allow request on error
    }
  }
  
  // Implement the required methods for the Store interface
  async decrement(key) {
    const redisKey = `${this.prefix}${key}`;
    try {
      return await this.client.decr(redisKey);
    } catch (err) {
      logger.error({ err, key: redisKey }, 'Redis decrement error');
      return 0;
    }
  }
  
  async resetKey(key) {
    const redisKey = `${this.prefix}${key}`;
    try {
      return await this.client.del(redisKey);
    } catch (err) {
      logger.error({ err, key: redisKey }, 'Redis resetKey error');
      return 0;
    }
  }
  
  async resetAll() {
    try {
      // This is a simplified version - in production, you might want a more targeted approach
      const keys = await this.client.keys(`${this.prefix}*`);
      if (keys.length) {
        return await this.client.del(keys);
      }
      return 0;
    } catch (err) {
      logger.error({ err }, 'Redis resetAll error');
      return 0;
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
              html.match(/href="(https:\/\/play\.google\.com\/store\/apps\/developer\?[^"]+)"/i)?.[1]
    ],
    rateLimit: { requests: 10, windowMs: 1000 }
  },
  appstore: {
    urlTemplate: id => `https://apps.apple.com/us/app/${encodeURIComponent(/^\d+$/.test(id) ? 'id' + id : id)}`,
    extractors: [
      html => html.match(/<a[^>]*class=['"]link\s+icon\s+icon-after\s+icon-external['"][^>]*href=['"]([^'"]+)['"]/i)?.[1],
      html => html.match(/href="(https:\/\/apps\.apple\.com[^"]+\/developer\/[^"]+)"/i)?.[1]
    ],
    rateLimit: { requests: 12, windowMs: 1000 }
  },
  amazon: {
    urlTemplate: id => `https://www.amazon.com/dp/${encodeURIComponent(id)}`,
    extractors: [
      html => html.match(/href="(https:\/\/www\.amazon\.com\/[^"]+\/developer\/[^"]+)"/i)?.[1],
      html => html.match(/href="([^"]+)"[^>]*>Visit the ([^<]+) Store</i)?.[1]
    ],
    rateLimit: { requests: 8, windowMs: 1500 }
  },
  roku: {
    urlTemplate: id => `https://channelstore.roku.com/details/${encodeURIComponent(id)}`,
    extractors: [
      html => html.match(/<meta\s+name=['"]appstore:developer_url['"][^>]*content=['"]([^'"]+)['"]/i)?.[1],
      html => html.match(/href="(https:\/\/channelstore\.roku\.com\/[^"]*?\/developer\/[^"]+)"/i)?.[1],
      html => html.match(/href="([^"]+)"[^>]*>More by ([^<]+)</i)?.[1]
    ],
    rateLimit: { requests: 10, windowMs: 1200 }
  },
  samsung: {
    urlTemplate: id => `https://www.samsung.com/us/appstore/app/${encodeURIComponent(id)}`,
    extractors: [
      html => html.match(/<meta\s+name=['"]appstore:developer_url['"][^>]*content=['"]([^'"]+)['"]/i)?.[1],
      html => html.match(/href="(https:\/\/www\.samsung\.com\/[^"]*?\/developer\/[^"]+)"/i)?.[1],
      html => html.match(/href="([^"]+)"[^>]*>More from Developer</i)?.[1],
      html => html.match(/Developer<\/dt>[^<]*<dd[^>]*>[^<]*<a[^>]*href="([^"]+)"/i)?.[1]
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
    this.maxMemorySize = 1000; // Maximum number of items in memory cache
    this.cleanupInterval = 60 * 60 * 1000; // 1 hour
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

// Enhanced user agent rotation
function getRandomUserAgent() {
  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
  ];
  return agents[Math.floor(Math.random() * agents.length)];
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
    return trimmed ? [trimmed] : null;
  }
  
  if (Array.isArray(terms)) {
    const validTerms = terms
      .filter(term => term && typeof term === 'string')
      .map(term => term.toLowerCase().trim())
      .filter(Boolean);
    
    return validTerms.length > 0 ? validTerms : null;
  }
  
  throw new Error('Invalid search terms: must be a string or array of strings');
}

// Enhanced store type detection
function detectStoreType(id) {
  try {
    const validId = validateBundleId(id);
    
    if (/^[a-f0-9]{32}:[a-f0-9]{32}$/i.test(validId)) return 'roku';
    if (/^B[0-9A-Z]{9,10}$/i.test(validId)) return 'amazon';
    if (/^(id)?\d+$/.test(validId)) return /^\d{4,6}$/.test(validId) ? 'roku' : 'appstore';
    if (/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(validId)) return 'googleplay';
    if (/^G\d{10,15}$/i.test(validId)) return 'samsung';
    // More specific Roku pattern - not starting with 'G' (Samsung pattern)
    // and either entirely numeric (not covered by earlier patterns) 
    // or alphanumeric but not meeting other patterns
    if (/^(?!G\d)[a-zA-Z0-9]{4,}$/.test(validId) && !validId.includes('.')) return 'roku';
    
    return 'unknown';
  } catch (err) {
    logger.error({ err, id }, 'Error detecting store type');
    return 'unknown';
  }
}

// Enhanced domain extraction using PSL library
function extractDomain(url) {
  try {
    if (!url || typeof url !== 'string') return '';
    
    // Remove protocol and path
    const match = url.match(/^(?:https?:\/\/)?([^\/]+)/i);
    if (!match) return '';
    
    const hostname = match[1];
    const parsed = psl.parse(hostname);
    
    if (parsed.domain) {
      return parsed.domain;
    }
    
    // Fallback to hostname if parsing fails
    return hostname;
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
    
    for (const protocol of protocols) {
      if (content) break;
      
      try {
        // Apply rate limiting to avoid overloading servers
        await applyRateLimit('appstore');
        
        const url = `${protocol}://${domain}/app-ads.txt`;
        logger.debug({ url }, 'Fetching app-ads.txt');
        
        const response = await axios.get(url, {
          timeout: 10000,
          headers: {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/plain,text/html',
            'Accept-Encoding': 'gzip, deflate'
          },
          validateStatus: status => status === 200
        });
        
        if (response.data && typeof response.data === 'string') {
          content = response.data.trim();
          usedProtocol = protocol;
          break;
        }
      } catch (err) {
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
        fetchErrors: fetchErrors.length > 0 ? fetchErrors : undefined
      };
      cache.set(cacheKey, result, 6); // Cache non-existing files for shorter period
      return result;
    }
    
    fileSize = content.length;
    
    // Check if content is too large for synchronous processing
    const isLargeFile = content.length > 100000; // Adjust this threshold as needed
    processingMethod = isLargeFile ? 'worker' : 'sync';
    
    logger.debug({
      domain,
      fileSize,
      processingMethod
    }, 'Processing app-ads.txt');
    
    let analyzed, searchResults;
    
    if (isLargeFile) {
      // Use worker thread for large files
      const workerResult = await runWorker(content, normalizedSearchTerms);
      
      if (!workerResult.success) {
        throw new Error(`Worker thread error: ${workerResult.error}`);
      }
      
      analyzed = workerResult.analyzed;
      searchResults = workerResult.searchResults;
    } else {
      // Process smaller files synchronously
      const lines = content.split(/\r\n|\n|\r/);
      
      // Analyze the file content
      analyzed = analyzeAppAdsTxt(lines);
      
      // Process search terms if provided
      if (normalizedSearchTerms?.length > 0) {
        searchResults = processSearchTerms(lines, normalizedSearchTerms);
      }
    }
    
    const result = {
      exists: true,
      url: `${usedProtocol}://${domain}/app-ads.txt`,
      content: content.length > 100000 
        ? content.substring(0, 100000) + '\n... (truncated, file too large)' 
        : content,
      contentLength: content.length,
      analyzed,
      searchResults
    };
    
    const processingTime = Date.now() - startTime;
    logger.debug({
      domain,
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
      error: 'Internal error processing app-ads.txt'
    };
    
    cache.set(cacheKey, result, 1); // Short cache time for errors
    return result;
  }
}

// Process search terms against lines of content
function processSearchTerms(lines, searchTerms) {
  const searchResults = {
    terms: searchTerms,
    termResults: searchTerms.map(term => ({
      term,
      matchingLines: [],
      count: 0
    })),
    matchingLines: [],
    count: 0
  };
  
  // Process each line
  lines.forEach((line, lineIndex) => {
    const lineContent = line.trim();
    if (!lineContent) return;
    
    const lineNumber = lineIndex + 1;
    let anyMatch = false;
    
    // Check each search term
    searchTerms.forEach((term, termIndex) => {
      try {
        if (lineContent.toLowerCase().includes(term)) {
          searchResults.termResults[termIndex].matchingLines.push({
            lineNumber,
            content: lineContent,
            termIndex
          });
          anyMatch = true;
        }
      } catch (err) {
        logger.error({ err, term, lineContent }, 'Error matching search term');
      }
    });
    
    // If any term matched, add to overall results
    if (anyMatch) {
      searchResults.matchingLines.push({
        lineNumber,
        content: lineContent
      });
    }
  });
  
  // Update counts
  searchResults.termResults.forEach(result => {
    result.count = result.matchingLines.length;
  });
  searchResults.count = searchResults.matchingLines.length;
  
  return searchResults;
}

// Analyze app-ads.txt content
function analyzeAppAdsTxt(lines) {
  let validLineCount = 0;
  let commentLineCount = 0;
  let emptyLineCount = 0;
  let invalidLineCount = 0;
  
  const publishers = new Set();
  const relationships = {
    direct: 0,
    reseller: 0,
    other: 0
  };
  
  lines.forEach(line => {
    // Skip empty lines
    if (!line.trim()) {
      emptyLineCount++;
      return;
    }
    
    // Handle comments
    const commentIndex = line.indexOf('#');
    if (commentIndex === 0) {
      commentLineCount++;
      return;
    }
    
    const cleanLine = commentIndex >= 0 ? line.substring(0, commentIndex).trim() : line.trim();
    if (!cleanLine) {
      emptyLineCount++;
      return;
    }
    
    // Parse fields
    const fields = cleanLine.split(',').map(f => f.trim());
    
    if (fields.length >= 3) {
      validLineCount++;
      
      // Extract publisher
      const domain = fields[0].toLowerCase();
      publishers.add(domain);
      
      // Extract relationship
      const relationship = fields[2].toLowerCase();
      if (relationship === 'direct') {
        relationships.direct++;
      } else if (relationship === 'reseller') {
        relationships.reseller++;
      } else {
        relationships.other++;
      }
    } else {
      invalidLineCount++;
    }
  });
  
  return {
    totalLines: lines.length,
    validLines: validLineCount,
    commentLines: commentLineCount,
    emptyLines: emptyLineCount,
    invalidLines: invalidLineCount,
    uniquePublishers: publishers.size,
    relationships
  };
}

// Enhanced store extraction with better error handling
async function extractFromStore(bundleId, storeType, searchTerms = null) {
  try {
    const store = STORES[storeType];
    if (!store) {
      throw new Error(`Unsupported store type: ${storeType}`);
    }
    
    const validId = validateBundleId(bundleId);
    const url = store.urlTemplate(validId);
    const cacheKey = `store-${storeType}-${validId}`;
    
    // Check cache first
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
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      }
    });
    
    if (!response.data || typeof response.data !== 'string') {
      throw new Error(`Empty or invalid response from ${storeType}`);
    }
    
    const data = response.data;
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
    
    if (!developerUrl) {
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
    
    // Cache result
    cache.set(cacheKey, result, 24);
    return result;
  } catch (err) {
    const errorMessage = err.response?.status 
      ? `HTTP ${err.response.status}: ${err.response.statusText || err.message}`
      : err.message;
    
    logger.error({ 
      err: errorMessage, 
      bundleId, 
      storeType,
      url: err.config?.url,
      status: err.response?.status
    }, 'Error extracting from store');
    
    const errorResult = { 
      bundleId: validateBundleId(bundleId), 
      storeType, 
      success: false, 
      error: errorMessage,
      timestamp: Date.now()
    };
    
    // Cache errors for a shorter period
    cache.set(`store-${storeType}-${bundleId}`, errorResult, 1);
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
      const result = await extractFromStore(validId, storeType, searchTerms);
      
      if (result.success) {
        logger.info({ bundleId: validId, storeType, domain: result.domain }, 'Successfully extracted from store');
        return result;
      }
      
      results.push(result);
    } catch (err) {
      logger.error({ err: err.message, bundleId: validId, storeType }, 'Error trying store');
      
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
    
    // Filter and deduplicate bundle IDs
    const uniqueIds = [...new Set(
      bundleIds
        .filter(id => id && typeof id === 'string')
        .map(id => id.trim())
        .filter(Boolean)
    )];
    
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