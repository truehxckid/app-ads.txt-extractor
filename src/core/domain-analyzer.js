/**
 * Domain Analyzer for App-Ads.txt Extractor
 * Analyzes relationships between domains and app-ads.txt files
 */

'use strict';

const cache = require('../services/cache');
const { keys } = require('../config/cache');
const { getLogger } = require('../utils/logger');

const logger = getLogger('domain-analyzer');

/**
 * Analyze domain relationships from extraction results
 * @param {Array<object>} results - Array of extraction results
 * @returns {object} - Analysis results
 */
function analyzeDomainRelationships(results) {
  try {
    // Filter for valid results with domains
    const validResults = results.filter(r => r.success && r.domain && typeof r.domain === 'string');
    
    logger.debug({ totalResults: results.length, validResults: validResults.length }, 'Analyzing domains');
    
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
    
    // Count domain occurrences
    const domains = {};
    validResults.forEach(r => {
      try {
        const domain = r.domain.toLowerCase();
        domains[domain] = (domains[domain] || 0) + 1;
      } catch (err) {
        logger.error({ error: err.message, result: r }, 'Error processing result in domain analysis');
      }
    });
    
    // Find shared domains (domains used by multiple apps)
    const sharedDomains = Object.entries(domains)
      .filter(([_, count]) => count > 1)
      .map(([domain, count]) => ({
        domain,
        count,
        percentage: Math.round((count / validResults.length) * 100)
      }))
      .sort((a, b) => b.count - a.count);
    
    // Calculate app-ads.txt statistics
    const withAppAdsTxt = validResults.filter(r => r.appAdsTxt?.exists).length;
    
    const appAdsTxtStats = {
      withAppAdsTxt,
      withoutAppAdsTxt: validResults.length - withAppAdsTxt,
      percentageWithAppAdsTxt: Math.round((withAppAdsTxt / validResults.length) * 100)
    };
    
    // Analyze publisher domains in app-ads.txt files
    const publisherAnalysis = analyzePublisherDomains(validResults);
    
    return {
      sharedDomains,
      appAdsTxtStats,
      publisherAnalysis
    };
  } catch (err) {
    logger.error({ error: err.message }, 'Error analyzing domain relationships');
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

/**
 * Analyze publisher domains in app-ads.txt files
 * @param {Array<object>} results - Array of extraction results
 * @returns {object} - Publisher domain analysis
 */
function analyzePublisherDomains(results) {
  try {
    // Filter results with app-ads.txt
    const withAppAdsTxt = results.filter(r => r.appAdsTxt?.exists && r.appAdsTxt?.analyzed);
    
    if (withAppAdsTxt.length === 0) {
      return {
        topPublishers: [],
        directVsReseller: { direct: 0, reseller: 0, other: 0 },
        averagePublishersPerApp: 0
      };
    }
    
    // Collect publishers
    const publishers = {};
    let totalDirect = 0;
    let totalReseller = 0;
    let totalOther = 0;
    
    withAppAdsTxt.forEach(result => {
      const analyzed = result.appAdsTxt.analyzed;
      
      // Add to relationship counts
      totalDirect += analyzed.relationships.direct || 0;
      totalReseller += analyzed.relationships.reseller || 0;
      totalOther += analyzed.relationships.other || 0;
      
      // We don't have direct access to publishers here
      // This is just a placeholder - in a real implementation, we'd extract and count publishers
    });
    
    // Calculate statistics
    const directVsReseller = {
      direct: totalDirect,
      reseller: totalReseller,
      other: totalOther,
      total: totalDirect + totalReseller + totalOther,
      directPercentage: totalDirect > 0 ? 
        Math.round((totalDirect / (totalDirect + totalReseller + totalOther)) * 100) : 0,
      resellerPercentage: totalReseller > 0 ? 
        Math.round((totalReseller / (totalDirect + totalReseller + totalOther)) * 100) : 0
    };
    
    // Get top publishers (if we had actual publishers)
    const topPublishers = [];
    
    // Calculate average publishers per app
    const averagePublishersPerApp = withAppAdsTxt.reduce((sum, r) => 
      sum + (r.appAdsTxt?.analyzed?.uniquePublishers || 0), 0) / withAppAdsTxt.length;
    
    return {
      topPublishers,
      directVsReseller,
      averagePublishersPerApp: Math.round(averagePublishersPerApp * 10) / 10  // Round to 1 decimal
    };
  } catch (err) {
    logger.error({ error: err.message }, 'Error analyzing publisher domains');
    return {
      topPublishers: [],
      directVsReseller: { direct: 0, reseller: 0, other: 0 },
      averagePublishersPerApp: 0,
      error: 'Error analyzing publishers'
    };
  }
}

/**
 * Perform search term analysis across results
 * @param {Array<object>} results - Array of extraction results
 * @param {Array<string>} searchTerms - Search terms
 * @returns {object} - Search analysis results
 */
function analyzeSearchTerms(results, searchTerms) {
  try {
    if (!searchTerms || !Array.isArray(searchTerms) || searchTerms.length === 0) {
      return null;
    }
    
    // Filter results with app-ads.txt and search results
    const validResults = results.filter(r => 
      r.success && r.appAdsTxt?.exists && r.appAdsTxt.searchResults
    );
    
    if (validResults.length === 0) {
      return {
        totalMatches: 0,
        appsWithMatches: 0,
        matchesPerTerm: searchTerms.map(term => ({ term, count: 0 }))
      };
    }
    
    // Calculate total matches
    const totalMatches = validResults.reduce((sum, r) => 
      sum + (r.appAdsTxt.searchResults?.count || 0), 0);
    
    // Count apps with matches
    const appsWithMatches = validResults.filter(r => 
      r.appAdsTxt.searchResults.count > 0).length;
    
    // Calculate matches per term
    const matchesPerTerm = searchTerms.map(term => {
      const termLower = term.toLowerCase();
      const count = validResults.reduce((sum, r) => {
        const termResult = r.appAdsTxt.searchResults.termResults.find(tr => 
          tr.term.toLowerCase() === termLower
        );
        return sum + (termResult?.count || 0);
      }, 0);
      
      return { term, count };
    }).sort((a, b) => b.count - a.count);
    
    return {
      totalMatches,
      appsWithMatches,
      percentageWithMatches: Math.round((appsWithMatches / validResults.length) * 100),
      matchesPerTerm
    };
  } catch (err) {
    logger.error({ error: err.message }, 'Error analyzing search terms');
    return {
      totalMatches: 0,
      appsWithMatches: 0,
      matchesPerTerm: searchTerms.map(term => ({ term, count: 0 })),
      error: 'Error analyzing search terms'
    };
  }
}

/**
 * Analyze common publishers across app-ads.txt files
 * @param {Array<object>} results - Array of extraction results
 * @returns {object} - Common publishers analysis
 */
function analyzeCommonPublishers(results) {
  // This function would need to parse the full content of app-ads.txt
  // Which we may not have readily available in the analyzed results
  // This is just a placeholder for such functionality
  return {
    commonPublishers: []
  };
}

module.exports = {
  analyzeDomainRelationships,
  analyzePublisherDomains,
  analyzeSearchTerms,
  analyzeCommonPublishers
};