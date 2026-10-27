// middleware/validation.js - Input validation middleware
//
// Each validator checks one part of the request (route param, body or query).
// Invalid input never reaches the controller: all problems are collected and
// passed to the centralized error handler as ONE 400 response, e.g.
// {
//   "success": false,
//   "error": {
//     "statusCode": 400,
//     "code": "VALIDATION_ERROR",
//     "message": "Validation failed",
//     "details": [{ "field": "quantity", "message": "quantity must be a whole number" }]
//   }
// }

const { AppError } = require('./errorHandler');
const { LIMITS } = require('../model/inventoryData');

const ITEM_FIELDS = ['name', 'category', 'quantity', 'price', 'supplier'];
const REQUIRED_FIELDS = ['name', 'category', 'quantity', 'price'];
const READ_ONLY_FIELDS = ['id', 'createdAt', 'updatedAt'];

// ---------- Helpers ----------

const validationError = (details) => new AppError(400, 'Validation failed', 'VALIDATION_ERROR', details);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;
const INVISIBLE_CHARS = /[\u200B-\u200D\u2060\uFEFF]/g;

/** Trims, removes zero-width characters and collapses runs of spaces: "  Desk   Lamp " -> "Desk Lamp" */
const cleanText = (value) => value.normalize('NFC').replace(INVISIBLE_CHARS, '').replace(/\s+/g, ' ').trim();

const isBlank = (value) => typeof value === 'string' && cleanText(value) === '';

const checkText = (value, field, min, max) => {
  if (typeof value !== 'string') return `${field} must be a string`;
  if (CONTROL_CHARS.test(value)) return `${field} cannot contain control characters such as tabs or line breaks`;
  const length = [...cleanText(value)].length; // count characters, not UTF-16 code units
  if (length === 0) return `${field} cannot be empty`;
  if (length < min || length > max) return `${field} must be between ${min} and ${max} characters`;
  return null;
};

// One rule per item field. Each returns an error message, or null when valid.
const FIELD_RULES = {
  name: (value) => checkText(value, 'name', LIMITS.NAME_MIN, LIMITS.NAME_MAX),
  category: (value) => checkText(value, 'category', LIMITS.CATEGORY_MIN, LIMITS.CATEGORY_MAX),
  quantity: (value) => {
    if (typeof value !== 'number' || !Number.isInteger(value)) return 'quantity must be a whole number';
    if (value < 0 || value > LIMITS.MAX_QUANTITY) return `quantity must be between 0 and ${LIMITS.MAX_QUANTITY}`;
    return null;
  },
  price: (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'price must be a number';
    if (value < 0 || value > LIMITS.MAX_PRICE) return `price must be between 0 and ${LIMITS.MAX_PRICE}`;
    if (!/^\d+(\.\d{1,2})?$/.test(String(value))) return 'price can have at most 2 decimal places';
    return null;
  },
  // supplier is optional; null or "" clears it
  supplier: (value) =>
    value === null || isBlank(value) ? null : checkText(value, 'supplier', LIMITS.SUPPLIER_MIN, LIMITS.SUPPLIER_MAX),
};

/**
 * Makes sure the request carries a JSON object body.
 * Returns an AppError, or null when the body is usable.
 */
const checkJsonBody = (req) => {
  if (req.body === undefined) {
    // express.json() only parses application/json; anything else leaves body undefined
    if (req.is('application/json') === false) {
      return new AppError(415, 'Content-Type must be application/json', 'UNSUPPORTED_MEDIA_TYPE');
    }
    return validationError([{ field: 'body', message: 'Request body is required and must be a JSON object' }]);
  }
  if (!isPlainObject(req.body)) {
    return validationError([{ field: 'body', message: 'Request body must be a JSON object, not an array, string, number or null' }]);
  }
  return null;
};

/**
 * Reports unknown fields in the body (catches typos like "quantiy").
 * Read-only fields (id, createdAt, updatedAt) are ignored rather than
 * rejected, so a body copied from a GET response can be sent back as is.
 * They never reach the model: only allowed fields are passed on.
 */
const checkAllowedFields = (body, allowedFields) => {
  const details = [];
  Object.keys(body).forEach((key) => {
    if (!allowedFields.includes(key) && !READ_ONLY_FIELDS.includes(key)) {
      details.push({ field: key, message: `Unknown field "${key}". Allowed fields: ${allowedFields.join(', ')}` });
    }
  });
  return details;
};

