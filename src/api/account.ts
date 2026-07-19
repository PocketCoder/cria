import { type ApiClient, callApi, createApiClient, createApiFetch } from './client';
import { ApiError } from './errors';

// ── Avatar ──────────────────────────────────────────────────────────

export interface AvatarSettings {
  avatar_provider?: string;
}

export async function getAvatarSettings(
  client: ApiClient = createApiClient(),
): Promise<AvatarSettings> {
  return callApi(client.GET('/user/settings/avatar'));
}

export async function setAvatarProvider(
  provider: string,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.POST('/user/settings/avatar', {
      body: { avatar_provider: provider },
    }),
  );
}

export async function uploadAvatar(
  file: File | Blob,
): Promise<void> {
  const api = createApiFetch();
  const form = new FormData();
  form.append('avatar', file);
  const res = await api('/user/settings/avatar/upload', {
    method: 'PUT',
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`uploadAvatar: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
}

export async function fetchAvatarBlob(
  username: string,
): Promise<Blob> {
  const api = createApiFetch();
  const res = await api(`/${encodeURIComponent(username)}/avatar`);
  if (!res.ok) throw new Error(`fetchAvatarBlob: HTTP ${res.status}`);
  return res.blob();
}

// ── Password ────────────────────────────────────────────────────────

export async function changePassword(
  oldPassword: string,
  newPassword: string,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.POST('/user/password', {
      body: { old_password: oldPassword, new_password: newPassword },
    }),
  );
}

// ── Email ───────────────────────────────────────────────────────────

export async function updateEmail(
  newEmail: string,
  password: string,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.POST('/user/settings/email', {
      body: { new_email: newEmail, password },
    }),
  );
}

// ── TOTP ────────────────────────────────────────────────────────────

/**
 * Return current TOTP status, or null if not enrolled.
 * GET /user/settings/totp returns 412 with error code 1016 when TOTP
 * hasn't been enrolled yet — we surface that as null.
 */
export interface TotpStatus {
  enabled?: boolean;
  secret?: string;
  url?: string;
}

export async function getTotpStatus(
  client: ApiClient = createApiClient(),
): Promise<TotpStatus | null> {
  try {
    return await callApi(client.GET('/user/settings/totp'));
  } catch (err) {
    if (err instanceof ApiError && err.code === 1016) return null;
    throw err;
  }
}

export async function enrollTotp(
  client: ApiClient = createApiClient(),
): Promise<TotpStatus> {
  return callApi(client.POST('/user/settings/totp/enroll'));
}

export async function enableTotp(
  passcode: string,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.POST('/user/settings/totp/enable', {
      body: { passcode },
    }),
  );
}

export async function disableTotp(
  password: string,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.POST('/user/settings/totp/disable', {
      body: { password },
    }),
  );
}

export async function fetchTotpQrBlob(): Promise<Blob> {
  const api = createApiFetch();
  const res = await api('/user/settings/totp/qrcode');
  if (!res.ok) throw new Error(`fetchTotpQrBlob: HTTP ${res.status}`);
  return res.blob();
}

// ── API tokens ──────────────────────────────────────────────────────

export interface ApiToken {
  id?: number;
  title?: string;
  token?: string;
  created?: string;
  expires_at?: string;
  permissions?: Record<string, string[]>;
  owner_id?: number;
}

export interface ApiTokenInput {
  title: string;
  expires_at?: string;
  permissions?: Record<string, string[]>;
  owner_id?: number;
}

export interface ApiRouteGroup {
  [key: string]: { method?: string; path?: string };
}

export async function listApiTokens(
  params?: { page?: number; per_page?: number; s?: string },
  client: ApiClient = createApiClient(),
): Promise<ApiToken[]> {
  return callApi(
    client.GET('/tokens', { params: { query: params ?? {} } }),
  );
}

export async function createApiToken(
  input: ApiTokenInput,
  client: ApiClient = createApiClient(),
): Promise<ApiToken> {
  return callApi(
    client.PUT('/tokens', { body: input }),
  );
}

export async function deleteApiToken(
  tokenId: number,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.DELETE('/tokens/{tokenID}', {
      params: { path: { tokenID: tokenId } },
    }),
  );
}

export async function listApiRoutes(
  client: ApiClient = createApiClient(),
): Promise<ApiRouteGroup[]> {
  return callApi(client.GET('/routes'));
}

// ── CalDAV tokens ───────────────────────────────────────────────────

export interface CaldavToken {
  id?: number;
  token?: string;
  created?: string;
}

export async function listCaldavTokens(
  client: ApiClient = createApiClient(),
): Promise<CaldavToken[]> {
  return callApi(client.GET('/user/settings/token/caldav'));
}

export async function createCaldavToken(
  client: ApiClient = createApiClient(),
): Promise<CaldavToken> {
  return callApi(client.PUT('/user/settings/token/caldav'));
}

export async function deleteCaldavToken(
  id: number,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.DELETE('/user/settings/token/caldav/{id}', {
      params: { path: { id } },
    }),
  );
}

// ── Export ───────────────────────────────────────────────────────────

export interface ExportStatus {
  id?: number;
  created?: string;
  expires?: string;
  size?: number;
}

export async function getExportStatus(
  client: ApiClient = createApiClient(),
): Promise<ExportStatus> {
  return callApi(client.GET('/user/export'));
}

export async function requestExport(
  password: string,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.POST('/user/export/request', {
      body: { password },
    }),
  );
}

export async function downloadExport(
  password: string,
): Promise<Blob> {
  const api = createApiFetch();
  const res = await api('/user/export/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`downloadExport: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return res.blob();
}

// ── Deletion ────────────────────────────────────────────────────────

export async function requestDeletion(
  password: string,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.POST('/user/deletion/request', {
      body: { password },
    }),
  );
}

export async function cancelDeletion(
  password: string,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.POST('/user/deletion/cancel', {
      body: { password },
    }),
  );
}

// ── Timezones ───────────────────────────────────────────────────────

export async function listTimezones(
  client: ApiClient = createApiClient(),
): Promise<string[]> {
  return callApi(client.GET('/user/timezones'));
}
