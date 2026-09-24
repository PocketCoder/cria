export class ApiError extends Error {
  /**
   * @param dependency - If true the op is blocked on an un-synced dependency
   *   (e.g. a parent task that hasn't been created server-side yet). The
   *   drain loop will NOT count this attempt toward MAX_ATTEMPTS, so a chain
   *   of blocked ops won't dead-letter from attempt exhaustion alone.
   */
  constructor(
    public readonly status: number,
    public readonly code: number | null,
    message: string,
    public readonly retryable: boolean,
    public readonly dependency: boolean = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
  }

  /** Network failures are always retryable. */
  readonly retryable = true;
}

export class AuthRequiredError extends Error {
  constructor() {
    super('Authentication required');
    this.name = 'AuthRequiredError';
  }
}

export interface ErrorClassification {
  retryable: boolean;
}

/**
 * Vikunja's error envelope shape (best-effort). The server doesn't document
 * this in OpenAPI, so we parse defensively.
 */
interface VikunjaErrorEnvelope {
  code?: number;
  message?: string;
}

export function classify(status: number): ErrorClassification {
  if (status >= 500) return { retryable: true };
  if (status === 408 || status === 429) return { retryable: true };
  return { retryable: false };
}

/**
 * Builds an ApiError from an error value. Accepts either:
 * - the pre-parsed `error` field openapi-fetch already produces (it reads
 *   the response body internally and best-effort JSON.parses it before we
 *   ever see the Response — re-reading `response.text()` ourselves throws
 *   "body stream already read" and was silently swallowed, degrading every
 *   error message to a bare "HTTP 400"), or
 * - a raw JSON/plain-text string, for callers that read the body directly.
 */
export function buildApiError(status: number, error: unknown): ApiError {
  let code: number | null = null;
  let message = `HTTP ${status}`;

  let envelope: VikunjaErrorEnvelope | null = null;
  if (typeof error === 'string') {
    if (error.length > 0) {
      try {
        envelope = JSON.parse(error) as VikunjaErrorEnvelope;
      } catch {
        message = error.slice(0, 200);
      }
    }
  } else if (error && typeof error === 'object') {
    envelope = error as VikunjaErrorEnvelope;
  }

  if (envelope) {
    if (typeof envelope.code === 'number') code = envelope.code;
    if (typeof envelope.message === 'string' && envelope.message.length > 0) {
      message = envelope.message;
    }
  }

  return new ApiError(status, code, message, classify(status).retryable);
}
