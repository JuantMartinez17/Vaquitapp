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
