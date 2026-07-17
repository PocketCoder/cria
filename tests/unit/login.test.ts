import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loginWithPassword, isTotpRequired } from '@/api/login';
import { ApiError, NetworkError } from '@/api/errors';

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

vi.mock('openapi-fetch', () => ({
  default: mockCreateClient,
}));

function mockResponse(status: number, data: unknown) {
  const ok = status >= 200 && status < 300;
  return Promise.resolve({
    data: ok ? data : undefined,
    // openapi-fetch already reads+parses the body into `error` before we
    // see the Response — its stream is consumed, so `text()` rejects like
    // a real drained body would (see api/errors.ts buildApiError).
    error: ok ? undefined : data,
    response: {
      ok,
      status,
      text: () => Promise.reject(new Error('body stream already read')),
    } as unknown as Response,
  });
}

const mockClient = {
  POST: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.POST.mockReturnValue(mockResponse(200, { token: 'eyJ.jwt.token' }));
  mockCreateClient.mockReturnValue(mockClient);
});

describe('loginWithPassword', () => {
  const serverUrl = 'https://vikunja.example.com';

  it('returns a token on successful login', async () => {
    const { token } = await loginWithPassword(serverUrl, {
      username: 'jane',
      password: 'secret',
    });

    expect(token).toBe('eyJ.jwt.token');
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://vikunja.example.com/api/v1' }),
    );
    expect(mockClient.POST).toHaveBeenCalledWith('/login', {
      body: {
        username: 'jane',
        password: 'secret',
        long_token: true,
        totp_passcode: undefined,
      },
    });
  });

  it('sends totp_passcode when provided', async () => {
    await loginWithPassword(serverUrl, {
      username: 'jane',
      password: 'secret',
      totp_passcode: '123456',
    });

    expect(mockClient.POST).toHaveBeenCalledWith('/login', {
      body: expect.objectContaining({ totp_passcode: '123456' }),
    });
  });

  it('sends long_token: false when explicitly set', async () => {
    await loginWithPassword(serverUrl, {
      username: 'jane',
      password: 'secret',
      long_token: false,
    });

    expect(mockClient.POST).toHaveBeenCalledWith('/login', {
      body: expect.objectContaining({ long_token: false }),
    });
  });

  it('normalises trailing slashes from serverUrl', async () => {
    await loginWithPassword('https://vikunja.example.com///', {
      username: 'jane',
      password: 'secret',
    });

    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://vikunja.example.com/api/v1' }),
    );
  });

  it('throws ApiError with status 412 when TOTP is required', async () => {
    mockClient.POST.mockReturnValue(
      mockResponse(412, { message: 'Invalid totp passcode.', code: 2002 }),
    );

    await expect(
      loginWithPassword(serverUrl, { username: 'jane', password: 'secret' }),
    ).rejects.toThrow(ApiError);

    try {
      await loginWithPassword(serverUrl, { username: 'jane', password: 'secret' });
    } catch (err) {
      expect((err as ApiError).status).toBe(412);
    }
  });

  it('throws ApiError with status 403 on bad credentials', async () => {
    mockClient.POST.mockReturnValue(
      mockResponse(403, { message: 'Invalid username or password.', code: 2001 }),
    );

    await expect(
      loginWithPassword(serverUrl, { username: 'jane', password: 'wrong' }),
    ).rejects.toThrow(ApiError);
  });

  it('throws NetworkError on network failure', async () => {
    mockClient.POST.mockReturnValue(Promise.reject(new Error('connect ECONNREFUSED')));

    await expect(
      loginWithPassword(serverUrl, { username: 'jane', password: 'secret' }),
    ).rejects.toThrow(NetworkError);
  });
});

describe('isTotpRequired', () => {
  it('returns true for ApiError with status 412', () => {
    expect(isTotpRequired(new ApiError(412, 2002, 'totp required', false))).toBe(true);
  });

  it('returns false for other ApiError statuses', () => {
    expect(isTotpRequired(new ApiError(403, 2001, 'bad auth', false))).toBe(false);
    expect(isTotpRequired(new ApiError(400, 3001, 'bad request', false))).toBe(false);
    expect(isTotpRequired(new ApiError(500, null, 'server error', true))).toBe(false);
  });

  it('returns false for non-ApiError values', () => {
    expect(isTotpRequired(new Error('generic'))).toBe(false);
    expect(isTotpRequired(null)).toBe(false);
    expect(isTotpRequired('string')).toBe(false);
    expect(isTotpRequired(undefined)).toBe(false);
  });
});
