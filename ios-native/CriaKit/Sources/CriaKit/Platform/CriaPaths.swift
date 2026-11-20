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
        // so `Native` keeps clear of them. The widget extension finds the same folder (`macDataDirectory`).
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
        let support: URL
        if isAppExtension {
            // The widget extension is sandboxed: its Application Support is inside its own container. It reads the
            // app's folder through a temporary-exception entitlement (CriaWidgetsMac.entitlements), at the real path.
            guard let home = realHomeDirectory() else { return nil }
            support = home.appendingPathComponent("Library/Application Support", isDirectory: true)
        } else {
            guard let url = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
            support = url
        }
        let url = support
            .appendingPathComponent(hostBundleIdentifier, isDirectory: true)
            .appendingPathComponent("Native", isDirectory: true)
        try? fileManager.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private static var isAppExtension: Bool { Bundle.main.bundleURL.pathExtension == "appex" }

    /// The app's bundle id, also from inside its extension ("io.cria.app.nightly.widgets" -> "io.cria.app.nightly"),
    /// so the widget finds the database of the app flavour it shipped in.
    static var hostBundleIdentifier: String {
        let identifier = Bundle.main.bundleIdentifier ?? "io.cria.app.dev"
        guard isAppExtension, let dot = identifier.lastIndex(of: ".") else { return identifier }
        return String(identifier[..<dot])
    }

    /// The user's home folder, not the sandbox container `NSHomeDirectory()` gives a sandboxed process.
    private static func realHomeDirectory() -> URL? {
        guard let entry = getpwuid(getuid()), let directory = entry.pointee.pw_dir else { return nil }
        return URL(fileURLWithPath: String(cString: directory), isDirectory: true)
    }
    #endif

    public static func databaseURL(root: URL = dataDirectory()) -> URL {
        root.appendingPathComponent(databaseName)
    }

    public static func blobDirectory(root: URL = dataDirectory()) -> URL {
        root.appendingPathComponent("blobs", isDirectory: true)
    }

    /// Defaults shared between the app and its extensions. On macOS there is no group, so this is a plain preferences
    /// domain, which the sandboxed widget reads through a shared-preference exception.
    public static func sharedDefaults() -> UserDefaults {
        UserDefaults(suiteName: appGroup) ?? .standard
    }

    /// Opens the shared database for an extension or intent. It never migrates: only the app owns the schema.
    public static func openDatabase(readOnly: Bool = false) throws -> CriaDatabase {
        try CriaDatabase.open(at: databaseURL(), migrate: false, readOnly: readOnly)
    }
}
