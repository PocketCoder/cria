import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callApi, createApiClient, guardDestination, probeServer } from '@/api/client';
import { ApiError, NetworkError } from '@/api/errors';

const { mockGetAuthSnapshot, mockCreateClient } = vi.hoisted(() => ({
  mockGetAuthSnapshot: vi.fn(),
  mockCreateClient: vi.fn(),
}));

vi.mock('@/auth/store', () => ({
  getAuthSnapshot: mockGetAuthSnapshot,
}));

vi.mock('openapi-fetch', () => ({
  default: mockCreateClient,
}));

function mockResponse(data: unknown, ok = true, status = 200, bodyText = '') {
  return Promise.resolve({
    data,
    error: undefined,
    response: { ok, status, text: () => Promise.resolve(bodyText) } as unknown as Response,
  });
}

const mockClient = {
  GET: vi.fn(),
  POST: vi.fn(),
  PUT: vi.fn(),
  DELETE: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthSnapshot.mockReturnValue({
    serverUrl: 'https://example.com',
    token: 'test-token',
  });
  mockClient.GET.mockReturnValue(mockResponse({}));
  mockClient.POST.mockReturnValue(mockResponse({}));
  mockCreateClient.mockReturnValue(mockClient);
});

describe('callApi', () => {
  it('returns data on 2xx', async () => {
    const result = await callApi(
      Promise.resolve({
        data: { id: 1 },
        error: undefined,
        response: { ok: true } as Response,
      }),
    );
    expect(result).toEqual({ id: 1 });
  });

  it('returns undefined for 204 No Content', async () => {
    const result = await callApi(
      Promise.resolve({
        data: undefined,
        error: undefined,
        response: { ok: true, status: 204 } as Response,
      }),
    );
    expect(result).toBeUndefined();
  });

  it('throws ApiError on 4xx', async () => {
    await expect(
      callApi(
        Promise.resolve({
          data: undefined,
          error: {},
          response: {
            ok: false,
            status: 400,
            text: () => Promise.resolve(JSON.stringify({ message: 'bad', code: 3001 })),
          } as unknown as Response,
        }),
      ),
    ).rejects.toThrow(ApiError);
  });

  it('throws ApiError with Vikunja envelope on 4xx', async () => {
    await expect(
      callApi(
        Promise.resolve({
          data: undefined,
          error: {},
          response: {
            ok: false,
            status: 400,
            text: () => Promise.resolve(JSON.stringify({ message: 'invalid', code: 3001 })),
          } as unknown as Response,
        }),
      ),
    ).rejects.toMatchObject({ status: 400, code: 3001, message: 'invalid' });
  });

  it('throws NetworkError on rejection', async () => {
    await expect(callApi(Promise.reject(new Error('offline')))).rejects.toThrow(NetworkError);
  });

  it('NetworkError is retryable', async () => {
    try {
      await callApi(Promise.reject(new Error('offline')));
    } catch (e) {
      expect((e as NetworkError).retryable).toBe(true);
    }
  });
});

describe('createApiClient', () => {
  it('creates client with auth token from snapshot', () => {
    createApiClient();
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://example.com/api/v1',
        headers: { Authorization: 'Bearer test-token' },
      }),
    );
  });

  it('handles missing snapshot gracefully', () => {
    mockGetAuthSnapshot.mockReturnValue({ serverUrl: '', token: '' });
    createApiClient();
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: '/api/v1',
        headers: {},
      }),
    );
  });

  it('overrides baseUrl from options', () => {
    createApiClient({ baseUrl: 'https://other.com', token: 'custom' });
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://other.com/api/v1',
        headers: { Authorization: 'Bearer custom' },
      }),
    );
  });

  it('normalises trailing slashes from baseUrl', () => {
    mockGetAuthSnapshot.mockReturnValue({ serverUrl: 'https://example.com///', token: 'tok' });
    createApiClient();
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://example.com/api/v1' }),
    );
  });

  it('passes platformFetch as the fetch implementation', () => {
    createApiClient();
    const opts = mockCreateClient.mock.calls[0]![0]!;
    expect(typeof opts.fetch).toBe('function');
  });
});

describe('guardDestination', () => {
  it('allows https destinations', () => {
    expect(() => guardDestination('https://example.com')).not.toThrow();
  });

  it('allows loopback http destinations', () => {
    expect(() => guardDestination('http://localhost:3456')).not.toThrow();
    expect(() => guardDestination('http://127.0.0.1:3456')).not.toThrow();
  });

  it('refuses plaintext http to a non-loopback host', () => {
    expect(() => guardDestination('http://example.com')).toThrow(/Refusing/);
  });

  it('fails closed on an unparseable URL instead of silently allowing it', () => {
    expect(() => guardDestination('not a url')).toThrow(/Refusing/);
  });
});

describe('createApiClient destination guard', () => {
  it('throws instead of sending a token to a plaintext non-loopback host', () => {
    mockGetAuthSnapshot.mockReturnValue({ serverUrl: 'http://example.com', token: 'test-token' });
    expect(() => createApiClient()).toThrow(/Refusing/);
  });
});

describe('probeServer', () => {
  it('returns version from /info', async () => {
    mockClient.GET.mockReturnValue(mockResponse({ version: '1.2.3' }));
    const result = await probeServer('https://example.com');
    expect(result).toEqual({ version: '1.2.3' });
    expect(mockClient.GET).toHaveBeenCalledWith('/info');
  });

  it('returns null version when not present', async () => {
    mockClient.GET.mockReturnValue(mockResponse({}));
    const result = await probeServer('https://example.com');
    expect(result).toEqual({ version: null });
  });

  it('normalises trailing slash', async () => {
    mockClient.GET.mockReturnValue(mockResponse({}));
    await probeServer('https://example.com///');
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://example.com/api/v1' }),
    );
  });

  it('passes platformFetch as fetch implementation', async () => {
    mockClient.GET.mockReturnValue(mockResponse({}));
    await probeServer('https://example.com');
    const opts = mockCreateClient.mock.calls[0]![0]!;
    expect(typeof opts.fetch).toBe('function');
  });
});
