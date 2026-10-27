// controllers/inventoryController.js - Handles CRUD and querying logic
//
// Controllers receive requests that have already passed the validation
// middleware, apply the business rules (item exists? name unique? enough
// stock?) and use the model to read/write the in-memory array.
// Errors are passed to next() so the centralized error handler formats them.

const Inventory = require('../model/inventoryData');
const { AppError } = require('../middleware/errorHandler');

// ---------- Helpers ----------

// Every success response has the same shape: { success: true, message?, ...meta, data }
const sendSuccess = (res, statusCode, body) => res.status(statusCode).json({ success: true, ...body });

const itemNotFound = (id) => new AppError(404, `Item with id ${id} not found`, 'ITEM_NOT_FOUND');

const duplicateName = (name) =>
  new AppError(409, `An item named "${name}" already exists`, 'DUPLICATE_ITEM', [
    { field: 'name', message: 'name must be unique (case-insensitive)' },
  ]);

// ---------- Controllers ----------

/**
 * GET /api/inventory
 * Fetch all items.
 */
const getAllItems = (req, res) => {
  const items = Inventory.findAll();
  sendSuccess(res, 200, { count: items.length, data: items });
};

/**
 * GET /api/inventory/:id
 * Fetch a single item.
 */
const getItemById = (req, res, next) => {
  const id = Number(req.params.id);
  const item = Inventory.findById(id);
  if (!item) return next(itemNotFound(id));

  sendSuccess(res, 200, { data: item });
};

/**
 * POST /api/inventory
 * Add a new item. Item names must be unique.
 */
const createItem = (req, res, next) => {
  if (Inventory.findByName(req.body.name)) return next(duplicateName(req.body.name));

  const item = Inventory.create(req.body);
  res.location(`${req.baseUrl}/${item.id}`);
  sendSuccess(res, 201, { message: 'Item created successfully', data: item });
};

/**
 * PUT /api/inventory/:id
 * Replace every editable field of an item.
 */
const replaceItem = (req, res, next) => {
  const id = Number(req.params.id);
  if (!Inventory.findById(id)) return next(itemNotFound(id));
  if (Inventory.findByName(req.body.name, id)) return next(duplicateName(req.body.name));

  const item = Inventory.replace(id, req.body);
  sendSuccess(res, 200, { message: 'Item replaced successfully', data: item });
};

/**
 * PATCH /api/inventory/:id
 * Update only the fields that are sent.
 */
const updateItem = (req, res, next) => {
  const id = Number(req.params.id);
  if (!Inventory.findById(id)) return next(itemNotFound(id));
  if (req.body.name !== undefined && Inventory.findByName(req.body.name, id)) {
    return next(duplicateName(req.body.name));
  }

  const item = Inventory.update(id, req.body);
  sendSuccess(res, 200, { message: 'Item updated successfully', data: item });
};

/**
 * PATCH /api/inventory/:id/stock
 * Increase (restock) or decrease (sale) the quantity by `adjustment`.
 * Stock can never go below 0 or above the maximum quantity.
 */
const adjustStock = (req, res, next) => {
  const id = Number(req.params.id);
  const item = Inventory.findById(id);
  if (!item) return next(itemNotFound(id));

  const { adjustment } = req.body;
  const newQuantity = item.quantity + adjustment;

  if (newQuantity < 0) {
    return next(
      new AppError(
        409,
        `Insufficient stock: cannot remove ${-adjustment} unit(s) of "${item.name}", only ${item.quantity} in stock`,
        'INSUFFICIENT_STOCK',
        [{ field: 'adjustment', message: `minimum allowed adjustment is -${item.quantity}` }]
      )
    );
  }
  if (newQuantity > Inventory.LIMITS.MAX_QUANTITY) {
    return next(
      new AppError(
        409,
        `Stock limit exceeded: "${item.name}" cannot hold more than ${Inventory.LIMITS.MAX_QUANTITY} units`,
        'STOCK_LIMIT_EXCEEDED',
        [{ field: 'adjustment', message: `maximum allowed adjustment is ${Inventory.LIMITS.MAX_QUANTITY - item.quantity}` }]
      )
    );
  }

  const updated = Inventory.update(id, { quantity: newQuantity });
  const action = adjustment > 0 ? 'increased' : 'decreased';
  sendSuccess(res, 200, {
    message: `Stock ${action} by ${Math.abs(adjustment)} (${item.quantity} -> ${newQuantity})`,
    data: updated,
  });
};

/**
 * DELETE /api/inventory/:id
 * Remove an item and return the deleted record.
 */
const deleteItem = (req, res, next) => {
  const id = Number(req.params.id);
  const removed = Inventory.remove(id);
  if (!removed) return next(itemNotFound(id));

  sendSuccess(res, 200, { message: 'Item deleted successfully', data: removed });
};

module.exports = {
  getAllItems,
  getItemById,
  createItem,
  replaceItem,
  updateItem,
  adjustStock,
  deleteItem,
};
