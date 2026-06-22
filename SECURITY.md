# Security model

Cria is a local-first desktop/iOS client for a self-hosted Vikunja server. This
documents how credentials and user data are protected, and the known gaps.

## In transit

- All credentialed requests go over **HTTPS**. `guardTokenDestination()`
  (`src/api/client.ts`) refuses to attach the `Bearer` token to any origin that
  isn't `https://` or a loopback address, so the token can't leak over plaintext
  HTTP even by misconfiguration.
- Requests are issued from the Rust side via Tauri's HTTP plugin, scoped in
  `src-tauri/capabilities/default.json` to `https://**` plus localhost. TLS
  certificates are validated (no verification-bypass flags).
- 2FA/TOTP is supported: a `412` from `/login` prompts for the code.
- On a `401` (token expired/revoked) the client clears credentials and returns
  to the login screen (`handleUnauthorized` in `src/api/client.ts`).

## Auth token at rest

- **Desktop (macOS/Windows/Linux):** stored in the OS secret store (Keychain /
  Credential Manager / Secret Service) via the `secure_*_token` Tauri commands
  (`src-tauri/src/secure.rs`, `keyring` crate). A stolen app-data-dir snapshot
  does **not** contain the token.
- **iOS / browser dev / tests:** the native commands aren't present, so the
  token falls back to `localStorage` (`src/auth/storage.ts`). Protection there is
  the OS file sandbox + disk encryption (iOS Data Protection requires a device
  passcode). **Follow-up:** wire an iOS Keychain backend (needs on-device
  verification).
- Only the non-secret `serverUrl` / `authMethod` live in `localStorage`. The
  password is never persisted — it exists only in form state during sign-in.
- Tokens are requested as `long_token` (long-lived); a leaked token is valid
  until revoked server-side.

## User data at rest

- The local SQLite database (`cria.db`) — tasks, descriptions, comments — is
  **unencrypted**. The perimeter is OS-level disk encryption (FileVault on macOS,
  iOS Data Protection) plus the per-app sandbox / file permissions.
- **Follow-up:** at-rest DB encryption would require a SQLCipher-backed SQL
  layer (tauri-plugin-sql doesn't support it out of the box) — a larger change
  tracked separately. Forcing `NSFileProtectionComplete` on iOS was considered
  but rejected: it locks files while the device is locked, which would break
  background reminder/sync work.

## Webview hardening

- Strict CSP (`src-tauri/tauri.conf.json`): `script-src 'self'` (no inline/eval
  scripts), `object-src 'none'`, `frame-src 'none'`, `connect-src 'self' ipc:` —
  the webview itself cannot fetch arbitrary origins.
- All HTML synced from the server (task descriptions, comments) is sanitised
  with **DOMPurify** before `dangerouslySetInnerHTML` (`src/lib/sanitize.ts`):
  tag/attribute allowlist, explicit URI-scheme pinning, and an
  `afterSanitizeAttributes` hook that forces `rel="noopener noreferrer"` +
  `target="_blank"` on links and drops non-http(s)/mailto/relative hrefs.
- No `shell` capability and no broad `fs` capability — limited blast radius.

## Privacy

- Only the user's chosen Vikunja server is contacted; no telemetry.
- The shopping-list photo OCR runs on-device (Apple Vision, or a bundled WASM
  fallback) — images are never sent to a third party.
