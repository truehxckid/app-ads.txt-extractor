/**
 * Roku Proxy Module
 * Specialized handling for Roku channel store access
 */

'use strict';

// Dependencies
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

// Initialize module with dependencies
let logger;
let cache;

/**
 * Initialize the Roku proxy with required dependencies
 * @param {Object} deps - Dependencies including logger and cache
 */
function initialize(deps) {
  logger = deps.logger;
  cache = deps.cache;
  
  logger.info('Roku proxy module initialized');
  return module.exports;
}

/**
 * Special proxy function for accessing Roku store data
 * @param {string} bundleId - Roku bundle ID
 * @param {array} searchTerms - Optional search terms
 * @returns {Promise<object>} Roku app details
 */
async function getRokuDeveloperInfo(bundleId, searchTerms = null) {
  logger.info({ bundleId }, 'Using Roku store proxy');
  
  // Check cache first if available
  if (cache) {
    const cacheKey = `roku-store-${bundleId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      logger.debug({ bundleId }, 'Returning cached Roku data');
      return cached;
    }
  }
  
  // Try different approaches in sequence
  try {
    // Approach 1: Try alternative URL format
    const urlResult = await tryRokuAlternativeUrl(bundleId);
    if (urlResult.success) {
      // If successful, check for app-ads.txt
      if (urlResult.domain) {
        try {
          urlResult.appAdsTxt = await checkAppAdsTxt(urlResult.domain, searchTerms);
          urlResult.searchTerms = searchTerms ? (Array.isArray(searchTerms) ? searchTerms : [searchTerms]) : null;
        } catch (adsTxtErr) {
          logger.debug({ err: adsTxtErr.message, domain: urlResult.domain }, 'Error checking app-ads.txt');
          urlResult.appAdsTxt = { exists: false };
        }
      }
      
      // Cache successful result
      if (cache) {
        const cacheKey = `roku-store-${bundleId}`;
        cache.set(cacheKey, urlResult, 24); // 24 hours
      }
      return urlResult;
    }
    
    // Approach 2: Try API-based access
    const apiResult = await tryRokuApi(bundleId);
    if (apiResult.success) {
      // If successful, check for app-ads.txt
      if (apiResult.domain) {
        try {
          apiResult.appAdsTxt = await checkAppAdsTxt(apiResult.domain, searchTerms);
          apiResult.searchTerms = searchTerms ? (Array.isArray(searchTerms) ? searchTerms : [searchTerms]) : null;
        } catch (adsTxtErr) {
          logger.debug({ err: adsTxtErr.message, domain: apiResult.domain }, 'Error checking app-ads.txt');
          apiResult.appAdsTxt = { exists: false };
        }
      }
      
      // Cache successful result
      if (cache) {
        const cacheKey = `roku-store-${bundleId}`;
        cache.set(cacheKey, apiResult, 24); // 24 hours
      }
      return apiResult;
    }
    
    // Approach 3: Use fallback data
    const fallbackResult = await getRokuFallbackData(bundleId, searchTerms);
    
    // Cache the result (even if unsuccessful)
    if (cache) {
      const cacheKey = `roku-store-${bundleId}`;
      const cacheDuration = fallbackResult.success ? 72 : 6; // Longer for success, shorter for failure
      cache.set(cacheKey, fallbackResult, cacheDuration);
    }
    
    return fallbackResult;
    
  } catch (err) {
    logger.error({ err, bundleId }, 'All Roku proxy methods failed');
    
    const errorResult = {
      bundleId,
      storeType: 'roku',
      success: false,
      error: `Could not access Roku data: ${err.message}`,
      timestamp: Date.now()
    };
    
    // Cache error result for a short time
    if (cache) {
      const cacheKey = `roku-store-${bundleId}`;
      cache.set(cacheKey, errorResult, 1); // 1 hour
    }
    
    throw new Error(`Could not access Roku data for ${bundleId} through any available method`);
  }
}

/**
 * Try alternative URL formats for Roku
 */
async function tryRokuAlternativeUrl(bundleId) {
  // Different URL patterns to try
  const urlPatterns = [
    // Official channel store
    id => `https://channelstore.roku.com/details/${encodeURIComponent(id)}`,
    // Mobile version
    id => `https://channelstore.roku.com/en-gb/details/${encodeURIComponent(id)}`,
    // Developer portal format
    id => `https://developer.roku.com/channel/${encodeURIComponent(id)}`,
    // Web search results format
    id => `https://www.roku.com/search/channels?q=${encodeURIComponent(id)}`,
  ];
  
  // Try each URL pattern
  for (const pattern of urlPatterns) {
    try {
      const url = pattern(bundleId);
      logger.debug({ bundleId, url }, 'Trying alternative Roku URL');
      
      // Add random delay to appear more natural
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
      
      // Use a more browser-like request
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': getBrowserLikeUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Cache-Control': 'max-age=0',
          'TE': 'trailers',
          // Generate a plausible cookie
          'Cookie': `roku_visitor=${Math.random().toString(36).substring(2,15)}; _ga=GA1.2.${Math.floor(Math.random() * 1000000000)}.${Math.floor(Date.now()/1000)}`
        }
      });
      
      // Process response
      if (response.data && typeof response.data === 'string') {
        // Check for captcha or blocking page
        if (response.data.includes('captcha') || 
            response.data.includes('security check') || 
            response.data.includes('automated access') || 
            response.data.includes('blocked') ||
            response.data.includes('suspicious activity') || 
            response.data.includes('verify you are a human') ||
            response.data.includes('unusual traffic') || 
            response.data.includes('access denied')) {
          
          logger.warn({ bundleId, url }, 'Captcha or blocking detected on Roku page');
          throw new Error('Access to Roku might be temporarily blocked. Try changing your IP address.');
        }
        
        // Extract developer information
        const developerInfo = extractRokuDeveloperInfo(response.data, url);
        if (developerInfo) {
          return {
            bundleId,
            developerUrl: developerInfo.url,
            domain: developerInfo.domain,
            storeType: 'roku',
            success: true,
            method: 'alternative-url',
            timestamp: Date.now()
          };
        }
      }
    } catch (err) {
      logger.debug({ err: err.message, url }, 'Alternative Roku URL failed');
      // Continue to next pattern
    }
  }
  
  return { success: false };
}

