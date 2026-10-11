import XCTest
@testable import CriaKit

final class LocalPreferencesTests: XCTestCase {
    func testRoundTrip() {
        let codec = PreferencesCodec()
        let saved = LocalPreferences(colorScheme: .dark)
        XCTAssertEqual(codec.decode(codec.encode(saved)), saved)
    }

    func testMissingDataGivesDefaults() {
        XCTAssertEqual(PreferencesCodec().decode(nil), .default)
        XCTAssertEqual(PreferencesCodec().decode(Data("nonsense".utf8)), .default)
    }

    func testUnknownValueFallsBackPerField() {
        let json = #"{"version": 1, "values": {"colorScheme": "purple"}}"#
        XCTAssertEqual(PreferencesCodec().decode(Data(json.utf8)).colorScheme, .system)
    }

    func testNewerVersionIsIgnored() {
        let json = #"{"version": 9, "values": {"colorScheme": "dark"}}"#
        XCTAssertEqual(PreferencesCodec().decode(Data(json.utf8)), .default)
    }

    func testMigrationChainRunsInOrder() {
        let rename = PreferenceMigration(from: 1) { values in
            var next = values
            next["colorScheme"] = next.removeValue(forKey: "theme")
            return next
        }
        let flatten = PreferenceMigration(from: 2) { values in
            var next = values
            if case .string("night")? = next["colorScheme"] { next["colorScheme"] = .string("dark") }
            return next
        }
        let codec = PreferencesCodec(version: 3, migrations: [rename, flatten])
        let old = #"{"version": 1, "values": {"theme": "night"}}"#
        XCTAssertEqual(codec.decode(Data(old.utf8)).colorScheme, .dark)
    }

    func testMissingMigrationStepGivesDefaults() {
        let codec = PreferencesCodec(version: 3, migrations: [])
        let old = #"{"version": 1, "values": {"colorScheme": "dark"}}"#
        XCTAssertEqual(codec.decode(Data(old.utf8)), .default)
    }

    func testStorePersistsThroughUserDefaults() throws {
        let suite = "cria.test.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = PreferencesStore(defaults: defaults)
        XCTAssertEqual(store.load(), .default)
        store.save(LocalPreferences(colorScheme: .light))
        XCTAssertEqual(PreferencesStore(defaults: defaults).load().colorScheme, .light)
    }
}
