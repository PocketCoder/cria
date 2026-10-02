use std::path::{Path, PathBuf};

fn main() {
    // build.rs runs on the host, so gate on the *target*, not cfg!(). arm64
    // only: Apple Intelligence needs Apple silicon, and swift-rs builds Swift
    // for the host arch, which breaks the x86_64 release job.
    let target = |k: &str| std::env::var(k).unwrap_or_default();
    if target("CARGO_CFG_TARGET_VENDOR") == "apple" && target("CARGO_CFG_TARGET_ARCH") == "aarch64" {
        // Xcode's "Build Rust Code" phase exports SDKROOT=iPhoneOS, which SwiftPM
        // then uses to compile the (macOS-hosted) Package.swift manifest, failing
        // with "unable to load standard library for target arm64-apple-macosx".
        // swift-rs passes the target SDK explicitly, so drop the inherited one.
        std::env::remove_var("SDKROOT");
        // On-device AI bridge (src/ai.rs). Builds the Swift package and links it.
        swift_rs::SwiftLinker::new("11")
            .with_ios("14")
            .with_package("CriaAI", "./swift/CriaAI")
            .link();
        // swift-rs 1.0.7 assumes the old SwiftPM layout (<arch>-apple-macosx/<cfg>);
        // Swift 6.4's build system writes out/Products/<Cfg>[-iphoneos]. Find it.
        let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("swift-rs/CriaAI");
        if let Some(dir) = find_dir_with(&out, "libCriaAI.a") {
            println!("cargo:rustc-link-search=native={}", dir.display());
        }
        // Swift runtime ships with the OS (macOS 10.15+/iOS 13+).
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
        // Weak-link so the app still launches on OSes without FoundationModels;
        // the Swift side checks #available before touching it.
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,FoundationModels");
    }
    tauri_build::build()
}

fn find_dir_with(dir: &Path, file: &str) -> Option<PathBuf> {
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.file_name().is_some_and(|n| n == file) {
            return Some(dir.to_path_buf());
        }
        // Skip symlinks (e.g. `debug -> out/Products/Debug`) to avoid loops.
        if entry.file_type().is_ok_and(|t| t.is_dir()) {
            if let Some(found) = find_dir_with(&path, file) {
                return Some(found);
            }
        }
    }
    None
}
