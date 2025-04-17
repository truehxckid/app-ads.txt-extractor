/**
 * Health check routes for App-Ads.txt Extractor
 */

'use strict';

const express = require('express');
const cache = require('../services/cache');
const redis = require('../services/redis');
const config = require('../config');
const { getLogger } = require('../utils/logger');

const logger = getLogger('health-routes');
const router = express.Router();

/**
 * Format uptime in a readable way
 * @param {number} uptime - Uptime in seconds
 * @returns {string} - Formatted uptime
 */
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

/**
 * @api {get} /health Health check endpoint
 * @apiName HealthCheck
 * @apiGroup System
 * 
 * @apiSuccess {String} status System status
 * @apiSuccess {String} uptime System uptime
 */
router.get('/', (req, res) => {
  try {
    const uptime = process.uptime();
    const formattedUptime = formatUptime(uptime);
    
    res.json({
      status: 'up',
      uptime: formattedUptime,
      cacheStats: cache.getStats(),
      redis: redis.isConnected() ? 'connected' : 'not connected',
      version: process.env.npm_package_version || require('../../package.json').version,
      nodeVersion: process.version,
      environment: config.server.env
    });
  } catch (err) {
    logger.error({ error: err.message }, 'Health check error');
    res.status(500).json({ status: 'error', error: 'Health check failed' });
  }
});

/**
 * @api {get} /health/readiness Readiness check endpoint
 * @apiName ReadinessCheck
 * @apiGroup System
 * 
 * @apiSuccess {String} status System readiness status
 */
router.get('/readiness', async (req, res) => {
  try {
    const redisStatus = redis.isConnected();
    
    // Check if cache is working
    let cacheStatus = false;
    try {
      await cache.set('health-check', { timestamp: Date.now() }, 0.01); // 36 seconds
      const cachedValue = await cache.get('health-check');
      cacheStatus = !!cachedValue;
    } catch (cacheErr) {
      logger.error({ error: cacheErr.message }, 'Cache health check error');
    }
    
    const allReady = cacheStatus && (!config.redis.enabled || redisStatus);
    
    res.json({
      status: allReady ? 'ready' : 'not ready',
      checks: {
        cache: cacheStatus ? 'ready' : 'not ready',
        redis: config.redis.enabled ? (redisStatus ? 'ready' : 'not ready') : 'disabled'
      }
    });
  } catch (err) {
    logger.error({ error: err.message }, 'Readiness check error');
    res.status(500).json({ status: 'error', error: 'Readiness check failed' });
  }
});

/**
 * @api {get} /health/liveness Liveness check endpoint
 * @apiName LivenessCheck
 * @apiGroup System
 * 
 * @apiSuccess {String} status System liveness status
 */
router.get('/liveness', (req, res) => {
  // Simple liveness check - if the server is responding, it's alive
  res.json({ status: 'alive' });
});

module.exports = router;