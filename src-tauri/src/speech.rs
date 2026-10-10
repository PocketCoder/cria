//! Live dictation via Apple's Speech framework (Swift bridge in
//! `swift/CriaAI/Sources/CriaAI/Speech.swift`).
//!
//! Swift reports through one C callback; each JSON event is re-emitted to the
//! webview as a `speech` Tauri event (`{kind: interim|final|end, text?, error?}`).
//! Start/stop return immediately, so these commands are fine on any thread.
//! Apple silicon only, like the AI bridge; elsewhere `speech_available` is false.

#[cfg(all(any(target_os = "macos", target_os = "ios"), target_arch = "aarch64"))]
mod native {
    use std::ffi::{c_char, CStr};
    use std::sync::OnceLock;
    use tauri::{AppHandle, Emitter};

    static APP: OnceLock<AppHandle> = OnceLock::new();

    extern "C" {
        fn cria_speech_start(cb: extern "C" fn(*const c_char));
        fn cria_speech_stop();
    }

    extern "C" fn on_event(json: *const c_char) {
        if json.is_null() {
            return;
        }
        let text = unsafe { CStr::from_ptr(json) }.to_string_lossy().into_owned();
        if let (Some(app), Ok(value)) = (APP.get(), serde_json::from_str::<serde_json::Value>(&text))
        {
            let _ = app.emit("speech", value);
        }
    }

    pub fn start(app: AppHandle) {
        let _ = APP.set(app);
        unsafe { cria_speech_start(on_event) };
    }

    pub fn stop() {
        unsafe { cria_speech_stop() };
    }
}

#[cfg(all(any(target_os = "macos", target_os = "ios"), target_arch = "aarch64"))]
#[tauri::command]
pub fn speech_start(app: tauri::AppHandle) {
    native::start(app);
}

#[cfg(all(any(target_os = "macos", target_os = "ios"), target_arch = "aarch64"))]
#[tauri::command]
pub fn speech_stop() {
    native::stop();
}

#[cfg(all(any(target_os = "macos", target_os = "ios"), target_arch = "aarch64"))]
#[tauri::command]
pub fn speech_available() -> bool {
    true
}

#[cfg(not(all(any(target_os = "macos", target_os = "ios"), target_arch = "aarch64")))]
#[tauri::command]
pub fn speech_start(_app: tauri::AppHandle) {}

#[cfg(not(all(any(target_os = "macos", target_os = "ios"), target_arch = "aarch64")))]
#[tauri::command]
pub fn speech_stop() {}

#[cfg(not(all(any(target_os = "macos", target_os = "ios"), target_arch = "aarch64")))]
#[tauri::command]
pub fn speech_available() -> bool {
    false
}