/**
 * Builds a validator for item bodies.
 * - partial = false (POST, PUT): all required fields must be present
 * - partial = true  (PATCH):     at least one field, only the sent ones are checked
 */
const buildItemValidator = ({ partial }) => (req, res, next) => {
  const bodyError = checkJsonBody(req);
  if (bodyError) return next(bodyError);

  const body = req.body;
  const details = checkAllowedFields(body, ITEM_FIELDS);

  if (partial && !ITEM_FIELDS.some((field) => body[field] !== undefined)) {
    details.push({ field: 'body', message: `Provide at least one field to update: ${ITEM_FIELDS.join(', ')}` });
  }

  ITEM_FIELDS.forEach((field) => {
    const value = body[field];
    const isRequired = REQUIRED_FIELDS.includes(field);

    if (value === undefined) {
      if (isRequired && !partial) details.push({ field, message: `${field} is required` });
      return;
    }
    if (value === null && isRequired) {
      details.push({ field, message: `${field} cannot be null` });
      return;
    }
    const message = FIELD_RULES[field](value);
    if (message) details.push({ field, message });
  });

  // PUT is a full replacement; point clients that only send some fields to PATCH
  const missingRequired = details.some((d) => d.message.endsWith(' is required'));
  if (!partial && missingRequired && req.method === 'PUT') {
    details.push({
      field: 'body',
      message: 'PUT replaces the whole item, so name, category, quantity and price are all required. Use PATCH /api/inventory/:id to update only some fields.',
    });
  }

  if (details.length > 0) return next(validationError(details));

  // Pass on a clean body: only known fields, strings tidied, blank supplier -> null
  const clean = {};
  ITEM_FIELDS.forEach((field) => {
    const value = body[field];
    if (value === undefined) return;
    if (field === 'supplier' && (value === null || isBlank(value))) clean[field] = null;
    else clean[field] = typeof value === 'string' ? cleanText(value) : value;
  });
  req.body = clean;
  next();
};

// ---------- Exported validators ----------

/** :id must be a positive whole number, e.g. /api/inventory/3 */
const validateId = (req, res, next) => {
  const { id } = req.params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    return next(
      new AppError(400, `Invalid item id "${id}". The id must be a positive whole number.`, 'INVALID_ID', [
        { field: 'id', message: 'id must be a positive whole number' },
      ])
    );
  }
  next();
};

/** POST /api/inventory and PUT /api/inventory/:id */
const validateItem = buildItemValidator({ partial: false });

/** PATCH /api/inventory/:id */
const validateItemUpdate = buildItemValidator({ partial: true });

/** PATCH /api/inventory/:id/stock  ->  { "adjustment": -3 } */
const validateStockAdjustment = (req, res, next) => {
  const bodyError = checkJsonBody(req);
  if (bodyError) return next(bodyError);

  const details = checkAllowedFields(req.body, ['adjustment']);
  const { adjustment } = req.body;
  const max = LIMITS.MAX_QUANTITY;

  if (adjustment === undefined || adjustment === null) {
    details.push({ field: 'adjustment', message: 'adjustment is required (positive to add stock, negative to remove)' });
  } else if (typeof adjustment !== 'number' || !Number.isInteger(adjustment)) {
    details.push({ field: 'adjustment', message: 'adjustment must be a whole number' });
  } else if (adjustment === 0) {
    details.push({ field: 'adjustment', message: 'adjustment cannot be 0' });
  } else if (Math.abs(adjustment) > max) {
    details.push({ field: 'adjustment', message: `adjustment must be between -${max} and ${max}` });
  }

  if (details.length > 0) return next(validationError(details));
  next();
};

// ---------- Query string validation ----------

const SORT_FIELDS = ['id', 'name', 'category', 'quantity', 'price', 'createdAt', 'updatedAt'];
const MAX_PAGE_LIMIT = 100;

// name and search are aliases for the same partial, case-insensitive name search
const QUERY_PARAMS = ['name', 'search', 'category', 'quantity', 'minQty', 'maxQty', 'inStock', 'sortBy', 'order', 'page', 'limit'];

const textParam = (raw, param, max) => {
  const value = raw.trim();
  if (value.length > max) return { error: `${param} must be at most ${max} characters` };
  return { value };
};