/**
 * Try to use Roku's search API
 */
async function tryRokuApi(bundleId) {
  try {
    // Roku has a search API we can try
    const apiUrl = `https://apiservice.roku.com/search/v1/search?keyword=${encodeURIComponent(bundleId)}&sources=channel`;
    
    logger.debug({ bundleId, apiUrl }, 'Trying Roku API');
    
    const response = await axios.get(apiUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.5',
        'Origin': 'https://www.roku.com',
        'Referer': 'https://www.roku.com/search'
      }
    });
    
    if (response.data && response.data.results) {
      // Find matching channel
      const channel = response.data.results.find(item => 
        item.id === bundleId || 
        (item.channelId && item.channelId === bundleId)
      );
      
      if (channel) {
        // Extract domain from developer info
        const developerName = channel.developer || channel.provider;
        // Try to construct a domain from developer name
        const domain = constructDomainFromName(developerName);
        
        if (domain) {
          return {
            bundleId,
            developerUrl: `https://${domain}`,
            domain,
            storeType: 'roku',
            success: true,
            method: 'api',
            developerName,
            channelName: channel.title || channel.name,
            timestamp: Date.now()
          };
        }
      }
    }
    
    return { success: false };
  } catch (err) {
    logger.debug({ err: err.message }, 'Roku API access failed');
    return { success: false };
  }
}

/**
 * Get fallback data for Roku channels
 */
