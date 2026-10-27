// index.js - Main entry point for the Express server
require('dotenv').config({ quiet: true });

const express = require('express');
const cors = require('cors');

const inventoryModel = require('./model/inventoryData');
const inventoryRoutes = require('./routes/inventoryRoutes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const PORT = Number(process.env.PORT) || 5012;
const NODE_ENV = process.env.NODE_ENV || 'development';

// "*" allows every origin; otherwise a comma-separated list of allowed origins
const corsOrigin = (process.env.CORS_ORIGIN || '*').trim();
const corsOptions = {
  origin: corsOrigin === '*' ? '*' : corsOrigin.split(',').map((origin) => origin.trim()),
};

// Load sample items into the in-memory array unless SEED_DATA=false
if (process.env.SEED_DATA !== 'false') {
  inventoryModel.seed();
}

const app = express();

// ---------- Global middleware ----------
app.use(cors(corsOptions));
app.use(express.json({ limit: '10kb' }));

// Simple request logger (development only)
if (NODE_ENV === 'development') {
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt} ms)`);
    });
    next();
  });
}

// ---------- Routes ----------
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to the Inventory Management API',
    data: {
      version: '1.0.0',
      endpoints: {
        health: 'GET /api/health',
        listItems: 'GET /api/inventory',
        filterAndSearch: 'GET /api/inventory?category=Electronics&minQty=10&name=mouse',
        searchItems: 'GET /api/inventory/search?name=mouse',
        getItem: 'GET /api/inventory/:id',
        createItem: 'POST /api/inventory',
        replaceItem: 'PUT /api/inventory/:id',
        updateItem: 'PATCH /api/inventory/:id',
        adjustStock: 'PATCH /api/inventory/:id/stock',
        deleteItem: 'DELETE /api/inventory/:id',
      },
      queryParams: {
        name: 'partial, case-insensitive name search (alias: search)',
        category: 'exact category, case-insensitive',
        quantity: 'exact quantity',
        minQty: 'quantity >= minQty',
        maxQty: 'quantity <= maxQty',
        inStock: 'true (quantity > 0) | false (quantity = 0)',
        sortBy: 'id | name | category | quantity | price | createdAt | updatedAt',
        order: 'asc | desc',
        page: 'page number (starts at 1)',
        limit: 'items per page (1-100, default 10)',
      },
    },
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      environment: NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      itemsInMemory: inventoryModel.count(),
      timestamp: new Date().toISOString(),
    },
  });
});

app.use('/api/inventory', inventoryRoutes);

// ---------- Error handling (registered after all routes) ----------
app.use(notFound);
app.use(errorHandler);

// ---------- Start the server ----------
if (require.main === module) {
  app.listen(PORT, (err) => {
    if (err) {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Change PORT in your .env file.`);
      } else {
        console.error('Failed to start server:', err.message);
      }
      process.exit(1);
    }
    console.log(`Inventory API running at http://localhost:${PORT} (${NODE_ENV})`);
  });
}

module.exports = app;
