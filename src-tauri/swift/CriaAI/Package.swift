// swift-tools-version:5.9
// Swift side of the on-device AI bridge (see src-tauri/src/ai.rs).
// Built and statically linked by build.rs via swift-rs. Platforms stay low so
// the app still launches on older OSes; FoundationModels is gated at runtime.
import PackageDescription

let package = Package(
    name: "CriaAI",
    platforms: [.macOS(.v11), .iOS(.v14)],
    products: [.library(name: "CriaAI", type: .static, targets: ["CriaAI"])],
    targets: [.target(name: "CriaAI")]
)
