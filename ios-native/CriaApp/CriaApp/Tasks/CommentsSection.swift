import CriaKit
import SwiftUI

/// Comment thread for a task: add, edit and delete write through the store, which queues the server calls. The
/// composer, the edit sheet and the delete confirmation are presented by TaskDetailView through `state`.
struct CommentsSection: View {
    let services: AppServices
    /// The task the thread belongs to, for the address of a comment.
    let task: TaskRecord
    let comments: [CommentRecord]
    let state: TaskDetailPresentation
    @State private var summary: String?
    @State private var summarising = false
    @ScaledMetric(relativeTo: .caption) private var avatarSize: CGFloat = 30

    var body: some View {
        #if os(macOS)
        macThread
        #else
        Section("Comments") {
            ForEach(comments, id: \.localId) { comment in
                row(comment)
            }
            Button { state.composingComment = true } label: {
                Label("Add a comment", systemImage: "bubble.left").foregroundStyle(Color(.mutedForeground))
            }
            summarySection
        }
        #endif
    }

    @ViewBuilder
    var summarySection: some View {
        if AIStatus.shared.isOfferable && comments.count >= 2 {
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
        let thread = comments.map {
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
            // Primary ink, not heather: heather on its own wash is too faint in dark mode.
            Text(initials(comment.authorName ?? "You"))
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color(.primary))
                .frame(width: avatarSize, height: avatarSize)
                .background(Color(.heather600).opacity(0.15), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(comment.authorName ?? "You").font(Theme.rowTitle)
                    if let stamp = Self.timestamp(comment) {
                        Text(stamp).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                    }
                }
                .accessibilityElement(children: .combine)
                RichTextView(html: comment.comment, services: services).frame(minHeight: 28)
                reactionBar(comment)
            }
        }
        .contextMenu {
            if let url = services.commentWebURL(task: task, commentServerId: comment.serverId) {
                Button("Copy link to comment", systemImage: "link") { state.copyLink(url, notice: "Comment link copied") }
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            // Not `.destructive`: that role animates the row away even when the confirmation is cancelled.
            Button("Delete comment", systemImage: "trash") { state.deletingComment = comment }
                .tint(Color(.destructive))
            Button("Edit comment", systemImage: "pencil") { state.editingComment = comment }
        }
    }

    /// "3 hours ago", plus "edited" when the comment changed after it was posted (as the web client shows).
    static func timestamp(_ comment: CommentRecord) -> String? {
        // Vikunja writes "no date" as year 1; a comment without a real creation time shows none.
        guard let created = comment.createdAt.flatMap(DueDates.parse), created.timeIntervalSince1970 > 0 else { return nil }
        let ago = created.formatted(.relative(presentation: .named))
        let edited = comment.updatedAt.flatMap(DueDates.parse).map { $0.timeIntervalSince(created) >= 1 } ?? false
        return edited ? "\(ago) · edited" : ago
    }

    func initials(_ name: String) -> String {
        let letters = name.split(separator: " ").prefix(2).compactMap(\.first)
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }

    func reactionBar(_ comment: CommentRecord) -> some View {
        HStack {
            ForEach((comment.reactions ?? [:]).keys.sorted(), id: \.self) { emoji in
                let count = comment.reactions?[emoji]?.count ?? 0
                Button("\(emoji) \(count)") { react(comment, emoji) }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .controlSize(.small)
                    .accessibilityLabel("\(emoji), \(count) \(count == 1 ? "reaction" : "reactions")")
                    .accessibilityHint("Adds or removes your reaction")
            }
            Menu("Add reaction", systemImage: "face.smiling") {
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
