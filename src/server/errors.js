// @ts-check
/**
 * Errors that are safe to show to users. Anything else becomes a generic 500 and
 * its details stay in the server log.
 */
export class AppError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code   stable machine-readable code
   * @param {string} message plain-English message for the person using the app
   * @param {{ retryable?: boolean, cause?: unknown }} [opts]
   */
  constructor(status, code, message, opts = {}) {
    super(message, { cause: opts.cause });
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.retryable = Boolean(opts.retryable);
  }
}

/** @param {unknown} err */
export function isAppError(err) {
  return err instanceof AppError;
}
