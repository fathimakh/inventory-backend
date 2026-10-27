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

const checkText = (value, field, min, max) => {
  if (typeof value !== 'string') return `${field} must be a string`;
  const length = value.trim().length;
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
  // supplier is optional; null clears it
  supplier: (value) =>
    value === null ? null : checkText(value, 'supplier', LIMITS.SUPPLIER_MIN, LIMITS.SUPPLIER_MAX),
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
    return validationError([{ field: 'body', message: 'Request body must be a JSON object, not an array or a primitive' }]);
  }
  return null;
};

/** Reports read-only and unknown fields in the body. */
const checkAllowedFields = (body, allowedFields) => {
  const details = [];
  Object.keys(body).forEach((key) => {
    if (READ_ONLY_FIELDS.includes(key)) {
      details.push({ field: key, message: `${key} is read-only and cannot be set` });
    } else if (!allowedFields.includes(key)) {
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

  if (details.length > 0) return next(validationError(details));

  // Pass on a clean body: only known fields, strings trimmed
  const clean = {};
  ITEM_FIELDS.forEach((field) => {
    if (body[field] !== undefined) {
      clean[field] = typeof body[field] === 'string' ? body[field].trim() : body[field];
    }
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

module.exports = {
  validateId,
  validateItem,
  validateItemUpdate,
  validateStockAdjustment,
};
