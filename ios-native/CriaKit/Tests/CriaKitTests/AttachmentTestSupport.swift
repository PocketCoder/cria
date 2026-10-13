import GRDB
import XCTest
@testable import CriaKit

let attachmentURL7 = "https://vik.example/api/v1/tasks/42/attachments/7"
let pendingImageHTML = ##"<p><img src="#" data-src="cria://pending/att1"></p>"##

func attachmentPayload(task: String = "task1", id: String = "att1") -> AttachmentUploadPayload {
    AttachmentUploadPayload(
        taskLocalId: task, attachmentLocalId: id, fileName: "photo.png", mime: "image/png", size: 3, bytesPath: id
    )
}

func uploadedFixture() throws -> TaskAttachmentResponse {
    try decodeFixture(TaskAttachmentResponse.self, """
    {"id": 7, "file": {"id": 70, "name": "photo.png", "size": 3, "mime": "image/png"}, "created": "2026-07-01T00:00:00Z"}
    """)
}

/// A server attachment to build a fixture from.
struct AttachmentSpec {
    let id: Int
    let name: String
    let created: String
}

func serverAttachmentsFixture(_ items: [AttachmentSpec]) throws -> [TaskAttachmentResponse] {
    try items.map { item in
        try decodeFixture(TaskAttachmentResponse.self, """
        {"id": \(item.id), "file": {"id": \(item.id * 10), "name": "\(item.name)", "size": 1024, "mime": "application/pdf"},
         "created": "\(item.created)"}
        """)
    }
}

/// Creates a project with `task1` (the given state) and a bare `task2`.
func seedAttachmentTasks(
    _ store: CriaStore, taskServerId: Int? = nil, description: String? = nil, dirty: Bool = false
) throws {
    let project = try seedProject(store)
    let now = isoNow()
    try runSQL(store, """
        INSERT INTO tasks (local_id, server_id, project_local_id, title, description, updated_at, dirty, deleted)
        VALUES ('task1', ?, ?, 'Task with att', ?, ?, ?, 0), ('task2', NULL, ?, 'Task no att', NULL, ?, 0, 0)
        """, [taskServerId, project, description, now, dirty, project, now])
}

func insertMirrorAttachment(
    _ store: CriaStore, _ localId: String, task: String = "task1", serverId: Int, name: String,
    created: String = "2026-01-01T00:00:00Z"
) throws {
    try runSQL(store, """
        INSERT INTO task_attachments (local_id, task_local_id, server_id, file_name, created_at) VALUES (?, ?, ?, ?, ?)
        """, [localId, task, serverId, name, created])
}

func insertTestComment(
    _ store: CriaStore, _ localId: String, serverId: Int, html: String, dirty: Bool = false, deleted: Bool = false
) throws {
    try runSQL(store, """
        INSERT INTO task_comments (local_id, server_id, task_local_id, comment, updated_at, dirty, deleted)
        VALUES (?, ?, 'task1', ?, ?, ?, ?)
        """, [localId, serverId, html, isoNow(), dirty, deleted])
}

func attachmentTaskState(_ store: CriaStore, _ localId: String) throws -> (description: String?, dirty: Bool) {
    let row = try store.database.writer.read { connection in
        try Row.fetchOne(connection, sql: "SELECT description, dirty FROM tasks WHERE local_id = ?", arguments: [localId])
    }
    let unwrapped = try XCTUnwrap(row)
    let description: String? = unwrapped["description"]
    let dirty: Bool = unwrapped["dirty"]
    return (description, dirty)
}

/// Finalises the standard `att1` upload against `task1` with the fixture server attachment.
func finaliseFixtureUpload(_ store: CriaStore) throws {
    try store.finaliseAttachmentUpload(
        attachmentLocalId: "att1", taskLocalId: "task1", uploaded: try uploadedFixture(), url: attachmentURL7
    )
}
