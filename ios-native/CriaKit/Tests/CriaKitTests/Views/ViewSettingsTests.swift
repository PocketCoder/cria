import XCTest
@testable import CriaKit

final class ViewSettingsTests: XCTestCase {
    // MARK: Filter

    func testParseReadsTheStoredObjectAndABareString() {
        let object = ViewFilterParams.parse(#"{"filter":"done = false","filter_include_nulls":true}"#)
        XCTAssertEqual(object, ViewFilterParams(query: "done = false", includeNulls: true))
        XCTAssertEqual(ViewFilterParams.parse("priority >= 3"), ViewFilterParams(query: "priority >= 3", includeNulls: false))
    }

    func testParseTreatsBlankAndBrokenValuesAsNoFilter() {
        XCTAssertNil(ViewFilterParams.parse(nil))
        XCTAssertNil(ViewFilterParams.parse(""))
        XCTAssertNil(ViewFilterParams.parse("   "))
        XCTAssertNil(ViewFilterParams.parse(#"{"filter":"  "}"#))
        XCTAssertNil(ViewFilterParams.parse("{not json"))
    }

    func testSerializeKeepsKeysTheFormDoesNotShow() throws {
        let previous = #"{"filter":"old","filter_include_nulls":false,"filter_timezone":"Europe/London","s":"milk"}"#
        let text = try XCTUnwrap(ViewFilterParams.serialize(query: " done = false ", includeNulls: true, previousRaw: previous))
        let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        XCTAssertEqual(object["filter"] as? String, "done = false")
        XCTAssertEqual(object["filter_include_nulls"] as? Bool, true)
        XCTAssertEqual(object["filter_timezone"] as? String, "Europe/London")
        XCTAssertEqual(object["s"] as? String, "milk")
    }

    func testSerializeOfABlankQueryClears() {
        XCTAssertNil(ViewFilterParams.serialize(query: "  ", includeNulls: true, previousRaw: #"{"filter":"x"}"#))
    }

    func testValidateReportsParserErrors() {
        XCTAssertNil(ViewFilterParams.validate(""))
        XCTAssertNil(ViewFilterParams.validate("done = false && priority >= 3"))
        XCTAssertNotNil(ViewFilterParams.validate("done = "))
        XCTAssertNotNil(ViewFilterParams.validate("priority >= 3 &&"))
    }

    // MARK: Bucket configuration

    func testBucketConfigurationRoundTripsAndCarriesExtras() throws {
        let previous = #"[{"title":"Todo","filter":{"filter":"done = false","filter_include_nulls":false,"filter_timezone":"UTC"},"id":7}]"#
        var drafts = BucketConfiguration.parse(previous)
        XCTAssertEqual(drafts, [BucketFilterDraft(title: "Todo", filter: "done = false", includeNulls: false)])
        drafts[0].title = " Open "
        drafts[0].includeNulls = true
        drafts.append(BucketFilterDraft(title: "Done", filter: "done = true"))

        let text = BucketConfiguration.serialize(drafts, previousRaw: previous)
        let entries = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [[String: Any]])
        XCTAssertEqual(entries.count, 2)
        XCTAssertEqual(entries[0]["title"] as? String, "Open")
        XCTAssertEqual(entries[0]["id"] as? Int, 7)
        let first = try XCTUnwrap(entries[0]["filter"] as? [String: Any])
        XCTAssertEqual(first["filter_timezone"] as? String, "UTC")
        XCTAssertEqual(first["filter_include_nulls"] as? Bool, true)
        XCTAssertEqual((entries[1]["filter"] as? [String: Any])?["filter"] as? String, "done = true")
    }

    func testBucketValidation() {
        XCTAssertEqual(BucketConfiguration.validate([]), "Add at least one column.")
        XCTAssertEqual(BucketConfiguration.validate([BucketFilterDraft(title: " ")]), "Column 1 needs a title.")
        XCTAssertNotNil(BucketConfiguration.validate([BucketFilterDraft(title: "A", filter: "done = ")]))
        XCTAssertNil(BucketConfiguration.validate([BucketFilterDraft(title: "A"), BucketFilterDraft(title: "B", filter: "done = true")]))
    }

    // MARK: The push sends the whole view

    func testEditingFilterAndBucketsPushesAFullObject() throws {
        let store = try makeStore()
        let kanban = try seedKanban(store)
        let config = BucketConfiguration.serialize([BucketFilterDraft(title: "Hot", filter: "priority >= 4")], previousRaw: nil)
        let filter = ViewFilterParams.serialize(query: "done = false", includeNulls: true, previousRaw: nil)
        try store.updateView(localId: kanban.view, ViewUpdate(
            filter: .some(filter), bucketConfigurationMode: .filter, bucketConfiguration: .some(config)
        ))
        // A later rename must still send the filter and the buckets.
        let renamed = try store.updateView(localId: kanban.view, ViewUpdate(title: "Priorities"))

        let body = ViewExecutor().body(renamed)
        XCTAssertEqual(body["title"], .string("Priorities"))
        XCTAssertEqual(body["view_kind"], .string("kanban"))
        XCTAssertEqual(body["bucket_configuration_mode"], .string("filter"))
        XCTAssertEqual(body["filter"]?["filter"], .string("done = false"))
        XCTAssertEqual(body["filter"]?["filter_include_nulls"], .bool(true))
        guard case .array(let buckets)? = body["bucket_configuration"] else { return XCTFail("no bucket configuration") }
        XCTAssertEqual(buckets.count, 1)
        XCTAssertNotNil(body["done_bucket_id"])
        XCTAssertNotNil(body["default_bucket_id"])
    }

    func testSwitchingBackToManualKeepsTheStoredColumns() throws {
        let store = try makeStore()
        let kanban = try seedKanban(store)
        let config = BucketConfiguration.serialize([BucketFilterDraft(title: "Hot", filter: "")], previousRaw: nil)
        try store.updateView(localId: kanban.view, ViewUpdate(bucketConfigurationMode: .filter, bucketConfiguration: .some(config)))
        let manual = try store.updateView(localId: kanban.view, ViewUpdate(bucketConfigurationMode: .manual))
        XCTAssertEqual(manual.bucketConfigurationMode, .manual)
        XCTAssertEqual(BucketConfiguration.parse(manual.bucketConfiguration).map(\.title), ["Hot"])
        XCTAssertNotNil(ViewExecutor().body(manual)["bucket_configuration"])
    }

    // MARK: Remembered view

    func testProjectViewMemoryFallsBackToTheFirstView() throws {
        let store = try makeStore()
        let project = try seedSyncedViews(store)
        let views = try store.views(forProject: project)
        let table = try XCTUnwrap(views.first { $0.viewKind == .table })
        XCTAssertEqual(ProjectViewMemory.choose(remembered: table.localId, among: views)?.localId, table.localId)
        XCTAssertEqual(ProjectViewMemory.choose(remembered: "gone", among: views)?.localId, views.first?.localId)
        XCTAssertEqual(ProjectViewMemory.choose(remembered: nil, among: views)?.localId, views.first?.localId)
        XCTAssertNil(ProjectViewMemory.choose(remembered: "x", among: []))
    }

    func testProjectViewMemoryStoresPerProject() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "cria.test.viewMemory.\(UUID().uuidString)"))
        ProjectViewMemory.remember("v1", projectLocalId: "p1", defaults: defaults)
        ProjectViewMemory.remember("v2", projectLocalId: "p2", defaults: defaults)
        XCTAssertEqual(ProjectViewMemory.remembered(projectLocalId: "p1", defaults: defaults), "v1")
        XCTAssertEqual(ProjectViewMemory.remembered(projectLocalId: "p2", defaults: defaults), "v2")
        XCTAssertNil(ProjectViewMemory.remembered(projectLocalId: "p3", defaults: defaults))
    }
}
