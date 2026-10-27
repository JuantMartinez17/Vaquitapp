import { ErrorCode } from './codes.js';

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: ErrorCode,
    public details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

// Each subclass fixes the HTTP status; the specific business `code` (from the
// frozen catalog in codes.ts) is a parameter, so modules don't need one class
// per code — only one per status-code shape.

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', code: ErrorCode = ErrorCode.BAD_REQUEST, details?: unknown) {
    super(message, 400, code, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', code: ErrorCode = ErrorCode.UNAUTHORIZED) {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code: ErrorCode = ErrorCode.FORBIDDEN) {
    super(message, 403, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', code: ErrorCode = ErrorCode.NOT_FOUND) {
    super(message, 404, code);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', code: ErrorCode = ErrorCode.CONFLICT, details?: unknown) {
    super(message, 409, code, details);
  }
}

export class ValidationError extends AppError {
  constructor(
    message = 'Validation failed',
    code: ErrorCode = ErrorCode.VALIDATION_ERROR,
    details?: unknown,
  ) {
    super(message, 422, code, details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests', code: ErrorCode = ErrorCode.RATE_LIMITED) {
    super(message, 429, code);
  }
}

// Platform-level errors: produced by infrastructure concerns (body limits,
// upload capacity, an unreachable database), not by business rules.

export class PayloadTooLargeError extends AppError {
  constructor(message = 'Payload too large', code: ErrorCode = ErrorCode.PAYLOAD_TOO_LARGE) {
    super(message, 413, code);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(
    message = 'Unsupported media type',
    code: ErrorCode = ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  ) {
    super(message, 415, code);
  }
}

/**
 * The service is up but cannot take this request right now. When
 * `retryAfterSeconds` is set the error middleware advertises it as a
 * `Retry-After` header, so well-behaved clients back off instead of hammering.
 */
export class ServiceUnavailableError extends AppError {
  constructor(
    message = 'Service temporarily unavailable',
    code: ErrorCode = ErrorCode.SERVICE_UNAVAILABLE,
    public retryAfterSeconds?: number,
  ) {
    super(message, 503, code);
  }
}
