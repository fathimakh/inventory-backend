// routes/inventoryRoutes.js - Inventory API endpoints
// Mounted at /api/inventory in index.js

const express = require('express');

const {
  getAllItems,
  searchItems,
  getItemById,
  createItem,
  replaceItem,
  updateItem,
  adjustStock,
  deleteItem,
} = require('../controllers/inventoryController');
const {
  validateId,
  validateItem,
  validateItemUpdate,
  validateStockAdjustment,
  validateListQuery,
  validateSearchQuery,
} = require('../middleware/validation');
const { methodNotAllowed } = require('../middleware/errorHandler');

const router = express.Router();

// /api/inventory
router
  .route('/')
  .get(validateListQuery, getAllItems) // fetch all items (filter / search / sort / paginate)
  .post(validateItem, createItem) // add an item
  .all(methodNotAllowed(['GET', 'POST']));

// /api/inventory/search  (declared before /:id)
router
  .route('/search')
  .get(validateSearchQuery, searchItems) // search items by name
  .all(methodNotAllowed(['GET']));

// /api/inventory/:id
router
  .route('/:id')
  .get(validateId, getItemById) // fetch one item
  .put(validateId, validateItem, replaceItem) // replace an item
  .patch(validateId, validateItemUpdate, updateItem) // partially update an item
  .delete(validateId, deleteItem) // delete an item
  .all(methodNotAllowed(['GET', 'PUT', 'PATCH', 'DELETE']));

// /api/inventory/:id/stock
router
  .route('/:id/stock')
  .patch(validateId, validateStockAdjustment, adjustStock) // increase / decrease stock
  .all(methodNotAllowed(['PATCH']));

module.exports = router;
