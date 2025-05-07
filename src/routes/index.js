/**
 * Route aggregation for App-Ads.txt Extractor
 */

'use strict';

const express = require('express');
const path = require('path');
const apiRoutes = require('./api');
const healthRoutes = require('./health');
const streamingRoutes = require('./streaming-api');
const { notFoundHandler } = require('../middleware/error-handler');
const config = require('../config');

const router = express.Router();

// Health check routes
router.use('/health', healthRoutes);

// API routes
router.use('/api', apiRoutes);

// New streaming API routes
router.use('/api/stream', streamingRoutes);

// Static files
router.use(express.static(config.dirs.public));

// Root route - serve index.html
router.get('/', (req, res) => {
  res.sendFile(path.join(config.dirs.public, 'index.html'));
});

// 404 handler for all other routes
router.use(notFoundHandler);

module.exports = router;