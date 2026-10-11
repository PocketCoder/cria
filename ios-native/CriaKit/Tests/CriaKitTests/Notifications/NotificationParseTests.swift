import XCTest
@testable import CriaKit

final class NotificationParseTests: XCTestCase {
    private func parse(_ name: String, _ json: String? = nil) throws -> ParsedNotification {
        let payload = try json.map { try decodeFixture(JSONValue.self, $0) }
        return NotificationParse.parse(name: name, payload: payload)
    }

    func testAssigned() throws {
        let result = try parse("task.assigned", #"{"doer": {"name": "Ann", "username": "ann"}, "task": {"id": 4, "title": "Ship"}}"#)
        XCTAssertEqual(result.text, "Ann assigned you to “Ship”")
        XCTAssertEqual(result.taskServerId, 4)
    }

    func testCommentAndMention() throws {
        let plain = try parse("task.comment", #"{"doer": {"username": "ann"}, "task": {"id": 1, "title": "T"}}"#)
        XCTAssertEqual(plain.text, "ann commented on “T”")
        let mentioned = try parse("task.comment", #"{"doer": {"username": "ann"}, "task": {"id": 1, "title": "T"}, "mentioned": true}"#)
        XCTAssertEqual(mentioned.text, "ann mentioned you in a comment on “T”")
        let direct = try parse("task.mentioned", #"{"doer": {"name": "Bo"}, "task": {"id": 2, "title": "U"}}"#)
        XCTAssertEqual(direct.text, "Bo mentioned you on “U”")
    }

    func testDeletedHasNoTask() throws {
        let result = try parse("task.deleted", #"{"doer": {"name": "Ann"}, "task": {"id": 4, "title": "Old"}}"#)
        XCTAssertEqual(result.text, "Ann deleted “Old”")
        XCTAssertNil(result.taskServerId)
    }

    func testReminderAndOverdue() throws {
        XCTAssertEqual(try parse("task.reminder", #"{"task": {"id": 3, "title": "Call"}}"#).text, "Reminder: “Call”")
        XCTAssertEqual(try parse("task.undone.overdue", #"{"task": {"id": 3, "title": "Call"}}"#).text, "“Call” is overdue")
        let many = try parse("task.undone.overdue", #"{"tasks": []}"#)
        XCTAssertEqual(many.text, "You have overdue tasks")
        XCTAssertNil(many.taskServerId)
    }

    func testTeamAndProject() throws {
        let team = try parse("team.member.added", #"{"doer": {"name": "Ann"}, "member": {"username": "bo"}, "team": {"name": "Crew"}}"#)
        XCTAssertEqual(team.text, "Ann added bo to team “Crew”")
        let project = try parse("project.created", #"{"doer": {"name": "Ann"}, "project": {"title": "Home"}}"#)
        XCTAssertEqual(project.text, "Ann created project “Home”")
        XCTAssertEqual(try parse("data.export.ready").text, "Your data export is ready to download")
    }

    func testFallbacks() throws {
        XCTAssertEqual(try parse("task.assigned").text, "Someone assigned you to “a task”")
        XCTAssertEqual(try parse("something.new").text, "something.new")
        XCTAssertNil(try parse("something.new").taskServerId)
    }

    func testNotificationListDecodesReadState() async throws {
        let json = """
        [{"id": 1, "name": "task.reminder", "notification": {"task": {"id": 3, "title": "A"}},
          "read_at": "0001-01-01T00:00:00Z", "created": "2026-06-01T10:00:00Z"},
         {"id": 2, "name": "data.export.ready", "read_at": "2026-06-02T10:00:00Z"}, {"name": "no id"}]
        """
        let transport = StubTransport { _, _ in (200, json, ["Content-Type": "application/json"]) }
        let client = ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
        let list = try await client.notifications()
        XCTAssertEqual(list.map(\.id), [1, 2])
        XCTAssertEqual(list.map(\.isRead), [false, true])
        XCTAssertEqual(list.first?.parsed.taskServerId, 3)
        XCTAssertEqual(transport.requests.first?.url?.query?.contains("per_page=50"), true)
    }

    func testMarkReadUsesPost() async throws {
        let transport = StubTransport { _, _ in (200, "{}", [:]) }
        let client = ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
        try await client.markNotificationRead(id: 9)
        try await client.markAllNotificationsRead()
        XCTAssertEqual(transport.requests.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" },
                       ["POST /api/v1/notifications/9", "POST /api/v1/notifications"])
    }
}