async function getRokuFallbackData(bundleId, searchTerms) {
  // Check in cache first
  const cacheKey = `roku-fallback-${bundleId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  
  // Try to find in our local database
  const fallbackData = ROKU_FALLBACKS[bundleId];
  
  if (fallbackData) {
    logger.info({ bundleId }, 'Using fallback data for Roku channel');
    
    // Check for app-ads.txt if domain is available
    let appAdsTxt = { exists: false };
    if (fallbackData.domain) {
      try {
        appAdsTxt = await checkAppAdsTxt(fallbackData.domain, searchTerms);
      } catch (err) {
        logger.debug({ err: err.message, domain: fallbackData.domain }, 'Failed to check app-ads.txt');
      }
    }
    
    const result = {
      bundleId,
      developerUrl: fallbackData.developerUrl || `https://${fallbackData.domain}`,
      domain: fallbackData.domain,
      storeType: 'roku',
      appAdsTxt,
      searchTerms: searchTerms ? (Array.isArray(searchTerms) ? searchTerms : [searchTerms]) : null,
      success: true,
      method: 'fallback',
      developerName: fallbackData.developerName,
      timestamp: Date.now()
    };
    
    // Cache result
    cache.set(cacheKey, result, 72); // Cache for 3 days
    return result;
  }
  
  // Try guessing based on common patterns
  if (/^\d+$/.test(bundleId)) {
    // Common Roku channels by their IDs
    const commonChannels = {
      '2285': { domain: 'netflix.com', developerName: 'Netflix, Inc.' },
      '13': { domain: 'amazon.com', developerName: 'Amazon' },
      '8378': { domain: 'disneyplus.com', developerName: 'Disney' },
      '41468': { domain: 'roku.com', developerName: 'Roku, Inc.' },
      // Add more known channels
    };
    
    if (commonChannels[bundleId]) {
      logger.info({ bundleId }, 'Using common channel data for Roku');
      
      // Check for app-ads.txt
      let appAdsTxt = { exists: false };
      try {
        appAdsTxt = await checkAppAdsTxt(commonChannels[bundleId].domain, searchTerms);
      } catch (err) {
        logger.debug({ err: err.message }, 'Failed to check app-ads.txt');
      }
      
      const result = {
        bundleId,
        developerUrl: `https://${commonChannels[bundleId].domain}`,
        domain: commonChannels[bundleId].domain,
        storeType: 'roku',
        appAdsTxt,
        searchTerms: searchTerms ? (Array.isArray(searchTerms) ? searchTerms : [searchTerms]) : null,
        success: true,
        method: 'common-channel',
        developerName: commonChannels[bundleId].developerName,
        guessed: true,
        timestamp: Date.now()
      };
      
      // Cache result
      cache.set(cacheKey, result, 24); // Cache for 24 hours
      return result;
    }
  }
  
  // Last resort: return a partial result
  return {
    bundleId,
    storeType: 'roku',
    success: false,
    error: 'Could not find developer information for this Roku channel',
    method: 'fallback-failed',
    timestamp: Date.now()
  };
}

/**
 * Check if a bundle ID is a valid Roku ID
 * @param {string} bundleId - The bundle ID to check
 * @returns {boolean} - Whether it's a valid Roku ID
 */
function isRokuBundleId(bundleId) {
  if (!bundleId || typeof bundleId !== 'string') return false;
  
  // Check for complex Roku ID (most specific pattern first)
  if (/^[a-f0-9]{32}:[a-f0-9]{32}$/i.test(bundleId)) return true;
  
  // Check for simple Roku ID (2-6 digits)
  if (/^\d{2,6}$/i.test(bundleId)) return true;
  
  return false;
}

/**
 * Get a browser-like user agent
 */
function getBrowserLikeUserAgent() {
  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
    // TV devices
    'Mozilla/5.0 (Linux; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36',
    'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/79.0.3945.116 Safari/537.36 RokuStreamingStick/12.5.0.0 (7000X)'
  ];
  return agents[Math.floor(Math.random() * agents.length)];
}

/**
 * Extract Roku developer info from HTML
 */
function extractRokuDeveloperInfo(html, sourceUrl) {
  try {
    const $ = cheerio.load(html);
    
    // Try various selectors for developer info
    const selectors = [
      '.developer-name a',
      'a[href*="developer"]',
      'a:contains("More from")',
      '.provider-name a',
      'a[href*="provider"]'
    ];
    
    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length) {
        const href = element.attr('href');
        const text = element.text().trim();
        
        if (href) {
          // If it's a relative URL, make it absolute
          const absoluteUrl = href.startsWith('http') ? href : new URL(href, sourceUrl).toString();
          // Extract domain
          const domain = extractDomain(absoluteUrl) || constructDomainFromName(text);
          
          return {
            url: absoluteUrl,
            domain,
            name: text
          };
        } else if (text) {
          // Try to construct domain from developer name
          const domain = constructDomainFromName(text);
          if (domain) {
            return {
              url: `https://${domain}`,
              domain,
              name: text
            };
          }
        }
      }
    }
    
    // Try meta tags
    const metaTags = [
      'meta[property="og:site_name"]',
      'meta[name="author"]',
      'meta[name="publisher"]'
    ];
    
    for (const tag of metaTags) {
      const element = $(tag).first();
      if (element.length) {
        const content = element.attr('content');
        if (content) {
          const domain = constructDomainFromName(content);
          if (domain) {
            return {
              url: `https://${domain}`,
              domain,
              name: content
            };
          }
        }
      }
    }
    
    return null;
  } catch (err) {
    logger.error({ err, sourceUrl }, 'Error extracting Roku developer info');
    return null;
  }
}

