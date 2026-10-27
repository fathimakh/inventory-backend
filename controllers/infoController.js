// controllers/infoController.js - API info and health check
//
// Small read-only endpoints that describe the API and report its status.
// Inventory CRUD and querying live in inventoryController.js.

const Inventory = require('../model/inventoryData');

/**
 * GET /
 * Lists the endpoints and query parameters, so the API documents itself.
 */
const getApiInfo = (req, res) => {
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
        page: 'page number, starting at 1 (turns on pagination)',
        limit: 'items per page, 1-100 (turns on pagination; defaults to 10 once page is sent)',
      },
    },
  });
};

/**
 * GET /api/health
 * Server status and the number of items currently in memory.
 */
const getHealth = (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      environment: req.app.get('env'),
      uptimeSeconds: Math.round(process.uptime()),
      itemsInMemory: Inventory.count(),
      timestamp: new Date().toISOString(),
    },
  });
};

module.exports = { getApiInfo, getHealth };
