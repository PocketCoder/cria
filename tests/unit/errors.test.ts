import { describe, expect, it } from 'vitest';
import { classify, buildApiError, ApiError } from '@/api/errors';

describe('classify', () => {
  it('marks 5xx as retryable', () => {
    expect(classify(500).retryable).toBe(true);
    expect(classify(503).retryable).toBe(true);
  });

  it('marks 408 and 429 as retryable', () => {
    expect(classify(408).retryable).toBe(true);
    expect(classify(429).retryable).toBe(true);
  });

  it('marks other 4xx as non-retryable', () => {
    expect(classify(400).retryable).toBe(false);
    expect(classify(401).retryable).toBe(false);
    expect(classify(403).retryable).toBe(false);
    expect(classify(404).retryable).toBe(false);
    expect(classify(422).retryable).toBe(false);
  });
});

describe('buildApiError', () => {
  it('parses a Vikunja error envelope when present', async () => {
    const err = await buildApiError(
      401,
      JSON.stringify({ code: 1004, message: 'Invalid token' }),
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.code).toBe(1004);
    expect(err.message).toBe('Invalid token');
    expect(err.retryable).toBe(false);
  });

  it('falls back to status code when body is not JSON', async () => {
    const err = await buildApiError(500, 'Internal Server Error');
    expect(err.status).toBe(500);
    expect(err.code).toBeNull();
    expect(err.message).toBe('Internal Server Error');
    expect(err.retryable).toBe(true);
  });

  it('falls back to HTTP N when body is empty', async () => {
    const err = await buildApiError(429, '');
    expect(err.message).toBe('HTTP 429');
    expect(err.retryable).toBe(true);
  });
});
