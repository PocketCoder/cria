import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getAvatarSettings,
  setAvatarProvider,
  uploadAvatar,
  fetchAvatarBlob,
  changePassword,
  updateEmail,
  getTotpStatus,
  enrollTotp,
  enableTotp,
  disableTotp,
  fetchTotpQrBlob,
  listApiTokens,
  createApiToken,
  deleteApiToken,
  listApiRoutes,
  listCaldavTokens,
  createCaldavToken,
  deleteCaldavToken,
  getExportStatus,
  requestExport,
  downloadExport,
  requestDeletion,
  cancelDeletion,
  listTimezones,
} from '@/api/account';
import { ApiError } from '@/api/errors';

const { mockCallApi, mockCreateApiClient, mockCreateApiFetch } = vi.hoisted(() => ({
  mockCallApi: vi.fn(),
  mockCreateApiClient: vi.fn(),
  mockCreateApiFetch: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  callApi: mockCallApi,
  createApiClient: mockCreateApiClient,
  createApiFetch: mockCreateApiFetch,
  probeServer: vi.fn(),
}));

const mockClient = { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() };
const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateApiClient.mockReturnValue(mockClient);
  mockCreateApiFetch.mockReturnValue(mockFetch);
  mockFetch.mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob()) });
});

function mockResponse(overrides?: Partial<Response>): Response {
  return { ok: true, status: 200, blob: () => Promise.resolve(new Blob()), text: () => Promise.resolve(''), ...overrides } as Response;
}

// ── Avatar ──────────────────────────────────────────────────────────

describe('getAvatarSettings', () => {
  it('fetches avatar settings', async () => {
    mockCallApi.mockResolvedValue({ avatar_provider: 'marble' });
    const result = await getAvatarSettings(mockClient as never);
    expect(result).toEqual({ avatar_provider: 'marble' });
    expect(mockCallApi).toHaveBeenCalledOnce();
  });
});

describe('setAvatarProvider', () => {
  it('posts avatar provider', async () => {
    mockCallApi.mockResolvedValue(undefined);
    await setAvatarProvider('upload', mockClient as never);
    expect(mockClient.POST).toHaveBeenCalledWith('/user/settings/avatar', {
      body: { avatar_provider: 'upload' },
    });
  });
});

describe('uploadAvatar', () => {
  it('PUTs multipart form via createApiFetch', async () => {
    mockFetch.mockResolvedValue(mockResponse());
    const file = new Blob(['fake']);
    await uploadAvatar(file);
    expect(mockCreateApiFetch).toHaveBeenCalledOnce();
    const opts = mockFetch.mock.calls[0]![1] as RequestInit;
    expect(opts.method).toBe('PUT');
    expect(opts.body).toBeInstanceOf(FormData);
    expect((opts.body as FormData).has('avatar')).toBe(true);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(mockResponse({ ok: false, status: 400, text: () => Promise.resolve('bad image') }));
    await expect(uploadAvatar(new Blob())).rejects.toThrow('uploadAvatar: HTTP 400');
  });
});

