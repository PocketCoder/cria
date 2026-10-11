import CriaKit
import SwiftUI

/// Comment thread for a task: add, edit and delete write through the store, which queues the server calls.
struct CommentsSection: View {
    let services: AppServices
    let taskLocalId: String
    @State private var live: LiveValue<[CommentRecord]>
    @State private var composing = false
    @State private var editing: CommentRecord?

    init(services: AppServices, taskLocalId: String) {
        self.services = services
        self.taskLocalId = taskLocalId
        let store = services.store
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.comments]) { reading in
                try reading.comments(forTask: taskLocalId)
            }
        })
    }

    var body: some View {
        Section("Comments") {
            ForEach(live.value, id: \.localId) { comment in
                row(comment)
            }
            Button("Add a comment", systemImage: "text.bubble") { composing = true }
        }
        .task { await live.run() }
        .sheet(isPresented: $composing) {
            CommentComposerSheet(
                services: services, taskLocalId: taskLocalId, title: "New comment", initialHTML: ""
            ) { html in
                _ = try? services.store.createComment(taskLocalId: taskLocalId, comment: html)
            }
        }
        .sheet(item: $editing) { comment in
            CommentComposerSheet(
                services: services, taskLocalId: taskLocalId, title: "Edit comment", initialHTML: comment.comment
            ) { html in
                try? services.store.updateComment(localId: comment.localId, comment: html)
            }
        }
    }

    private func row(_ comment: CommentRecord) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(comment.authorName ?? "You").font(.caption).foregroundStyle(.secondary)
            RichTextView(html: comment.comment).frame(minHeight: 28)
            reactionBar(comment)
        }
        .swipeActions {
            Button("Delete", role: .destructive) {
                try? services.store.deleteComment(localId: comment.localId)
            }
            Button("Edit") { editing = comment }
        }
    }

    private func reactionBar(_ comment: CommentRecord) -> some View {
        HStack {
            ForEach((comment.reactions ?? [:]).keys.sorted(), id: \.self) { emoji in
                let count = comment.reactions?[emoji]?.count ?? 0
                Button("\(emoji) \(count)") { react(comment, emoji) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
            Menu("React", systemImage: "face.smiling") {
                ForEach(Self.quickEmojis, id: \.self) { emoji in
                    Button(emoji) { react(comment, emoji) }
                }
            }
            .labelStyle(.iconOnly)
        }
    }

    private static let quickEmojis = ["👍", "❤️", "😂", "🎉", "👀", "🙏"]

    private func react(_ comment: CommentRecord, _ emoji: String) {
        let services = services
        Task { await services.toggleCommentReaction(commentLocalId: comment.localId, emoji: emoji) }
    }

}
