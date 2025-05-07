/**
 * Store configuration for App-Ads.txt Extractor
 * Contains URL templates, extractors, and rate limiting settings for each app store
 */

'use strict';

/**
 * Store configurations object
 * Each store has:
 * - urlTemplate: Function to generate store URL from bundle ID
 * - extractors: Array of functions to extract developer URL from HTML
 * - rateLimit: Rate limiting settings for the store
 */
const stores = {
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

/**
 * Helper function to detect store type from bundle ID format
 * @param {string} id - The bundle ID to analyze
 * @returns {string} - Store type identifier or 'unknown'
 */
function detectStoreType(id) {
  if (!id || typeof id !== 'string') return 'unknown';
  
  const trimmedId = id.trim();
  
  // Normalize Amazon IDs to uppercase
  if (/^[bB][0-9A-Za-z]{9,10}$/i.test(trimmedId)) {
    return 'amazon';
  }
  
  // Samsung - Case-insensitive check for Galaxy Store IDs
  if (/^[gG]\d{8,15}$/i.test(trimmedId)) {
    return 'samsung';
  }
  
  // App Store - iOS apps with numeric IDs 
  if (/^(id)?\d{8,12}$/i.test(trimmedId)) {
    return 'appstore';
  }
  
  // Google Play - standard package name format
  if (/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(trimmedId)) {
    return 'googleplay';
  }
  
  // Roku - numeric IDs identification (to be skipped later) or specific format
  if (/^\d{4,6}$/.test(trimmedId)) {
    return 'roku-numeric';
  }
  
  // Roku - other valid formats
  if (/^[a-f0-9]{32}:[a-f0-9]{32}$/i.test(trimmedId)) {
    return 'roku';
  }
  
  // Fallback for other Roku formats - after checking other patterns
  if (/^[a-zA-Z0-9]{4,}$/.test(trimmedId) && !trimmedId.includes('.')) {
    return 'roku';
  }
  
  return 'unknown';
}

module.exports = {
  stores,
  detectStoreType
};