const wholeNumberParam = (raw, param, min, max = Infinity) => {
  const text = raw.trim();
  const value = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < min || value > max) {
    const range = max === Infinity ? `of at least ${min}` : `between ${min} and ${max}`;
    return { error: `${param} must be a whole number ${range}` };
  }
  return { value };
};

const choiceParam = (raw, param, choices) => {
  const value = choices.find((choice) => choice.toLowerCase() === raw.trim().toLowerCase());
  return value === undefined ? { error: `${param} must be one of: ${choices.join(', ')}` } : { value };
};

// One parser per supported query parameter: returns { value } or { error }
const QUERY_PARSERS = {
  name: (raw) => textParam(raw, 'name', LIMITS.NAME_MAX),
  search: (raw) => textParam(raw, 'search', LIMITS.NAME_MAX),
  category: (raw) => textParam(raw, 'category', LIMITS.CATEGORY_MAX),
  quantity: (raw) => wholeNumberParam(raw, 'quantity', 0, LIMITS.MAX_QUANTITY),
  minQty: (raw) => wholeNumberParam(raw, 'minQty', 0, LIMITS.MAX_QUANTITY),
  maxQty: (raw) => wholeNumberParam(raw, 'maxQty', 0, LIMITS.MAX_QUANTITY),
  inStock: (raw) => {
    const { value, error } = choiceParam(raw, 'inStock', ['true', 'false']);
    return error ? { error } : { value: value === 'true' };
  },
  sortBy: (raw) => choiceParam(raw, 'sortBy', SORT_FIELDS),
  order: (raw) => choiceParam(raw, 'order', ['asc', 'desc']),
  page: (raw) => wholeNumberParam(raw, 'page', 1),
  limit: (raw) => wholeNumberParam(raw, 'limit', 1, MAX_PAGE_LIMIT),
};

/**
 * Builds a query-string validator. Valid, converted values (numbers,
 * booleans, trimmed strings) are stored on req.filters for the controller,
 * because req.query is read-only in Express 5.
 * - Unknown or repeated params are rejected (catches typos like ?catgory=).
 * - Blank params (e.g. ?category=) are treated as not supplied.
 */
const buildQueryValidator = ({ requireSearchTerm = false } = {}) => (req, res, next) => {
  const query = req.query;
  const details = [];
  const filters = {};

  Object.keys(query).forEach((param) => {
    const raw = query[param];

    if (!QUERY_PARAMS.includes(param)) {
      details.push({ field: param, message: `Unknown query parameter "${param}". Allowed: ${QUERY_PARAMS.join(', ')}` });
    } else if (Array.isArray(raw)) {
      details.push({ field: param, message: `${param} can only be provided once` });
    } else if (raw.trim() !== '') {
      const { value, error } = QUERY_PARSERS[param](raw);
      if (error) details.push({ field: param, message: error });
      else filters[param] = value;
    }
  });

  if (filters.name !== undefined && filters.search !== undefined) {
    details.push({ field: 'search', message: 'name and search are aliases; send only one of them' });
  }
  const hasSearchTerm = filters.name !== undefined || filters.search !== undefined;
  const searchTermFailed = details.some((d) => d.field === 'name' || d.field === 'search');
  if (requireSearchTerm && !hasSearchTerm && !searchTermFailed) {
    if (query.name === undefined && query.search === undefined) {
      details.push({ field: 'name', message: 'name query parameter is required (e.g. ?name=mouse)' });
    } else {
      const sent = query.name !== undefined ? 'name' : 'search';
      details.push({ field: sent, message: `${sent} cannot be empty` });
    }
  }
  if (filters.minQty !== undefined && filters.maxQty !== undefined && filters.minQty > filters.maxQty) {
    details.push({ field: 'minQty', message: 'minQty cannot be greater than maxQty' });
  }

  if (details.length > 0) {
    return next(new AppError(400, 'Invalid query parameters', 'VALIDATION_ERROR', details));
  }

  req.filters = filters;
  next();
};

/** GET /api/inventory?name|search=&category=&quantity=&minQty=&maxQty=&inStock=&sortBy=&order=&page=&limit= */
const validateListQuery = buildQueryValidator();

/** GET /api/inventory/search?name=  (name or search is required; the other filters are optional) */
const validateSearchQuery = buildQueryValidator({ requireSearchTerm: true });

module.exports = {
  validateId,
  validateItem,
  validateItemUpdate,
  validateStockAdjustment,
  validateListQuery,
  validateSearchQuery,
};
