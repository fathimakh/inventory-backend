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

// `existing` is the stored item whose name clashes with the request
const duplicateName = (existing) =>
  new AppError(409, `An item named "${existing.name}" already exists (id ${existing.id})`, 'DUPLICATE_ITEM', [
    { field: 'name', message: 'name must be unique (case-insensitive)' },
  ]);

// ---------- Query helpers (filter -> sort -> paginate) ----------

const FILTER_KEYS = ['category', 'search', 'name', 'quantity', 'minQty', 'maxQty', 'inStock'];
const DEFAULT_PAGE_LIMIT = 10;

// true when the item passes every filter that was supplied
const matchesFilters = (item, filters) => {
  const { category, quantity, minQty, maxQty, inStock } = filters;
  const searchTerm = filters.search ?? filters.name; // partial, case-insensitive name match

  if (category !== undefined && item.category.toLowerCase() !== category.toLowerCase()) return false;
  if (searchTerm !== undefined && !item.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
  if (quantity !== undefined && item.quantity !== quantity) return false;
  if (minQty !== undefined && item.quantity < minQty) return false;
  if (maxQty !== undefined && item.quantity > maxQty) return false;
  if (inStock !== undefined) {
    const isInStock = item.quantity > 0;
    if (isInStock !== inStock) return false;
  }
  return true;
};

// Ties are broken by id in the same direction, so order=desc reverses the list completely
const sortItems = (items, sortBy, order) => {
  const direction = order === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => {
    const x = a[sortBy];
    const y = b[sortBy];
    const result = typeof x === 'string' ? x.localeCompare(y, undefined, { sensitivity: 'base' }) : x - y;
    return (result || a.id - b.id) * direction;
  });
};

/**
 * Runs the validated query (req.filters) against the array.
 * Pagination is only applied when `page` or `limit` is supplied.
 */
const queryInventory = (filters) => {
  const { sortBy = 'id', order = 'asc', page, limit } = filters;

  const appliedFilters = {};
  FILTER_KEYS.forEach((key) => {
    if (filters[key] !== undefined) appliedFilters[key] = filters[key];
  });

  const matched = sortItems(
    Inventory.findAll().filter((item) => matchesFilters(item, filters)),
    sortBy,
    order
  );

  const result = { items: matched, total: matched.length, filters: appliedFilters, sort: { sortBy, order } };

  if (page !== undefined || limit !== undefined) {
    const currentPage = page ?? 1;
    const perPage = limit ?? DEFAULT_PAGE_LIMIT;
    const totalPages = Math.max(1, Math.ceil(matched.length / perPage));
    const start = (currentPage - 1) * perPage;

    result.items = matched.slice(start, start + perPage);
    result.pagination = {
      page: currentPage,
      limit: perPage,
      totalPages,
      hasNextPage: currentPage < totalPages,
      hasPrevPage: currentPage > 1,
    };
  }
  return result;
};

/**
 * e.g. "8 item(s) found", "1 item(s) matching "desk" found",
 * "Showing 3 of 8 item(s) (page 2 of 3)", "Page 9 is out of range: 8 item(s) fit on 2 page(s)"
 */
const listMessage = ({ items, total, pagination }, term) => {
  const what = term === undefined ? 'item(s)' : `item(s) matching "${term}"`;
  if (!pagination) return `${total} ${what} found`;

  const { page, totalPages } = pagination;
  if (page > totalPages) return `Page ${page} is out of range: ${total} ${what} fit on ${totalPages} page(s)`;
  if (total === 0) return `0 ${what} found`;
  return `Showing ${items.length} of ${total} ${what} (page ${page} of ${totalPages})`;
};

// List responses: { success, message, count, total, filters, sort, pagination?, data }
const sendList = (res, result, message) => {
  const { items, total, filters, sort, pagination } = result;
  sendSuccess(res, 200, {
    message,
    count: items.length,
    total,
    filters,
    sort,
    ...(pagination && { pagination }),
    data: items,
  });
};

// ---------- Controllers ----------

/**
 * GET /api/inventory
 * Fetch all items, optionally filtered by category / quantity, searched by
 * name (?name= or ?search=), sorted and paginated through query params.
 */
const getAllItems = (req, res) => {
  const result = queryInventory(req.filters);
  sendList(res, result, listMessage(result));
};

/**
 * GET /api/inventory/search?name=   (?search= works too)
 * Search items by (partial, case-insensitive) name.
 */
const searchItems = (req, res) => {
  const result = queryInventory(req.filters);
  const term = req.filters.name ?? req.filters.search;
  sendList(res, result, listMessage(result, term));
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
  const existing = Inventory.findByName(req.body.name);
  if (existing) return next(duplicateName(existing));

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
  const existing = Inventory.findByName(req.body.name, id);
  if (existing) return next(duplicateName(existing));

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
  const existing = req.body.name !== undefined && Inventory.findByName(req.body.name, id);
  if (existing) return next(duplicateName(existing));

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
  const max = Inventory.LIMITS.MAX_QUANTITY;

  if (newQuantity < 0) {
    const hint = item.quantity === 0
      ? 'item is out of stock, so no units can be removed'
      : `minimum allowed adjustment is -${item.quantity}`;
    return next(
      new AppError(
        409,
        `Insufficient stock: cannot remove ${-adjustment} unit(s) of "${item.name}", only ${item.quantity} in stock`,
        'INSUFFICIENT_STOCK',
        [{ field: 'adjustment', message: hint }]
      )
    );
  }
  if (newQuantity > max) {
    const hint = item.quantity === max
      ? 'item is already at maximum stock, so no units can be added'
      : `maximum allowed adjustment is ${max - item.quantity}`;
    return next(
      new AppError(
        409,
        `Stock limit exceeded: "${item.name}" cannot hold more than ${max} units`,
        'STOCK_LIMIT_EXCEEDED',
        [{ field: 'adjustment', message: hint }]
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
  searchItems,
  getItemById,
  createItem,
  replaceItem,
  updateItem,
  adjustStock,
  deleteItem,
};
