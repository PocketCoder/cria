import GRDB
import XCTest
@testable import CriaKit

final class TaskBodyTests: XCTestCase {
    private func record(_ patch: (inout TaskRecord) -> Void = { _ in }) throws -> TaskRecord {
        let store = try makeStore()
        try seedProject(store)
        let project = try XCTUnwrap(try store.projects().first).localId
        var task = try store.createTask(TaskInput(title: "A task", projectLocalId: project))
        patch(&task)
        return task
    }

    private func number(_ body: JSONBody, _ key: String) -> Double? {
        if case .number(let value) = body[key] { return value }
        return nil
    }

    private func string(_ body: JSONBody, _ key: String) -> String? {
        if case .string(let value) = body[key] { return value }
        return nil
    }

    func testStripsLeadingHashFromHexColor() throws {
        XCTAssertEqual(string(taskToBody(try record { $0.hexColor = "#ff0000" }), "hex_color"), "ff0000")
        XCTAssertEqual(string(taskToBody(try record { $0.hexColor = "aabbcc" }), "hex_color"), "aabbcc")
    }

    func testOmitsHexColorWhenNilOrEmpty() throws {
        XCTAssertNil(taskToBody(try record { $0.hexColor = nil })["hex_color"])
        XCTAssertNil(taskToBody(try record { $0.hexColor = "" })["hex_color"])
    }

    func testSendsPercentDoneUnscaled() throws {
        XCTAssertEqual(number(taskToBody(try record { $0.percentDone = 0.5 }), "percent_done"), 0.5)
        XCTAssertEqual(number(taskToBody(try record { $0.percentDone = 0.33 }), "percent_done"), 0.33)
        XCTAssertEqual(number(taskToBody(try record { $0.percentDone = 1 }), "percent_done"), 1)
    }

    func testSendsFavouriteExplicitlyBothWays() throws {
        XCTAssertEqual(taskToBody(try record { $0.isFavorite = false })["is_favorite"], .bool(false))
        XCTAssertEqual(taskToBody(try record { $0.isFavorite = true })["is_favorite"], .bool(true))
    }

    func testSendsRepeatFieldsExplicitlyEvenWhenZero() throws {
        let body = taskToBody(try record())
        XCTAssertEqual(number(body, "repeat_after"), 0)
        XCTAssertEqual(number(body, "repeat_mode"), 0)
    }

    func testProjectIdOnlyOnMove() throws {
        XCTAssertNil(taskToBody(try record())["project_id"])
        XCTAssertEqual(number(taskToBody(try record(), projectServerId: 42), "project_id"), 42)
    }

    func testDoneIsBoolAndDescriptionOmittedWhenNil() throws {
        XCTAssertEqual(taskToBody(try record { $0.done = true })["done"], .bool(true))
        XCTAssertNil(taskToBody(try record { $0.description = nil })["description"])
        XCTAssertEqual(string(taskToBody(try record { $0.description = "<p>hello</p>" }), "description"), "<p>hello</p>")
    }

    func testDateFields() throws {
        let utc = TimeZone(identifier: "UTC")!
        XCTAssertNil(taskToBody(try record { $0.dueDate = nil }, timeZone: utc)["due_date"])
        let full = "2026-06-09T12:00:00+01:00"
        XCTAssertEqual(string(taskToBody(try record { $0.dueDate = full }, timeZone: utc), "due_date"), full)
        XCTAssertEqual(string(taskToBody(try record { $0.dueDate = "2026-06-09" }, timeZone: utc), "due_date"), "2026-06-09T00:00:00+00:00")
        let london = TimeZone(identifier: "Europe/London")!
        let start = taskToBody(try record { $0.startDate = "2026-07-04" }, timeZone: london)
        XCTAssertEqual(string(start, "start_date"), "2026-07-04T00:00:00+01:00")
        let end = taskToBody(try record { $0.endDate = "2026-01-15" }, timeZone: london)
        XCTAssertEqual(string(end, "end_date"), "2026-01-15T00:00:00+00:00")
        XCTAssertNil(taskToBody(try record(), timeZone: utc)["start_date"])
    }

    func testRemindersSentWhenProvidedIncludingEmpty() throws {
        XCTAssertNil(taskToBody(try record())["reminders"])
        XCTAssertEqual(taskToBody(try record(), reminders: [])["reminders"], .array([]))
        let body = taskToBody(try record(), reminders: [ReminderBody(reminder: "2026-06-10T09:00:00Z"),
                                                       ReminderBody(relativePeriod: -3600, relativeTo: "due_date")])
        XCTAssertEqual(body["reminders"], .array([
            .object(["reminder": .string("2026-06-10T09:00:00Z")]),
            .object(["relative_period": .number(-3600), "relative_to": .string("due_date")])
        ]))
    }
}
