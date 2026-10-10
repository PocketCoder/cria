//! Native glass (design system "Liquid Glass", navigation layer only).
//!
//! - **macOS:** the window is transparent (tauri.macos.conf.json) and a native
//!   material sits behind the webview: `NSGlassEffectView` on macOS 26+, the
//!   `NSVisualEffectView` sidebar material before that (both via the
//!   tauri-apps `window-vibrancy` crate). Content panes stay opaque in CSS, so
//!   only the sidebar lets it show through (`html[data-native-glass=window]`).
//! - **iOS 26+:** a UIKit Liquid Glass tab bar (`UIGlassEffect`) laid over the
//!   webview in place of the web capsule; see
//!   `swift/CriaAI/Sources/CriaAI/Glass.swift`. The web tab bar stays mounted
//!   (invisible) as the source of truth for layout, state and visibility, and
//!   streams it here as JSON. Older iOS keeps the web capsule.
//!
//! `native_glass` tells the frontend which of these is live: `"window"`,
//! `"tabbar"` or `"none"`.

#[cfg(target_os = "macos")]
static WINDOW_GLASS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Put the native material behind the main window's webview. Call once from
/// `setup` (main thread). Best-effort: on failure the CSS keeps everything
/// opaque, because `native_glass` then reports `"none"`.
#[cfg(target_os = "macos")]
pub fn apply_window_glass(window: &tauri::WebviewWindow) {
    use window_vibrancy::{
        apply_liquid_glass, apply_vibrancy, LiquidGlassOptions, NSGlassEffectViewStyle,
        NSVisualEffectMaterial, NSVisualEffectState,
    };
    // Liquid Glass errors on macOS < 26; fall back to the classic material.
    let applied = apply_liquid_glass(
        window,
        LiquidGlassOptions::new(NSGlassEffectViewStyle::Regular),
    )
    .is_ok()
        || apply_vibrancy(
            window,
            NSVisualEffectMaterial::Sidebar,
            Some(NSVisualEffectState::FollowsWindowActiveState),
            None,
        )
        .is_ok();
    WINDOW_GLASS.store(applied, std::sync::atomic::Ordering::Relaxed);
}

#[cfg(all(target_os = "ios", target_arch = "aarch64"))]
mod ios {
    use std::ffi::{c_char, c_void, CString};

    extern "C" {
        fn cria_glass_tabbar_supported() -> bool;
        fn cria_glass_tabbar_update(webview: *mut c_void, state: *const c_char);
    }

    pub fn supported() -> bool {
        unsafe { cria_glass_tabbar_supported() }
    }

    pub fn update(window: &tauri::WebviewWindow, state: String) -> Result<(), String> {
        let state = CString::new(state).map_err(|e| e.to_string())?;
        // with_webview runs the closure on the main thread, which UIKit needs.
        window
            .with_webview(move |wv| unsafe { cria_glass_tabbar_update(wv.inner(), state.as_ptr()) })
            .map_err(|e| e.to_string())
    }
}

/// Which native glass is live: `"window"` (macOS material behind the
/// sidebar), `"tabbar"` (iOS 26 Liquid Glass tab bar) or `"none"`.
#[tauri::command]
pub fn native_glass() -> &'static str {
    #[cfg(target_os = "macos")]
    if WINDOW_GLASS.load(std::sync::atomic::Ordering::Relaxed) {
        return "window";
    }
    #[cfg(all(target_os = "ios", target_arch = "aarch64"))]
    if ios::supported() {
        return "tabbar";
    }
    "none"
}

/// Match the native material to the in-app theme (`"light"`, `"dark"`, or
/// null to follow the system). The glass follows the NSWindow appearance, not
/// the page's CSS, so without this a dark app on a light system gets light
/// glass. No-op off macOS.
#[tauri::command]
pub fn native_glass_theme(window: tauri::WebviewWindow, theme: Option<String>) {
    #[cfg(target_os = "macos")]
    {
        let theme = match theme.as_deref() {
            Some("dark") => Some(tauri::Theme::Dark),
            Some("light") => Some(tauri::Theme::Light),
            _ => None,
        };
        let _ = window.set_theme(theme);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (window, theme);
}

/// Push the web tab bar's state (frame, tabs, visibility, theme; JSON) to the
/// native iOS glass tab bar. No-op elsewhere.
#[tauri::command]
pub fn glass_tabbar_update(window: tauri::WebviewWindow, state: String) -> Result<(), String> {
    #[cfg(all(target_os = "ios", target_arch = "aarch64"))]
    return ios::update(&window, state);
    #[cfg(not(all(target_os = "ios", target_arch = "aarch64")))]
    {
        let _ = (window, state);
        Ok(())
    }
}
