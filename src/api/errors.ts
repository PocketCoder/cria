export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number | null,
    message: string,
    public readonly retryable: boolean,
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

export async function buildApiError(
  status: number,
  bodyText: string,
): Promise<ApiError> {
  let code: number | null = null;
  let message = `HTTP ${status}`;
  if (bodyText) {
    try {
      const envelope = JSON.parse(bodyText) as VikunjaErrorEnvelope;
      if (typeof envelope.code === 'number') code = envelope.code;
      if (typeof envelope.message === 'string' && envelope.message.length > 0) {
        message = envelope.message;
      }
    } catch {
      // Non-JSON body; fall back to status text.
      message = bodyText.slice(0, 200);
    }
  }
  return new ApiError(status, code, message, classify(status).retryable);
}
