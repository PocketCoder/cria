//! OS-keychain-backed storage for the Vikunja auth token (desktop).
//!
//! The token previously lived in the webview's localStorage — plaintext in the
//! app data dir. These commands stash it in the platform secret store
//! (macOS Keychain, Windows Credential Manager, Linux Secret Service) via the
//! `keyring` crate, so a stolen data-dir snapshot no longer yields the token.
//!
//! Desktop-only: the `keyring` crate's backends target macOS/Windows/Linux.
//! On iOS the frontend probes for these commands, finds them absent, and falls
//! back to localStorage (see src/auth/storage.ts) — an iOS Keychain path is a
//! follow-up that needs on-device verification.

#![cfg(desktop)]

const SERVICE: &str = "Cria";
const ACCOUNT: &str = "vikunja-token";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_get_token() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secure_set_token(token: String) -> Result<(), String> {
    entry()?.set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_delete_token() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
