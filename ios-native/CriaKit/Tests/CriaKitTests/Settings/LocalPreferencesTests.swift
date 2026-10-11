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

final class LocalPreferencesFieldsTests: XCTestCase {
    func testDefaults() {
        let value = LocalPreferences.default
        XCTAssertEqual(value.dateFormat, .automatic)
        XCTAssertEqual(value.timeFormat, .h24)
        XCTAssertFalse(value.playSoundWhenDone)
        XCTAssertTrue(value.notificationsEnabled)
        XCTAssertEqual(value.morningSummaryTime, "08:00")
        XCTAssertEqual(value.weeklyRoundupTime, "09:00")
        XCTAssertNil(value.photoProjectId)
        XCTAssertEqual(value.photoLabel, "shopping")
    }

    func testAllFieldsRoundTrip() {
        let codec = PreferencesCodec()
        let saved = LocalPreferences(
            colorScheme: .dark, dateFormat: .european, timeFormat: .h12, playSoundWhenDone: true,
            notificationsEnabled: false, morningSummaryEnabled: false, morningSummaryTime: "06:45",
            weeklyRoundupEnabled: false, weeklyRoundupTime: "18:00", photoProjectId: "abc", photoLabel: ""
        )
        XCTAssertEqual(codec.decode(codec.encode(saved)), saved)
    }

    func testOlderBlobWithOnlyColourSchemeKeepsItAndDefaultsTheRest() {
        let json = #"{"version": 1, "values": {"colorScheme": "dark"}}"#
        let loaded = PreferencesCodec().decode(Data(json.utf8))
        XCTAssertEqual(loaded.colorScheme, .dark)
        XCTAssertEqual(loaded.dateFormat, .automatic)
        XCTAssertEqual(loaded.photoLabel, "shopping")
    }

    func testBadTimeAndFormatFallBackPerField() {
        let json = #"{"version": 1, "values": {"morningSummaryTime": "8am", "dateFormat": "bogus", "weeklyRoundupTime": "07:15"}}"#
        let loaded = PreferencesCodec().decode(Data(json.utf8))
        XCTAssertEqual(loaded.morningSummaryTime, "08:00")
        XCTAssertEqual(loaded.dateFormat, .automatic)
        XCTAssertEqual(loaded.weeklyRoundupTime, "07:15")
    }
}
