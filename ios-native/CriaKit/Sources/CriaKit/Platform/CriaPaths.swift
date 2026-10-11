import Foundation

/// Where the app, the share extension, the widget and App Intents find the one database. It lives in the App Group
/// container from the start (S-00 decision), so no process needs a migration to see it.
public enum CriaPaths {
    public static let appGroup = "group.io.cria.app"
    public static let databaseName = "cria.sqlite"

    /// The App Group container when the build is signed with the group, else Application Support.
    public static func dataDirectory(fileManager: FileManager = .default) -> URL {
        if let group = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroup) {
            return group
        }
        let support = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        return (support ?? fileManager.temporaryDirectory).appendingPathComponent("Cria", isDirectory: true)
    }

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

    /// Opens the shared database for an extension or intent.
    public static func openDatabase() throws -> CriaDatabase {
        try CriaDatabase.open(at: databaseURL())
    }
}
