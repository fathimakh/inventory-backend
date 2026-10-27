// routes/infoRoutes.js - API info and health check endpoints
// Mounted at / in index.js

const express = require('express');

const { getApiInfo, getHealth } = require('../controllers/infoController');
const { methodNotAllowed } = require('../middleware/errorHandler');

const router = express.Router();

router
  .route('/')
  .get(getApiInfo) // endpoints and query parameters
  .all(methodNotAllowed(['GET']));

router
  .route('/api/health')
  .get(getHealth) // server status
  .all(methodNotAllowed(['GET']));

module.exports = router;
