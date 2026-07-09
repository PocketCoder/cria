import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authLinkShare, SHARE_PASSWORD_REQUIRED_CODE } from '@/api/shareAuth';
import { ApiError } from '@/api/errors';

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));

vi.mock('openapi-fetch', () => ({
  default: () => ({ POST: mockPost }),
}));

vi.mock('@/api/client', () => ({
  platformFetch: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

function ok(data: unknown) {
  return Promise.resolve({
    data,
    response: { ok: true, status: 200, text: vi.fn().mockResolvedValue('') },
  });
}

describe('authLinkShare', () => {
  it('POSTs the hash (and password) and returns the JWT', async () => {
    mockPost.mockReturnValue(ok({ token: 'jwt-token' }));
    const result = await authLinkShare('https://v.example.com', 'aBc123', 'pw');
    expect(mockPost).toHaveBeenCalledWith('/shares/{share}/auth', {
      params: { path: { share: 'aBc123' } },
      body: { password: 'pw' },
    });
    expect(result.token).toBe('jwt-token');
  });

  it('throws ApiError with the password-required code on 13001', async () => {
    mockPost.mockReturnValue(
      Promise.resolve({
        data: undefined,
        response: {
          ok: false,
          status: 412,
          text: vi.fn().mockResolvedValue(
            JSON.stringify({ code: 13001, message: 'password required' }),
          ),
        },
      }),
    );
    await expect(authLinkShare('https://v.example.com', 'aBc123')).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ApiError && e.code === SHARE_PASSWORD_REQUIRED_CODE,
    );
  });
});
