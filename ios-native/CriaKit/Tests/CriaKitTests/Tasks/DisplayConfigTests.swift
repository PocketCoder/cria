import XCTest
@testable import CriaKit

final class DisplayConfigTests: XCTestCase {
    private func freshDefaults() throws -> UserDefaults {
        let suite = "cria.tests.display.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        addTeardownBlock { defaults.removePersistentDomain(forName: suite) }
        return defaults
    }

    func testDefaultsPerView() {
        XCTAssertEqual(DisplayConfig.defaults(for: .project("p1")).sort, .manual)
        XCTAssertEqual(DisplayConfig.defaults(for: .project("p1")).groupBy, .none)
        XCTAssertEqual(DisplayConfig.defaults(for: .favorites).groupBy, .project)
        XCTAssertEqual(DisplayConfig.defaults(for: .label("l1")).groupBy, .project)
        XCTAssertEqual(DisplayConfig.defaults(for: .today), DisplayConfig())
        XCTAssertEqual(DisplayConfig().sort, .smart)
        XCTAssertNil(DisplayConfig().showCompleted)
    }

    func testKeyKinds() {
        XCTAssertEqual(DisplayViewKey.project("abc").kind, .project)
        XCTAssertEqual(DisplayViewKey.label("abc").kind, .label)
        XCTAssertEqual(DisplayViewKey.savedFilter(serverId: 4).kind, .savedFilter)
        XCTAssertEqual(DisplayViewKey.savedFilter(serverId: 4).rawValue, "filter:4")
        XCTAssertEqual(DisplayViewKey.today.kind, .today)
        XCTAssertEqual(DisplayViewKey.smartView(.upcoming), .upcoming)
        XCTAssertEqual(DisplayViewKey.smartView(.inbox(defaultProjectServerId: 3)), .inbox)
        XCTAssertEqual(DisplayViewKey.taskList(.favorites), .favorites)
        XCTAssertEqual(DisplayViewKey.taskList(.project("p")), .project("p"))
    }

    func testSortOptionsKeepTheOldOnesAndAddSmart() {
        XCTAssertEqual(DisplaySort.options.count, TaskSort.options.count + 1)
        XCTAssertEqual(DisplaySort.options.first, .smart)
        XCTAssertEqual(DisplaySort.options[1], .manual)
        XCTAssertEqual(Set(DisplaySort.options).count, DisplaySort.options.count)
        XCTAssertEqual(DisplaySort.smart.title, "Smart")
        XCTAssertEqual(DisplaySort.manual.title, "Manually")
        XCTAssertEqual(DisplaySort(field: .endDate).title, "End date (Earliest first)")
        XCTAssertEqual(DisplaySort(field: .created, descending: true).title, "Created (Newest first)")
        XCTAssertEqual(DisplaySort(field: .title).title, "Title (A\u{2013}Z)")
        XCTAssertNil(DisplaySort.smart.rule)
        XCTAssertEqual(DisplaySort(field: .priority, descending: true).rule, SortRule(field: .priority, direction: .desc))
        XCTAssertTrue(DisplaySort.manual.isManual)
        XCTAssertFalse(DisplaySort(field: .manual, descending: true).isManual)
    }

    func testSectionsPerView() {
        XCTAssertTrue(DisplaySections(for: .today).groupings.isEmpty)
        XCTAssertFalse(DisplaySections(for: .today).dueDate)
        XCTAssertFalse(DisplaySections(for: .upcoming).dueDate)
        XCTAssertFalse(DisplaySections(for: .project("p")).project)
        XCTAssertFalse(DisplaySections(for: .project("p")).groupings.contains(.project))
        XCTAssertTrue(DisplaySections(for: .label("l")).groupings.contains(.project))
        XCTAssertFalse(DisplaySections(for: .savedFilter(serverId: 1)).completed)
        XCTAssertTrue(DisplaySections(for: .inbox).completed)
    }

    func testCodableRoundTrip() throws {
        var config = DisplayConfig(showCompleted: true, groupBy: .label, sort: DisplaySort(field: .endDate, descending: true))
        config.filters.priorities = [3, 4]
        config.filters.dueDate = .week
        config.filters.deadline = .none
        config.filters.labelIds = ["a"]
        config.filters.projectIds = ["b"]
        config.filters.assignee = .assignedToMe
        let decoded = try JSONDecoder().decode(DisplayConfig.self, from: JSONEncoder().encode(config))
        XCTAssertEqual(decoded, config)
    }

    func testDecodingToleratesMissingKeys() throws {
        let empty = try JSONDecoder().decode(DisplayConfig.self, from: Data("{}".utf8))
        XCTAssertEqual(empty, DisplayConfig())
        let partial = try JSONDecoder().decode(DisplayConfig.self, from: Data(#"{"groupBy":"priority","filters":{"assignee":"me"}}"#.utf8))
        XCTAssertEqual(partial.groupBy, .priority)
        XCTAssertEqual(partial.filters.assignee, .assignedToMe)
        XCTAssertEqual(partial.sort, .smart)
    }

    func testFiltersActive() {
        var filters = DisplayFilters()
        XCTAssertFalse(filters.isActive)
        filters.priorities = [1]
        XCTAssertTrue(filters.isActive)
    }

    func testStoreRemembersEachViewSeparately() throws {
        let defaults = try freshDefaults()
        XCTAssertEqual(DisplayConfigStore.load(.today, defaults: defaults), DisplayConfig())
        var today = DisplayConfig()
        today.filters.priorities = [4]
        DisplayConfigStore.save(today, for: .today, defaults: defaults)
        var project = DisplayConfig.defaults(for: .project("p1"))
        project.sort = DisplaySort(field: .title)
        DisplayConfigStore.save(project, for: .project("p1"), defaults: defaults)

        XCTAssertEqual(DisplayConfigStore.load(.today, defaults: defaults), today)
        XCTAssertEqual(DisplayConfigStore.load(.project("p1"), defaults: defaults), project)
        XCTAssertEqual(DisplayConfigStore.load(.upcoming, defaults: defaults), DisplayConfig())
        XCTAssertEqual(DisplayConfigStore.load(.project("p2"), defaults: defaults).sort, .manual)
    }

    func testSavingTheDefaultsClearsTheEntry() throws {
        let defaults = try freshDefaults()
        var config = DisplayConfig()
        config.groupBy = .priority
        DisplayConfigStore.save(config, for: .inbox, defaults: defaults)
        XCTAssertNotNil(defaults.data(forKey: DisplayConfigStore.defaultsKey))
        DisplayConfigStore.reset(.inbox, defaults: defaults)
        XCTAssertNil(defaults.data(forKey: DisplayConfigStore.defaultsKey))
        XCTAssertEqual(DisplayConfigStore.load(.inbox, defaults: defaults), DisplayConfig())
    }

    func testUnreadableDataFallsBackToDefaults() throws {
        let defaults = try freshDefaults()
        defaults.set(Data("not json".utf8), forKey: DisplayConfigStore.defaultsKey)
        XCTAssertEqual(DisplayConfigStore.load(.today, defaults: defaults), DisplayConfig())
    }

    func testIsCustomised() {
        XCTAssertFalse(DisplayConfig.defaults(for: .project("p")).isCustomised(for: .project("p")))
        XCTAssertTrue(DisplayConfig(sort: .smart).isCustomised(for: .project("p")))
    }
}
