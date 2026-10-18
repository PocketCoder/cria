#if os(macOS)
import CriaKit
import SwiftUI

// The inspector's comment thread: 24pt avatars, the name in SF 12 semibold with the time in `label3`, the body at
// SF 13/18, then an "Add a comment" field.
extension CommentsSection {
    var macThread: some View {
        Section {
            ForEach(comments, id: \.localId) { macRow($0) }
            MacCommentComposer(services: services, taskLocalId: task.localId, state: state)
            summarySection
        } header: {
            Text("Comments")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(MacTheme.label2)
                .textCase(nil)
        }
        .listRowBackground(Color.clear)
    }

    private func macRow(_ comment: CommentRecord) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(initials(comment.authorName ?? "You"))
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Color(.primary))
                .frame(width: 24, height: 24)
                .background(Color(.heather600).opacity(0.15), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(comment.authorName ?? "You").font(.system(size: 12, weight: .semibold))
                    if let stamp = Self.timestamp(comment) {
                        Text(stamp).font(.system(size: 11)).foregroundStyle(MacTheme.label3)
                    }
                }
                .accessibilityElement(children: .combine)
                // A web view with its own stylesheet (RichTextView), so the body type is set there, not here.
                RichTextView(html: comment.comment, services: services)
                reactionBar(comment)
            }
        }
        .contextMenu {
            Button("Edit Comment", systemImage: "pencil") { state.editingComment = comment }
            if let url = services.commentWebURL(task: task, commentServerId: comment.serverId) {
                Button("Copy Link to Comment", systemImage: "link") { state.copyLink(url, notice: "Comment link copied") }
            }
            Divider()
            Button("Delete Comment", systemImage: "trash", role: .destructive) { state.deletingComment = comment }
        }
    }
}

/// "Add a comment": a 30pt field in `fill` with radius 8, and a send button that turns prominent once there is text.
/// Return sends. The text is saved as one paragraph; the full composer (formatting, mentions) is a click away.
struct MacCommentComposer: View {
    let services: AppServices
    let taskLocalId: String
    let state: TaskDetailPresentation
    @State private var text = ""

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        HStack(spacing: 6) {
            TextField("Add a comment", text: $text)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .onSubmit(send)
            Button(action: { state.composingComment = true }, label: {
                Image(systemName: "textformat").font(.system(size: 11)).foregroundStyle(MacTheme.label2)
            })
            .buttonStyle(.plain)
            .help("Write with formatting")
            .accessibilityLabel("Write with formatting")
            Button(action: send) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(trimmed.isEmpty ? MacTheme.label3 : .white)
                    .frame(width: 22, height: 22)
                    .background(trimmed.isEmpty ? MacTheme.fill : Color(.primary), in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(trimmed.isEmpty)
            .accessibilityLabel("Send comment")
        }
        .padding(.leading, 10)
        .padding(.trailing, 4)
        .frame(height: 30)
        .background(MacTheme.fill, in: RoundedRectangle(cornerRadius: 8))
        .animation(.easeOut(duration: 0.15), value: trimmed.isEmpty)
    }

    private func send() {
        let body = trimmed
        guard !body.isEmpty else { return }
        let html = "<p>\(Self.escape(body))</p>"
        state.attempt { _ = try services.store.createComment(taskLocalId: taskLocalId, comment: html) }
        text = ""
    }

    private static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }
}
#endif
