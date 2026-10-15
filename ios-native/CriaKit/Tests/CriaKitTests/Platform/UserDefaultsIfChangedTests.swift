import XCTest
@testable import CriaKit

final class UserDefaultsIfChangedTests: XCTestCase {
    private var defaults: UserDefaults!
    private var observed = 0
    private var token: NSObjectProtocol?

    override func setUp() {
        defaults = UserDefaults(suiteName: "UserDefaultsIfChangedTests")
        defaults.removePersistentDomain(forName: "UserDefaultsIfChangedTests")
        observed = 0
        token = NotificationCenter.default.addObserver(
            forName: UserDefaults.didChangeNotification, object: defaults, queue: nil
        ) { [unowned self] _ in observed += 1 }
    }

    override func tearDown() {
        if let token { NotificationCenter.default.removeObserver(token) }
        defaults.removePersistentDomain(forName: "UserDefaultsIfChangedTests")
    }

    func testUnchangedStringPostsNothing() {
        defaults.setIfChanged("a", forKey: "k")
        let after = observed
        defaults.setIfChanged("a", forKey: "k")
        XCTAssertEqual(observed, after)
        defaults.setIfChanged("b", forKey: "k")
        XCTAssertGreaterThan(observed, after)
        XCTAssertEqual(defaults.string(forKey: "k"), "b")
    }

    func testIntAndBoolStoreAndSkipRepeats() {
        defaults.setIfChanged(3, forKey: "i")
        defaults.setIfChanged(true, forKey: "b")
        let after = observed
        defaults.setIfChanged(3, forKey: "i")
        defaults.setIfChanged(true, forKey: "b")
        XCTAssertEqual(observed, after)
        XCTAssertEqual(defaults.integer(forKey: "i"), 3)
        XCTAssertTrue(defaults.bool(forKey: "b"))
    }
}
