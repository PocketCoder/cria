import Foundation

/// Where the app, the share extension, the widget and App Intents find the one database. It lives in the App Group
/// container from the start (S-00 decision), so no process needs a migration to see it.
public enum CriaPaths {
    public static let appGroup = "group.io.cria.app"
    public static let databaseName = "cria.sqlite"

    /// The App Group container when the build is signed with the group, else Application Support.
    public static func dataDirectory(fileManager: FileManager = .default) -> URL {
        #if os(macOS)
        // No app group on macOS (self-signed builds cannot get one). The Tauri app's files sit in the parent folder,
        // so `Native` keeps clear of them.
        if let url = macDataDirectory(fileManager: fileManager) { return url }
        #endif
        if let group = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroup) {
            return group
        }
        let support = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        return (support ?? fileManager.temporaryDirectory).appendingPathComponent("Cria", isDirectory: true)
    }

    #if os(macOS)
    private static func macDataDirectory(fileManager: FileManager) -> URL? {
        guard let support = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let url = support
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "io.cria.app.dev", isDirectory: true)
            .appendingPathComponent("Native", isDirectory: true)
        try? fileManager.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
    #endif

    public static func databaseURL(root: URL = dataDirectory()) -> URL {
        root.appendingPathComponent(databaseName)
    }

    public static func blobDirectory(root: URL = dataDirectory()) -> URL {
        root.appendingPathComponent("blobs", isDirectory: true)
    }

    /// Defaults shared between the app and its extensions.
    public static func sharedDefaults() -> UserDefaults {
        UserDefaults(suiteName: appGroup) ?? .standard
    }

    /// Opens the shared database for an extension or intent. It never migrates: only the app owns the schema.
    public static func openDatabase(readOnly: Bool = false) throws -> CriaDatabase {
        try CriaDatabase.open(at: databaseURL(), migrate: false, readOnly: readOnly)
    }
}
