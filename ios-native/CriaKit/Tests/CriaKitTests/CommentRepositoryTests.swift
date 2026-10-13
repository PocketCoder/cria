import GRDB
import XCTest
@testable import CriaKit

final class CommentRepositoryTests: XCTestCase {
    private func comment(_ id: Int, _ text: String, extra: String = "") throws -> CommentResponse {
        let json = """
        {"id": \(id), "comment": "\(text)", "author": {"id": 1, "username": "u"},
         "created": "2026-01-01T00:00:00Z", "updated": "2026-01-01T00:00:00Z"\(extra)}
        """
        return try decodeFixture(CommentResponse.self, json)
    }

    /// A project plus one synced task, returning the task's local id.
    private func seedTask(_ store: CriaStore) throws -> String {
        try seedProject(store)
        return try seedSyncedTask(store, serverId: 10, title: "T")
    }

    // MARK: Sync

    func testSyncInsertsUpdatesAndRemovesVanishedCleanRows() throws {
        let store = try makeStore()
        let task = try seedTask(store)
        try store.replaceTaskCommentsFromServer(taskLocalId: task, [try comment(1, "a"), try comment(2, "b")])
        try store.replaceTaskCommentsFromServer(taskLocalId: task, [try comment(2, "b2")])

        let rows = try store.comments(forTask: task)
        XCTAssertEqual(rows.map(\.serverId), [2])
        XCTAssertEqual(rows.map(\.comment), ["b2"])
        XCTAssertEqual(rows.first?.authorName, "u")
        XCTAssertEqual(try outboxEntries(store, entity: "task_comment").count, 0)
    }

    func testSyncKeepsTheLocalReadFlag() throws {
        let store = try makeStore()
        let task = try seedTask(store)
        try store.replaceTaskCommentsFromServer(taskLocalId: task, [try comment(1, "a")])
        XCTAssertEqual(try store.unreadCommentCount(forTask: task), 1)
        try store.markCommentsAsRead(taskLocalId: task)
        try store.replaceTaskCommentsFromServer(taskLocalId: task, [try comment(1, "a edited")])

        let row = try XCTUnwrap(try store.comments(forTask: task).first)
        XCTAssertEqual(row.comment, "a edited")
        XCTAssertTrue(row.read)
        XCTAssertEqual(try store.unreadCommentCount(forTask: task), 0)
    }

    func testSyncNeverOverwritesOrDeletesADirtyLocalEdit() throws {
        let store = try makeStore()
        let task = try seedTask(store)
        try store.replaceTaskCommentsFromServer(taskLocalId: task, [try comment(1, "a")])
        let local = try XCTUnwrap(try store.comments(forTask: task).first)
        try store.updateComment(localId: local.localId, comment: "my edit")

        try store.replaceTaskCommentsFromServer(taskLocalId: task, [])
        try store.replaceTaskCommentsFromServer(taskLocalId: task, [try comment(1, "server says")])

        let row = try XCTUnwrap(try store.comment(localId: local.localId))
        XCTAssertEqual(row.comment, "my edit")
        XCTAssertTrue(row.dirty)
    }

    func testSyncKeepsAPendingLocalDeleteDeleted() throws {
        let store = try makeStore()
        let task = try seedTask(store)
        try store.replaceTaskCommentsFromServer(taskLocalId: task, [try comment(1, "a")])
        let local = try XCTUnwrap(try store.comments(forTask: task).first)
        try store.deleteComment(localId: local.localId)

        try store.replaceTaskCommentsFromServer(taskLocalId: task, [try comment(1, "a")])

        XCTAssertEqual(try store.comments(forTask: task).count, 0)
        let row = try XCTUnwrap(try store.comment(localId: local.localId))
        XCTAssertTrue(row.deleted)
        XCTAssertTrue(row.dirty)
    }

