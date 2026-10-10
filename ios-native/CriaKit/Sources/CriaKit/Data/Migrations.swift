import Foundation
import GRDB

/// Forward-only schema migrations. The `.sql` files are copied verbatim from
/// `src/db/migrations/` and bundled as resources. Never edit a shipped file; add a new one.
public enum CriaMigrations {
    /// Applies every bundled migration in version order. Safe to call on an up-to-date database.
    public static func migrate(_ writer: any DatabaseWriter) throws {
        try migrator().migrate(writer)
    }

    static func migrator() throws -> DatabaseMigrator {
        var migrator = DatabaseMigrator()
        for source in try sources() {
            migrator.registerMigration(source.id) { database in
                try database.execute(sql: source.sql)
            }
        }
        return migrator
    }

    /// Bundled migration files sorted by their version prefix (`001_initial`, `002_...`).
    static func sources(in bundle: Bundle = .module) throws -> [MigrationSource] {
        let urls = bundle.urls(forResourcesWithExtension: "sql", subdirectory: "Migrations") ?? []
        return try urls
            .map { url in
                MigrationSource(
                    id: url.deletingPathExtension().lastPathComponent,
                    sql: try String(contentsOf: url, encoding: .utf8)
                )
            }
            .sorted { $0.id < $1.id }
    }
}

struct MigrationSource: Equatable {
    let id: String
    let sql: String
}
