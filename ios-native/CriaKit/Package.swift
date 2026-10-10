// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CriaKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "CriaKit", targets: ["CriaKit"]),
    ],
    targets: [
        .target(name: "CriaKit"),
        .testTarget(name: "CriaKitTests", dependencies: ["CriaKit"]),
    ],
    swiftLanguageModes: [.v6]
)
