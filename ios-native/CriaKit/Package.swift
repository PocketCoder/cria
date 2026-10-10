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
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "7.0.0"),
    ],
    targets: [
        .target(
            name: "CriaKit",
            dependencies: [.product(name: "GRDB", package: "GRDB.swift")]
        ),
        .testTarget(name: "CriaKitTests", dependencies: ["CriaKit"]),
    ],
    swiftLanguageModes: [.v6]
)
