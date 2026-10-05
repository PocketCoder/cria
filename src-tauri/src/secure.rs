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

    /// Keychain account for a build flavour. Stable keeps the original name so
    /// existing sign-ins survive; Nightly and Dev get their own item. macOS
    /// treats each as a different app, so sharing one item made every flavour
    /// prompt for access to the others' entry.
    pub fn account_for(identifier: &str) -> String {
        match identifier.strip_prefix("io.cria.app.") {
            Some(flavour) if !flavour.is_empty() => format!("{ACCOUNT}.{flavour}"),
            _ => ACCOUNT.to_string(),
        }
    }

    fn entry(account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())
    }

    pub fn get(account: &str) -> Result<Option<String>, String> {
        match entry(account)?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn set(account: &str, token: String) -> Result<(), String> {
        entry(account)?
            .set_password(&token)
            .map_err(|e| e.to_string())
    }

    pub fn delete(account: &str) -> Result<(), String> {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(target_os = "android")]
mod backend {
    pub fn account_for(_identifier: &str) -> String {
        String::new()
    }
    pub fn get(_account: &str) -> Result<Option<String>, String> {
        Err("native keychain unavailable on this platform".to_string())
    }
    pub fn set(_account: &str, _token: String) -> Result<(), String> {
        Err("native keychain unavailable on this platform".to_string())
    }
    pub fn delete(_account: &str) -> Result<(), String> {
        Ok(())
    }
}

fn account(app: &tauri::AppHandle) -> String {
    backend::account_for(&app.config().identifier)
}

#[tauri::command]
pub fn secure_get_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
    backend::get(&account(&app))
}

#[tauri::command]
pub fn secure_set_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
    backend::set(&account(&app), token)
}

#[tauri::command]
pub fn secure_delete_token(app: tauri::AppHandle) -> Result<(), String> {
    backend::delete(&account(&app))
}

#[cfg(all(test, not(target_os = "android")))]
mod tests {
    use super::backend::account_for;

    #[test]
    fn stable_keeps_the_original_account() {
        assert_eq!(account_for("io.cria.app"), "vikunja-token");
    }

    #[test]
    fn other_flavours_get_their_own_account() {
        assert_eq!(account_for("io.cria.app.nightly"), "vikunja-token.nightly");
        assert_eq!(account_for("io.cria.app.dev"), "vikunja-token.dev");
    }
}
