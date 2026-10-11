import CriaKit
import SwiftUI

/// Comment thread for a task: add, edit and delete write through the store, which queues the server calls.
struct CommentsSection: View {
    let services: AppServices
    let taskLocalId: String
    @State private var live: LiveValue<[CommentRecord]>
    @State private var composing = false
    @State private var editing: CommentRecord?
    @State private var summary: String?
    @State private var summarising = false
    @State private var failure: String?

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
            // Observers, sheets and the alert hang off this one row, not the Section: modifiers on a Section inside a
            // Form can be applied once per row, which would start the observer and present each sheet repeatedly.
            addButton
            summarySection
        }
    }

    private var addButton: some View {
        Button { composing = true } label: {
            Label("Add a comment", systemImage: "bubble.left").foregroundStyle(Color(.mutedForeground))
        }
            .task { await live.run() }
            .task { await AIStatus.shared.refresh() }
            .sheet(isPresented: $composing) {
                CommentComposerSheet(
                    services: services, taskLocalId: taskLocalId, title: "New comment", initialHTML: ""
                ) { html in
                    attempt { _ = try services.store.createComment(taskLocalId: taskLocalId, comment: html) }
                }
            }
            .sheet(item: $editing) { comment in
                CommentComposerSheet(
                    services: services, taskLocalId: taskLocalId, title: "Edit comment", initialHTML: comment.comment
                ) { html in
                    attempt { try services.store.updateComment(localId: comment.localId, comment: html) }
                }
            }
            .alert("Could not save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(failure ?? "")
            }
    }

    private func attempt(_ work: () throws -> Void) {
        do {
            try work()
        } catch {
            failure = String(describing: error)
        }
    }

    @ViewBuilder
    private var summarySection: some View {
        if AIStatus.shared.isOfferable && live.value.count >= 2 {
            Button(summarising ? "Summarising…" : "Summarise thread", systemImage: "sparkles") {
                Task { await summarise() }
            }
            .disabled(summarising || AIStatus.shared.notReadyMessage != nil)
            if let summary {
                Text(summary).font(Theme.rowTitle).textSelection(.enabled)
            }
        }
    }

    private func summarise() async {
        summarising = true
        defer { summarising = false }
        let thread = live.value.map {
            AIPrompts.ThreadComment(authorName: $0.authorName, comment: $0.comment, createdAt: $0.createdAt)
        }
        do {
            summary = try await AIStatus.shared.features.summary(of: thread)
        } catch {
            summary = AIPrompts.errorMessage(String(describing: error))
        }
    }

    private func row(_ comment: CommentRecord) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(initials(comment.authorName ?? "You"))
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color(.heather600))
                .frame(width: 30, height: 30)
                .background(Color(.heather600).opacity(0.15), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(comment.authorName ?? "You").font(Theme.rowTitle)
                RichTextView(html: comment.comment).frame(minHeight: 28)
                reactionBar(comment)
            }
        }
        .swipeActions {
            Button("Delete", role: .destructive) {
                attempt { try services.store.deleteComment(localId: comment.localId) }
            }
            Button("Edit") { editing = comment }
        }
    }

    private func initials(_ name: String) -> String {
        let letters = name.split(separator: " ").prefix(2).compactMap(\.first)
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }

    private func reactionBar(_ comment: CommentRecord) -> some View {
        HStack {
            ForEach((comment.reactions ?? [:]).keys.sorted(), id: \.self) { emoji in
                let count = comment.reactions?[emoji]?.count ?? 0
                Button("\(emoji) \(count)") { react(comment, emoji) }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
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
