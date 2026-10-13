import XCTest
@testable import CriaKit

final class ForgetAccountTests: XCTestCase {
    func testForgetAccountClearsAccountValuesAndTemporaryFilesButKeepsPreferences() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "forget-\(UUID().uuidString)"))
        let shared = try XCTUnwrap(UserDefaults(suiteName: "forget-shared-\(UUID().uuidString)"))
        defaults.set(["7": "Sam"], forKey: "cria.userNames")
        defaults.set("Europe/London", forKey: "cria.timezone")
        defaults.set(["task-1"], forKey: "cria.manualProgress")
        defaults.set(Data([1]), forKey: PreferencesStore.key)
        RecentServers(defaults: defaults).remember(server: "https://vk.example", username: "ada")
        shared.set("project-1", forKey: "cria.captureProjectLocalId")
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("forget-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        try Data("zip".utf8).write(to: temporary.appendingPathComponent("vikunja-export.zip"))

        LocalDataWipe.forgetAccount(defaults: defaults, shared: shared, temporaryDirectory: temporary)

        XCTAssertNil(defaults.object(forKey: "cria.userNames"))
        XCTAssertNil(defaults.object(forKey: "cria.timezone"))
        XCTAssertNil(defaults.object(forKey: "cria.manualProgress"))
        XCTAssertNotNil(defaults.object(forKey: PreferencesStore.key), "device preferences stay")
        XCTAssertNil(shared.object(forKey: "cria.captureProjectLocalId"))
        XCTAssertEqual(RecentServers(defaults: defaults).servers(), ["https://vk.example"], "recent servers stay")
        XCTAssertNil(RecentServers(defaults: defaults).username(for: "https://vk.example"), "the remembered username goes")
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: temporary.path), [])
    }
}
