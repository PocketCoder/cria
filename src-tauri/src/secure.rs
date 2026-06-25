//! OS-keychain-backed storage for the Vikunja auth token.
//!
//! The token previously lived in the webview's localStorage — plaintext in the
//! app data dir. These commands stash it in the platform secret store via the
//! `keyring` crate: macOS/iOS **Keychain**, Windows Credential Manager, Linux
//! Secret Service. A stolen data-dir snapshot no longer yields the token.
//!
//! Android has no `keyring` backend wired here, so its commands return an error
//! and the frontend falls back to localStorage (see src/auth/storage.ts, which
//! probes for a working store and degrades gracefully).

#[cfg(not(target_os = "android"))]
mod backend {
    const SERVICE: &str = "Cria";
    const ACCOUNT: &str = "vikunja-token";

    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
    }

    pub fn get() -> Result<Option<String>, String> {
        match entry()?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn set(token: String) -> Result<(), String> {
        entry()?.set_password(&token).map_err(|e| e.to_string())
    }

    pub fn delete() -> Result<(), String> {
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(target_os = "android")]
mod backend {
    pub fn get() -> Result<Option<String>, String> {
        Err("native keychain unavailable on this platform".to_string())
    }
    pub fn set(_token: String) -> Result<(), String> {
        Err("native keychain unavailable on this platform".to_string())
    }
    pub fn delete() -> Result<(), String> {
        Ok(())
    }
}

#[tauri::command]
pub fn secure_get_token() -> Result<Option<String>, String> {
    backend::get()
}

#[tauri::command]
pub fn secure_set_token(token: String) -> Result<(), String> {
    backend::set(token)
}

#[tauri::command]
pub fn secure_delete_token() -> Result<(), String> {
    backend::delete()
}
