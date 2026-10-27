// middleware/errorHandler.js - Centralized error handling middleware
//
// Every error in the app ends up here, so all error responses share ONE shape:
// {
//   "success": false,
//   "error": { "statusCode": 404, "code": "ITEM_NOT_FOUND", "message": "...", "details": [...] }
// }

/**
 * Custom error class used across the app. Throw it (or pass it to next())
 * from anywhere and the error handler below turns it into a JSON response.
 */
class AppError extends Error {
  constructor(statusCode, message, code = 'ERROR', details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

// Fallback codes for any other 4xx error raised by Express or body-parser
// (e.g. 400 for a badly %-encoded URL, 415 for an unsupported JSON charset).
// Errors created by this app are AppErrors and carry their own code.
const DEFAULT_CODES = {
  400: 'BAD_REQUEST',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
};

/**
 * 404 handler for requests that did not match any route.
 * Registered after all routes in index.js.
 */
const notFound = (req, res, next) => {
  next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'));
};

/**
 * 405 handler for known paths called with an unsupported HTTP method.
 * Usage: router.route('/').get(...).all(methodNotAllowed(['GET', 'POST']))
 */
const methodNotAllowed = (allowedMethods) => (req, res, next) => {
  const allowed = allowedMethods.join(', ');
  const path = req.originalUrl.split('?')[0];
  res.set('Allow', allowed);
  next(
    new AppError(
      405,
      `Method ${req.method} is not allowed on ${path}. Allowed methods: ${allowed}`,
      'METHOD_NOT_ALLOWED'
    )
  );
};

/**
 * Centralized error handler. Express recognises it as an error handler
 * because it takes exactly four arguments.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  // If a response is already streaming, let Express close the connection
  if (res.headersSent) return next(err);

  let statusCode = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'Something went wrong on the server. Please try again later.';
  let details;

  const clientStatus = err.statusCode || err.status;

  if (err instanceof AppError) {
    ({ statusCode, code, message, details } = err);
  } else if (err.type === 'entity.parse.failed') {
    // Malformed JSON body, thrown by express.json()
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON in request body. Please send valid JSON.';
  } else if (err.type === 'entity.too.large') {
    statusCode = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = `Request body is too large. Maximum size is ${err.limit} bytes.`;
  } else if (Number.isInteger(clientStatus) && clientStatus >= 400 && clientStatus < 500) {
    // Any other client error raised by Express / body-parser
    statusCode = clientStatus;
    code = DEFAULT_CODES[clientStatus] || 'CLIENT_ERROR';
    message = err.message || 'Bad request';
  }

  // Unexpected errors are logged on the server, never leaked to the client
  if (statusCode >= 500) console.error(err);

  const error = { statusCode, code, message };
  if (details !== undefined) error.details = details;
  // app.get('env') is NODE_ENV, defaulting to 'development' (same default as index.js)
  if (statusCode >= 500 && req.app.get('env') === 'development') error.stack = err.stack;

  res.status(statusCode).json({ success: false, error });
};

module.exports = { AppError, notFound, methodNotAllowed, errorHandler };