    func testSyncDoesNothingWhileTheTaskHasAPendingEdit() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Local", projectLocalId: project))
        try store.replaceTaskCommentsFromServer(taskLocalId: task.localId, [try comment(1, "a")])
        XCTAssertEqual(try store.comments(forTask: task.localId).count, 0)
    }

    func testSyncSkipsEmptyComments() throws {
        let store = try makeStore()
        let task = try seedTask(store)
        let empty = try decodeFixture(CommentResponse.self, #"{"id": 3, "comment": ""}"#)
        let missing = try decodeFixture(CommentResponse.self, #"{"id": 4}"#)
        try store.replaceTaskCommentsFromServer(taskLocalId: task, [empty, missing])
        XCTAssertEqual(try store.comments(forTask: task).count, 0)
    }

    func testSyncStoresReactions() throws {
        let store = try makeStore()
        let task = try seedTask(store)
        let reactions = #", "reactions": {"👍": [{"id": 1, "username": "u"}, {"id": 2, "name": "Bo"}]}"#
        try store.replaceTaskCommentsFromServer(taskLocalId: task, [try comment(1, "a", extra: reactions)])

        let stored = try XCTUnwrap(try store.comments(forTask: task).first?.reactions)
        XCTAssertEqual(stored["👍"]?.map(\.id), [1, 2])
        XCTAssertEqual(stored["👍"]?.last?.name, "Bo")
    }

    // MARK: User mutations

    func testCreateCommentInsertsLocalRowAndQueuesCreate() throws {
        let store = try makeStore()
        let task = try seedTask(store)

        let localId = try store.createComment(taskLocalId: task, comment: "hello", authorName: "Jake", authorServerId: 7)

        let row = try XCTUnwrap(try store.comment(localId: localId))
        XCTAssertEqual(row.serverId, 0)
        XCTAssertEqual(row.comment, "hello")
        XCTAssertEqual(row.authorName, "Jake")
        XCTAssertEqual(row.authorServerId, 7)
        XCTAssertTrue(row.dirty)
        XCTAssertTrue(row.read)
        let entries = try outboxEntries(store, entity: "task_comment")
        XCTAssertEqual(entries.map(\.localId), [localId])
        XCTAssertEqual(entries.map(\.operation), ["create"])
    }

    func testUpdateAndDeleteQueueOpsAndDeleteIsSoft() throws {
        let store = try makeStore()
        let task = try seedTask(store)
        let localId = try store.createComment(taskLocalId: task, comment: "oops")

        try store.updateComment(localId: localId, comment: "better")
        XCTAssertEqual(try store.comments(forTask: task).map(\.comment), ["better"])

        try store.deleteComment(localId: localId)
        XCTAssertEqual(try store.comments(forTask: task).count, 0)
        XCTAssertEqual(try store.comment(localId: localId)?.deleted, true)
        XCTAssertEqual(try outboxEntries(store, entity: "task_comment").map(\.operation), ["create", "update", "delete"])
    }

    func testUpdateDoesNotTouchADeletedComment() throws {
        let store = try makeStore()
        let task = try seedTask(store)
        let localId = try store.createComment(taskLocalId: task, comment: "gone")
        try store.deleteComment(localId: localId)
        try store.updateComment(localId: localId, comment: "revived?")
        XCTAssertEqual(try store.comment(localId: localId)?.comment, "gone")
    }

    func testCommentWritesAnnounceButSyncDoesNot() async throws {
        let store = try makeStore()
        let stream = store.bus.subscribe()
        var iterator = stream.makeAsyncIterator()
        let task = try seedTask(store)
        try store.replaceTaskCommentsFromServer(taskLocalId: task, [try comment(1, "a")])
        try store.createComment(taskLocalId: task, comment: "mine")
        let first = await iterator.next()
        XCTAssertEqual(first, .comments)
    }

    // MARK: Reactions

    func testToggleReactionAddsThenRemoves() throws {
        let store = try makeStore()
        let task = try seedTask(store)
        try store.replaceTaskCommentsFromServer(taskLocalId: task, [try comment(1, "a")])
        let local = try XCTUnwrap(try store.comments(forTask: task).first).localId
        let user = ReactionUserRecord(id: 5, name: "Jake", username: "jake")

        XCTAssertEqual(try store.toggleCommentReaction(commentLocalId: local, emoji: "🎉", user: user), true)
        let added = try XCTUnwrap(try store.comment(localId: local)?.reactions)
        XCTAssertEqual(added["🎉"], [user])

        XCTAssertEqual(try store.toggleCommentReaction(commentLocalId: local, emoji: "🎉", user: user), false)
        XCTAssertEqual(try store.comment(localId: local)?.reactions, [:])
    }

    func testToggleReactionKeepsOtherUsersAndEmoji() throws {
        let store = try makeStore()
        let task = try seedTask(store)
        let reactions = #", "reactions": {"👍": [{"id": 1, "username": "u"}], "❤️": [{"id": 2, "username": "v"}]}"#
        try store.replaceTaskCommentsFromServer(taskLocalId: task, [try comment(1, "a", extra: reactions)])
        let local = try XCTUnwrap(try store.comments(forTask: task).first).localId

        try store.toggleCommentReaction(commentLocalId: local, emoji: "👍", user: ReactionUserRecord(id: 5))

        let stored = try XCTUnwrap(try store.comment(localId: local)?.reactions)
        XCTAssertEqual(stored["👍"]?.map(\.id), [1, 5])
        XCTAssertEqual(stored["❤️"]?.map(\.id), [2])
    }

    func testToggleReactionIsANoOpForUnknownOrDeletedCommentsAndAnonymousUsers() throws {
        let store = try makeStore()
        let task = try seedTask(store)
        let local = try store.createComment(taskLocalId: task, comment: "a")
        let user = ReactionUserRecord(id: 5)

        XCTAssertNil(try store.toggleCommentReaction(commentLocalId: "missing", emoji: "👍", user: user))
        XCTAssertNil(try store.toggleCommentReaction(commentLocalId: local, emoji: "👍", user: ReactionUserRecord(id: nil)))
        try store.deleteComment(localId: local)
        XCTAssertNil(try store.toggleCommentReaction(commentLocalId: local, emoji: "👍", user: user))
        XCTAssertNil(try store.comment(localId: local)?.reactions)
    }
}
