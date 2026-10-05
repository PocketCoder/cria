//! On-device language model via Apple's Foundation Models framework.
//!
//! Foundation Models is Swift-only, so `objc2` can't reach it (unlike Vision in
//! `ocr.rs`). The Swift package in `swift/CriaAI` exposes one C function,
//! `cria_ai_generate`, which `build.rs` compiles and links. Strings in, JSON
//! string out; structure (task drafts etc.) lives in the prompt and in TS.
//!
//! On iOS the call runs as a `BGContinuedProcessingTask` (system progress Live
//! Activity, survives app switching) and notifies on finish if backgrounded;
//! see `swift/CriaAI/Sources/CriaAI/Background.swift`.
//!
//! Needs macOS/iOS 26+ on Apple Intelligence hardware with it switched on.
//! Intel Macs and other platforms get a stub (no Apple silicon, no model).
//! Anywhere else the command returns an `unavailable…`/`unsupportedOS` error
//! and the UI should hide the feature or fall back to BYOK.

#[cfg(all(any(target_os = "macos", target_os = "ios"), target_arch = "aarch64"))]
mod native {
    use std::ffi::{c_char, c_void, CStr, CString};

    extern "C" {
        fn cria_ai_generate(
            title: *const c_char,
            instructions: *const c_char,
            prompt: *const c_char,
        ) -> *mut c_char;
        fn cria_ai_availability() -> *mut c_char;
        fn free(ptr: *mut c_void);
    }

    pub fn availability() -> String {
        unsafe {
            let ptr = cria_ai_availability();
            let s = CStr::from_ptr(ptr).to_string_lossy().into_owned();
            free(ptr.cast());
            s
        }
    }

    #[derive(serde::Deserialize)]
    struct Reply {
        text: Option<String>,
        error: Option<String>,
    }

    /// Blocking call into Swift. Must run off the main thread.
    pub fn generate(title: &str, instructions: &str, prompt: &str) -> Result<String, String> {
        let title = CString::new(title).map_err(|e| e.to_string())?;
        let instructions = CString::new(instructions).map_err(|e| e.to_string())?;
        let prompt = CString::new(prompt).map_err(|e| e.to_string())?;
        let json = unsafe {
            let ptr = cria_ai_generate(title.as_ptr(), instructions.as_ptr(), prompt.as_ptr());
            let json = CStr::from_ptr(ptr).to_string_lossy().into_owned();
            free(ptr.cast());
            json
        };
        let reply: Reply = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        match (reply.text, reply.error) {
            (Some(text), _) => Ok(text),
            (_, err) => Err(err.unwrap_or_else(|| "empty reply".into())),
        }
    }

    // Smoke test against the real model: `cargo test ai -- --ignored --nocapture`.
    #[test]
    #[ignore = "needs Apple Intelligence on this machine"]
    fn round_trip() {
        println!("availability: {}", availability());
        let out = generate("Test", "Reply with one word.", "Say hello.");
        println!("{out:?}");
        assert!(out.is_ok(), "{out:?}");
    }

    // Prompt iteration against the real model: for each `<name>.instr` +
    // `<name>.prompt` in $CRIA_AI_CASES, print the reply.
    // `CRIA_AI_CASES=/path cargo test --lib eval_cases -- --ignored --nocapture`
    #[test]
    #[ignore = "needs Apple Intelligence and CRIA_AI_CASES"]
    fn eval_cases() {
        let dir = std::path::PathBuf::from(std::env::var("CRIA_AI_CASES").expect("CRIA_AI_CASES"));
        let mut names: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok()?.path().file_stem()?.to_str().map(String::from))
            .collect();
        names.sort();
        names.dedup();
        for name in names {
            let read =
                |ext: &str| std::fs::read_to_string(dir.join(format!("{name}.{ext}"))).unwrap();
            println!(
                "=== {name}\n{}\n",
                generate(&name, &read("instr"), &read("prompt"))
                    .unwrap_or_else(|e| format!("ERROR {e}"))
            );
        }
    }
}

#[cfg(all(any(target_os = "macos", target_os = "ios"), target_arch = "aarch64"))]
#[tauri::command]
/// `title` names the work in the iOS progress Live Activity and the
/// completion notification (e.g. "Organising your ramble").
pub async fn ai_generate(
    title: String,
    instructions: String,
    prompt: String,
) -> Result<String, String> {
    // Swift blocks on a semaphore; keep it off the main (and async) threads.
    tauri::async_runtime::spawn_blocking(move || native::generate(&title, &instructions, &prompt))
        .await
        .map_err(|e| e.to_string())?
}

/// `"available"` or the reason the model can't run here.
#[cfg(all(any(target_os = "macos", target_os = "ios"), target_arch = "aarch64"))]
#[tauri::command]
pub fn ai_availability() -> String {
    native::availability()
}

#[cfg(not(all(any(target_os = "macos", target_os = "ios"), target_arch = "aarch64")))]
#[tauri::command]
pub fn ai_availability() -> String {
    "unsupportedOS".to_string()
}

#[cfg(not(all(any(target_os = "macos", target_os = "ios"), target_arch = "aarch64")))]
#[tauri::command]
pub async fn ai_generate(
    _title: String,
    _instructions: String,
    _prompt: String,
) -> Result<String, String> {
    Err("unsupportedOS".to_string())
}
