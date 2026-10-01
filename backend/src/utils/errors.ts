/**
 * Error model ported from Dhanvi.SharedKernel.Exceptions and Dhanvi.Api.Middleware.GlobalExceptionHandler.
 * Services throw these; plugins/error-handler.ts maps them to the same HTTP status, ProblemDetails "type",
 * and stable "code" the .NET API returned, so both web apps keep working unchanged.
 */
export abstract class DhanviError extends Error {
  abstract readonly status: number;
  abstract readonly type: string;
  readonly code: string | null = null;
  readonly errors: Record<string, string[]> | null = null;
}

/** Codes that GlobalExceptionHandler mapped to 403 instead of 409 for GroupBusinessException. */
const FORBIDDEN_GROUP_CODES = new Set([
  "NOT_GROUP_OWNER", "MEMBERSHIP_REQUIRED", "ORGANIZER_NOT_APPROVED", "NOT_AUTHORIZED_TO_EXECUTE_SELECTION",
  "NOT_AUTHORIZED_TO_MANAGE_AUCTION", "AUCTION_PERMISSION_DENIED",
]);

/** GroupBusinessException: 403 for authorization codes, otherwise 409. */
export class GroupRuleError extends DhanviError {
  override readonly code: string;
  readonly status: number;
  readonly type: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.type = code;
    this.status = FORBIDDEN_GROUP_CODES.has(code) ? 403 : 409;
  }
}

/** BusinessRuleException: always 409 with the stable code. */
export class BusinessRuleError extends DhanviError {
  override readonly code: string;
  readonly status = 409;
  readonly type: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.type = code;
  }
}

/** RequestValidationException: 400 with a field → messages dictionary. */
export class ValidationError extends DhanviError {
  readonly status = 400;
  readonly type = "validation_error";
  override readonly errors: Record<string, string[]>;
  constructor(errors: Record<string, string[]>) {
    super("One or more validation errors occurred.");
    this.errors = errors;
  }
}

/** BadHttpRequestException: malformed route/query/body input. 400 without a field dictionary. */
export class BadRequestError extends DhanviError {
  readonly status = 400;
  readonly type = "validation_error";
}

export class AuthenticationFailedError extends DhanviError {
  readonly status = 401;
  readonly type = "authentication_error";
  constructor() { super("Invalid email or password."); }
}

/** UnauthorizedAccessException thrown by services (e.g. invalid refresh token). */
export class UnauthorizedError extends DhanviError {
  readonly status = 401;
  readonly type = "authentication_error";
  constructor(message = "Attempted to perform an unauthorized operation.") { super(message); }
}

export class ForbiddenError extends DhanviError {
  readonly status = 403;
  readonly type = "forbidden";
}

export class NotFoundError extends DhanviError {
  readonly status = 404;
  readonly type = "not_found";
}

export class ConflictError extends DhanviError {
  readonly status = 409;
  readonly type = "conflict";
}

/** Optimistic concurrency loss (EF DbUpdateConcurrencyException). Same response as .NET; no "code" extension. */
export class ConcurrencyConflictError extends DhanviError {
  readonly status = 409;
  readonly type = "AUCTION_SCHEDULE_CONFLICT";
  constructor() { super("This record was changed by another user. Review the updated state before making another change."); }
}

/** `GroupRules.Require` */
export function requireGroup(condition: boolean, code: string, message: string): asserts condition {
  if (!condition) throw new GroupRuleError(code, message);
}

/** `BusinessRuleException.Require` */
export function requireRule(condition: boolean, code: string, message: string): asserts condition {
  if (!condition) throw new BusinessRuleError(code, message);
}