describe('fetchAvatarBlob', () => {
  it('GETs /{username}/avatar as blob via createApiFetch', async () => {
    const blob = new Blob(['img'], { type: 'image/png' });
    mockFetch.mockResolvedValue(mockResponse({ blob: () => Promise.resolve(blob) }));
    const result = await fetchAvatarBlob('alice');
    expect(mockCreateApiFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith('/alice/avatar');
    expect(result).toBe(blob);
  });

  it('throws on error', async () => {
    mockFetch.mockResolvedValue(mockResponse({ ok: false, status: 404 }));
    await expect(fetchAvatarBlob('nobody')).rejects.toThrow('fetchAvatarBlob: HTTP 404');
  });
});

// ── Password ────────────────────────────────────────────────────────

describe('changePassword', () => {
  it('POSTs to /user/password', async () => {
    mockCallApi.mockResolvedValue(undefined);
    await changePassword('old', 'new', mockClient as never);
    expect(mockClient.POST).toHaveBeenCalledWith('/user/password', {
      body: { old_password: 'old', new_password: 'new' },
    });
  });
});

// ── Email ───────────────────────────────────────────────────────────

describe('updateEmail', () => {
  it('POSTs to /user/settings/email', async () => {
    mockCallApi.mockResolvedValue(undefined);
    await updateEmail('a@b.com', 'pwd', mockClient as never);
    expect(mockClient.POST).toHaveBeenCalledWith('/user/settings/email', {
      body: { new_email: 'a@b.com', password: 'pwd' },
    });
  });
});

// ── TOTP ────────────────────────────────────────────────────────────

describe('getTotpStatus', () => {
  it('returns totp status when enrolled', async () => {
    mockCallApi.mockResolvedValue({ enabled: true, secret: 'abc', url: 'otpauth://...' });
    const result = await getTotpStatus(mockClient as never);
    expect(result).toEqual({ enabled: true, secret: 'abc', url: 'otpauth://...' });
  });

  it('returns null when not enrolled (error code 1016)', async () => {
    mockCallApi.mockRejectedValue(new ApiError(412, 1016, 'TOTP is not enrolled', false));
    const result = await getTotpStatus(mockClient as never);
    expect(result).toBeNull();
  });

  it('rethrows non-1016 errors', async () => {
    mockCallApi.mockRejectedValue(new ApiError(500, 9999, 'Server error', true));
    await expect(getTotpStatus(mockClient as never)).rejects.toThrow('Server error');
  });

  it('rethrows non-ApiError errors', async () => {
    mockCallApi.mockRejectedValue(new Error('Network fail'));
    await expect(getTotpStatus(mockClient as never)).rejects.toThrow('Network fail');
  });
});

describe('enrollTotp', () => {
  it('POSTs to /user/settings/totp/enroll', async () => {
    mockCallApi.mockResolvedValue({ secret: 'xyz', url: 'otpauth://...' });
    const result = await enrollTotp(mockClient as never);
    expect(result).toEqual({ secret: 'xyz', url: 'otpauth://...' });
    expect(mockClient.POST).toHaveBeenCalledWith('/user/settings/totp/enroll');
  });
});

describe('enableTotp', () => {
  it('POSTs passcode to /user/settings/totp/enable', async () => {
    mockCallApi.mockResolvedValue(undefined);
    await enableTotp('123456', mockClient as never);
    expect(mockClient.POST).toHaveBeenCalledWith('/user/settings/totp/enable', {
      body: { passcode: '123456' },
    });
  });
});

describe('disableTotp', () => {
  it('POSTs password to /user/settings/totp/disable', async () => {
    mockCallApi.mockResolvedValue(undefined);
    await disableTotp('pwd', mockClient as never);
    expect(mockClient.POST).toHaveBeenCalledWith('/user/settings/totp/disable', {
      body: { password: 'pwd' },
    });
  });
});

describe('fetchTotpQrBlob', () => {
  it('GETs QR blob via createApiFetch', async () => {
    const blob = new Blob(['qr'], { type: 'image/jpeg' });
    mockFetch.mockResolvedValue(mockResponse({ blob: () => Promise.resolve(blob) }));
    const result = await fetchTotpQrBlob();
    expect(mockCreateApiFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith('/user/settings/totp/qrcode');
    expect(result).toBe(blob);
  });
});

// ── API tokens ──────────────────────────────────────────────────────

describe('listApiTokens', () => {
  it('GETs /tokens with query params', async () => {
    mockCallApi.mockResolvedValue([{ id: 1, title: 'dev' }]);
    const result = await listApiTokens({ s: 'dev' }, mockClient as never);
    expect(result).toEqual([{ id: 1, title: 'dev' }]);
    expect(mockClient.GET).toHaveBeenCalledWith('/tokens', {
      params: { query: { s: 'dev' } },
    });
  });
});

describe('createApiToken', () => {
  it('PUTs to /tokens', async () => {
    mockCallApi.mockResolvedValue({ id: 1, token: 'sekret', title: 'dev' });
    const result = await createApiToken({ title: 'dev' }, mockClient as never);
    expect(result.token).toBe('sekret');
    expect(mockClient.PUT).toHaveBeenCalledWith('/tokens', { body: { title: 'dev' } });
  });
});

describe('deleteApiToken', () => {
  it('DELETEs /tokens/{tokenID}', async () => {
    mockCallApi.mockResolvedValue(undefined);
    await deleteApiToken(5, mockClient as never);
    expect(mockClient.DELETE).toHaveBeenCalledWith('/tokens/{tokenID}', {
      params: { path: { tokenID: 5 } },
    });
  });
});

describe('listApiRoutes', () => {
  it('GETs /routes', async () => {
    mockCallApi.mockResolvedValue([{ tasks: [{ method: 'GET', path: '/tasks' }] }]);
    const result = await listApiRoutes(mockClient as never);
    expect(result).toEqual([{ tasks: [{ method: 'GET', path: '/tasks' }] }]);
    expect(mockClient.GET).toHaveBeenCalledWith('/routes');
  });
});

// ── CalDAV tokens ───────────────────────────────────────────────────

describe('listCaldavTokens', () => {
  it('GETs /user/settings/token/caldav', async () => {
    mockCallApi.mockResolvedValue([{ id: 1, created: '2024-01-01' }]);
    const result = await listCaldavTokens(mockClient as never);
    expect(result).toEqual([{ id: 1, created: '2024-01-01' }]);
  });
});

describe('createCaldavToken', () => {
  it('PUTs /user/settings/token/caldav', async () => {
    mockCallApi.mockResolvedValue({ id: 2, token: 'caldav-tok' });
    const result = await createCaldavToken(mockClient as never);
    expect(result.token).toBe('caldav-tok');
    expect(mockClient.PUT).toHaveBeenCalledWith('/user/settings/token/caldav');
  });
});

describe('deleteCaldavToken', () => {
  it('DELETEs /user/settings/token/caldav/{id}', async () => {
    mockCallApi.mockResolvedValue(undefined);
    await deleteCaldavToken(3, mockClient as never);
    expect(mockClient.DELETE).toHaveBeenCalledWith('/user/settings/token/caldav/{id}', {
      params: { path: { id: 3 } },
    });
  });
});

// ── Export ───────────────────────────────────────────────────────────

describe('getExportStatus', () => {
  it('GETs /user/export', async () => {
    mockCallApi.mockResolvedValue({ id: 1, size: 500 });
    const result = await getExportStatus(mockClient as never);
    expect(result).toEqual({ id: 1, size: 500 });
  });
});

describe('requestExport', () => {
  it('POSTs to /user/export/request', async () => {
    mockCallApi.mockResolvedValue(undefined);
    await requestExport('pwd', mockClient as never);
    expect(mockClient.POST).toHaveBeenCalledWith('/user/export/request', {
      body: { password: 'pwd' },
    });
  });
});

describe('downloadExport', () => {
  it('POSTs to /user/export/download via createApiFetch, returns blob', async () => {
    const blob = new Blob(['zip'], { type: 'application/zip' });
    mockFetch.mockResolvedValue(mockResponse({ blob: () => Promise.resolve(blob) }));
    const result = await downloadExport('pwd');
    expect(mockCreateApiFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith('/user/export/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'pwd' }),
    });
    expect(result).toBe(blob);
  });

  it('throws on error', async () => {
    mockFetch.mockResolvedValue(mockResponse({ ok: false, status: 403, text: () => Promise.resolve('forbidden') }));
    await expect(downloadExport('bad')).rejects.toThrow('downloadExport: HTTP 403');
  });
});

// ── Deletion ────────────────────────────────────────────────────────

describe('requestDeletion', () => {
  it('POSTs to /user/deletion/request with password', async () => {
    mockCallApi.mockResolvedValue(undefined);
    await requestDeletion('pwd', mockClient as never);
    expect(mockClient.POST).toHaveBeenCalledWith('/user/deletion/request', {
      body: { password: 'pwd' },
    });
  });
});

describe('cancelDeletion', () => {
  it('POSTs to /user/deletion/cancel with password', async () => {
    mockCallApi.mockResolvedValue(undefined);
    await cancelDeletion('pwd', mockClient as never);
    expect(mockClient.POST).toHaveBeenCalledWith('/user/deletion/cancel', {
      body: { password: 'pwd' },
    });
  });
});

// ── Timezones ───────────────────────────────────────────────────────

describe('listTimezones', () => {
  it('GETs /user/timezones', async () => {
    mockCallApi.mockResolvedValue(['UTC', 'Europe/Berlin']);
    const result = await listTimezones(mockClient as never);
    expect(result).toEqual(['UTC', 'Europe/Berlin']);
  });
});
