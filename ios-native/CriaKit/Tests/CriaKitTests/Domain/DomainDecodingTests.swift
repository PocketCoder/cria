import Foundation
import XCTest
@testable import CriaKit

/// Ported from `tests/unit/domain.test.ts`. Fixtures mirror the Vikunja API payloads.
final class DomainDecodingTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    private func assertThrows<T: Decodable>(_ type: T.Type, _ json: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try decode(type, json), file: file, line: line)
    }

    // MARK: task

    func testFullTaskResponseDecodes() throws {
        let task = try decode(TaskResponse.self, """
        {
          "id": 42, "project_id": 7, "title": "Buy milk", "description": "Need 2%",
          "done": true, "done_at": "2026-06-09T10:00:00Z", "due_date": "2026-06-10T00:00:00Z",
          "start_date": "2026-06-08T00:00:00Z", "end_date": "2026-06-11T00:00:00Z",
          "priority": 3, "percent_done": 0.5, "hex_color": "#ff0000", "position": 1,
          "updated": "2026-06-09T10:00:00Z", "created": "2026-06-01T00:00:00Z",
          "is_favorite": true, "repeat_after": 86400, "repeat_mode": 1, "identifier": "PROJ-42",
          "labels": [], "assignees": [], "attachments": [], "reminders": [], "related_tasks": {}
        }
        """)
        XCTAssertEqual(task.id, 42)
        XCTAssertEqual(task.projectId, 7)
        XCTAssertEqual(task.title, "Buy milk")
        XCTAssertEqual(task.done, true)
        XCTAssertEqual(task.isFavorite, true)
        XCTAssertEqual(task.percentDone, 0.5)
        XCTAssertEqual(task.repeatAfter, 86400)
    }

    func testMinimalTaskDecodes() throws {
        let task = try decode(TaskResponse.self, #"{"id": 1, "project_id": 2, "title": "x"}"#)
        XCTAssertNil(task.done)
        XCTAssertNil(task.dueDate)
        XCTAssertNil(task.relatedTasks)
    }

    func testNullOptionalsDecode() throws {
        let task = try decode(TaskResponse.self, """
        {"id": 1, "project_id": 2, "title": "x", "description": null, "due_date": null,
         "priority": null, "percent_done": null, "hex_color": null, "position": null,
         "is_favorite": null, "repeat_after": null, "repeat_mode": null}
        """)
        XCTAssertNil(task.description)
        XCTAssertNil(task.priority)
        XCTAssertNil(task.hexColor)
    }

    func testUnknownExtraFieldsAreIgnored() throws {
        let task = try decode(TaskResponse.self, #"{"id": 1, "project_id": 2, "title": "x", "brand_new": {"a": 1}}"#)
        XCTAssertEqual(task.id, 1)
    }

    func testTaskRejectsMissingIdOrTitleOrWrongType() {
        assertThrows(TaskResponse.self, #"{"project_id": 2, "title": "x"}"#)
        assertThrows(TaskResponse.self, #"{"id": 1, "project_id": 2}"#)
        assertThrows(TaskResponse.self, #"{"id": "1", "project_id": 2, "title": "x"}"#)
    }

    func testZeroDateSentinelDecodesToNil() throws {
        let task = try decode(TaskResponse.self, """
        {"id": 1, "project_id": 2, "title": "x", "done_at": "0001-01-01T00:00:00Z",
         "due_date": "0001-01-01T00:00:00Z", "created": "0001-01-01T00:00:00Z"}
        """)
        XCTAssertNil(task.doneAt)
        XCTAssertNil(task.dueDate)
        XCTAssertNil(task.created)
    }

    func testEmbeddedRelationsDecode() throws {
        let task = try decode(TaskResponse.self, """
        {"id": 1, "project_id": 2, "title": "x",
         "related_tasks": {"subtask": [{"id": 9, "title": "child", "done": false, "project_id": 2}]},
         "reminders": [{"reminder": "2026-06-10T09:00:00Z", "relative_period": -3600, "relative_to": "due_date"}],
         "attachments": [{"id": 5, "task_id": 1, "file": {"id": 8, "name": "a.pdf", "size": 1024, "mime": "application/pdf"}}],
         "comments": [{"id": 3, "comment": "hi", "reactions": {"👍": [{"id": 2, "username": "sam"}]}}]}
        """)
        XCTAssertEqual(task.relatedTasks?["subtask"]?.first?.id, 9)
        XCTAssertEqual(task.reminders?.first?.relativePeriod, -3600)
        XCTAssertEqual(task.attachments?.first?.file?.size, 1024)
        XCTAssertEqual(task.comments?.first?.reactions?["👍"]?.first?.username, "sam")
    }

    // MARK: normaliseDate

    func testNormaliseDate() {
        XCTAssertNil(normaliseDate(nil))
        XCTAssertNil(normaliseDate(""))
        XCTAssertNil(normaliseDate("0001-01-01T00:00:00Z"))
        XCTAssertEqual(normaliseDate("2026-06-10T00:00:00Z"), "2026-06-10T00:00:00Z")
    }

    // MARK: relations

    func testInverseRelationKinds() {
        let expected: [TaskRelationKind: TaskRelationKind] = [
            .subtask: .parenttask, .parenttask: .subtask, .related: .related,
            .duplicates: .duplicateof, .duplicateof: .duplicates, .blocking: .blocked,
            .blocked: .blocking, .precedes: .follows, .follows: .precedes,
            .copiedfrom: .copiedto, .copiedto: .copiedfrom,
        ]
        XCTAssertEqual(TaskRelationKind.allCases.count, 11)
        for kind in TaskRelationKind.allCases {
            XCTAssertEqual(kind.inverse, expected[kind], "\(kind)")
        }
    }

    // MARK: project, label

    func testProjectDecodes() throws {
        let project = try decode(ProjectResponse.self, """
        {"id": 3, "title": "Home", "description": "d", "identifier": "HOME", "parent_project_id": 1,
         "hex_color": "ff0000", "is_archived": false, "is_favorite": true, "position": 2, "updated": "2026-06-09T10:00:00Z"}
        """)
        XCTAssertEqual(project.parentProjectId, 1)
        XCTAssertEqual(project.isFavorite, true)
    }

    func testProjectMinimalAndRejects() throws {
        let project = try decode(ProjectResponse.self, #"{"id": 3, "title": "Home"}"#)
        XCTAssertNil(project.parentProjectId)
        assertThrows(ProjectResponse.self, #"{"title": "Home"}"#)
    }

    func testLabelDecodes() throws {
        let label = try decode(LabelResponse.self, #"{"id": 4, "title": "urgent", "hex_color": "00ff00"}"#)
        XCTAssertEqual(label.hexColor, "00ff00")
        assertThrows(LabelResponse.self, #"{"id": 4}"#)
    }

    // MARK: user, assignee

    func testUserSettingsFallbacks() throws {
        let bare = try decode(UserResponse.self, #"{"id": 1, "username": "jake"}"#)
        XCTAssertEqual(bare.resolvedLanguage, "en")
        XCTAssertEqual(bare.resolvedTimezone, "UTC")
        XCTAssertEqual(bare.resolvedWeekStart, 1)

        let full = try decode(UserResponse.self, """
        {"id": 1, "username": "jake", "settings": {
          "default_project_id": 7, "language": "de", "timezone": "Europe/Berlin", "week_start": 0
        }}
        """)
        XCTAssertEqual(full.settings?.defaultProjectId, 7)
        XCTAssertEqual(full.resolvedLanguage, "de")
        XCTAssertEqual(full.resolvedTimezone, "Europe/Berlin")
        XCTAssertEqual(full.resolvedWeekStart, 0)
    }

    func testAssigneeDecodes() throws {
        let assignee = try decode(AssigneeResponse.self, #"{"id": 2, "username": "sam"}"#)
        XCTAssertNil(assignee.email)
        assertThrows(AssigneeResponse.self, #"{"username": "sam"}"#)
    }

    // MARK: view, bucket, comment

    func testViewKindIsStrict() throws {
        let view = try decode(ViewResponse.self, """
        {"id": 1, "title": "Board", "project_id": 2, "view_kind": "kanban", "position": 1,
         "filter": "{\\"filter\\": \\"done = false\\", \\"filter_include_nulls\\": true}",
         "bucket_configuration_mode": "manual", "bucket_configuration": [], "default_bucket_id": 5, "done_bucket_id": 6}
        """)
        XCTAssertEqual(view.viewKind, .kanban)
        XCTAssertEqual(view.bucketConfigurationMode, .manual)
        XCTAssertEqual(view.defaultBucketId, 5)
        assertThrows(ViewResponse.self, #"{"id": 1, "title": "x", "project_id": 2, "view_kind": "calendar"}"#)
    }

    func testBucketDecodes() throws {
        let bucket = try decode(BucketResponse.self, #"{"id": 5, "title": "Doing", "project_view_id": 1, "limit": 3}"#)
        XCTAssertEqual(bucket.limit, 3)
        XCTAssertNil(bucket.createdById)
        assertThrows(BucketResponse.self, #"{"id": 5, "title": "Doing"}"#)
    }

    func testCommentDecodesWithNullBody() throws {
        let comment = try decode(CommentResponse.self, #"{"id": 3, "comment": null, "author": {"id": 1, "name": "Jake"}}"#)
        XCTAssertNil(comment.comment)
        XCTAssertEqual(comment.author?.name, "Jake")
    }

    // MARK: JSON values

    func testJSONValueDecodesNestedShapes() throws {
        let value = try decode(JSONValue.self, #"{"a": [1, "b", null, true]}"#)
        XCTAssertEqual(value, .object(["a": .array([.number(1), .string("b"), .null, .bool(true)])]))
    }
}