/**
 * Extract domain from URL
 */
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
    
    return extractedDomain;
  } catch (err) {
    logger.error({ err, url }, 'Error extracting domain');
    return '';
  }
}

/**
 * Try to construct a domain from a company/developer name
 */
function constructDomainFromName(name) {
  if (!name) return null;
  
  // Clean the name
  const cleanName = name.toLowerCase()
    .replace(/[^\w\s.-]/g, '')  // Remove special chars except dots, hyphens
    .replace(/\s+/g, '')        // Remove spaces
    .trim();
  
  // Common domains for well-known companies
  const knownDomains = {
    'netflix': 'netflix.com',
    'amazon': 'amazon.com',
    'disney': 'disney.com',
    'disneyplus': 'disneyplus.com',
    'hulu': 'hulu.com',
    'roku': 'roku.com',
    'hbo': 'hbo.com',
    'hbomax': 'hbomax.com',
    'cbs': 'cbs.com',
    'paramount': 'paramount.com',
    'nbcuniversal': 'nbcuniversal.com',
    'nbc': 'nbc.com',
    'fox': 'fox.com',
    'youtube': 'youtube.com',
    'google': 'google.com',
    'pbs': 'pbs.org',
    'espn': 'espn.com',
    'warnermedia': 'warnermedia.com',
    'warnerbros': 'warnerbros.com',
    'sony': 'sony.com',
    'sonyentertainment': 'sonyentertainment.com',
    'showtime': 'showtime.com',
    'starz': 'starz.com',
    'viacom': 'viacom.com',
    'viacomcbs': 'viacomcbs.com'
  };
  
  // Check for known domains
  for (const [key, domain] of Object.entries(knownDomains)) {
    if (cleanName.includes(key)) {
      return domain;
    }
  }
  
  // For other cases, try to construct a plausible domain
  // If name has 'inc', 'llc', etc., remove it
  const simplifiedName = cleanName
    .replace(/inc$|llc$|ltd$|corp$|corporation$|company$/, '');
  
  // If it looks like a domain already, use it
  if (simplifiedName.includes('.')) {
    // Check that it has a valid TLD
    const parts = simplifiedName.split('.');
    const validTlds = ['com', 'org', 'net', 'io', 'co', 'tv', 'app'];
    
    if (parts.length >= 2 && validTlds.includes(parts[parts.length - 1])) {
      return simplifiedName;
    }
  }
  
  // Otherwise, add .com
  return simplifiedName + '.com';
}

/**
 * Check app-ads.txt for a domain
 * This should be provided by the main application when initializing this module
 */
let checkAppAdsTxt = async (domain, searchTerms) => {
  // Default implementation - should be overridden
  logger.warn('checkAppAdsTxt function not provided to Roku proxy module');
  return { exists: false };
};

// List of known Roku channels
const ROKU_FALLBACKS = {
  // Major channels by ID
  '2285': { 
    domain: 'netflix.com', 
    developerName: 'Netflix, Inc.',
    developerUrl: 'https://netflix.com'
  },
  '13': { 
    domain: 'amazon.com', 
    developerName: 'Amazon',
    developerUrl: 'https://amazon.com' 
  },
  '8378': { 
    domain: 'disneyplus.com', 
    developerName: 'Disney',
    developerUrl: 'https://disneyplus.com' 
  },
  '41468': { 
    domain: 'roku.com', 
    developerName: 'Roku, Inc.',
    developerUrl: 'https://roku.com' 
  },
  // Complex ID example
  '628b9da6dfad4351c27c11ac5bbdbb1c:0fe5bedf19da3a3cbb5444c4da1797f6': {
    domain: 'roku.com',
    developerName: 'Roku, Inc.',
    developerUrl: 'https://roku.com'
  },
  // Add more known channels as needed
};

// Public API
module.exports = {
  initialize,
  getRokuDeveloperInfo,
  isRokuBundleId,
  setAppAdsTxtChecker: (checker) => {
    checkAppAdsTxt = checker;
  }
};