import XCTest
@testable import CriaKit

final class NavigationStateTests: XCTestCase {
    func testPushGoesOnSelectedTab() {
        var state = NavigationState()
        state.push(.favorites)
        XCTAssertEqual(state.path(for: .today), [.favorites])
        XCTAssertEqual(state.path(for: .browse), [])
    }

    func testSwitchingTabsKeepsEachStack() {
        var state = NavigationState(selected: .browse)
        state.push(.project("p1"))
        state.push(.task("t1"))
        state.selected = .search
        state.push(.task("t2"))
        state.selected = .browse
        XCTAssertEqual(state.path(for: .browse), [.project("p1"), .task("t1")])
        XCTAssertEqual(state.path(for: .search), [.task("t2")])
    }

    func testOpenReplacesTheTargetStackAndSelectsIt() {
        var state = NavigationState()
        state.push(.inbox, on: .browse)
        state.open(.task("t9"), on: .browse)
        XCTAssertEqual(state.selected, .browse)
        XCTAssertEqual(state.path(for: .browse), [.task("t9")])
    }

    func testEmptyPathIsDropped() {
        var state = NavigationState()
        state.push(.inbox)
        state.setPath([], for: .today)
        XCTAssertEqual(state, NavigationState())
    }
}
