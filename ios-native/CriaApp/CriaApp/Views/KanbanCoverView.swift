import CriaKit
import SwiftUI

/// The image at the top of a board card for a task with a cover (`cover_image_attachment_id`), as in Vikunja-web's
/// kanban card. Loaded lazily when the card scrolls into view, as the server's small preview, and kept for the
/// session. Shows a quiet block while loading and nothing when the image cannot be had (offline, not an image).
struct KanbanCoverView: View {
    let services: AppServices
    let task: TaskRecord
    /// The card's corner radius, so the image follows the card's top corners.
    let radius: CGFloat
    @State private var image: PlatformImage?
    @State private var failed = false

    private static let height: CGFloat = 96

    var body: some View {
        Color(.mutedForeground).opacity(0.12)
            .frame(height: failed ? 0 : Self.height)
            .frame(maxWidth: .infinity)
            // An overlay, so a large image never widens the card.
            .overlay {
                if let image {
                    Image(platformImage: image)
                        .resizable()
                        .scaledToFill()
                }
            }
            .clipShape(UnevenRoundedRectangle(topLeadingRadius: radius, topTrailingRadius: radius))
            .accessibilityHidden(true)
            // Re-runs when the task's cover or sync state changes, so a new cover replaces the old one.
            .task(id: "\(task.serverId ?? 0)-\(task.coverAttachmentServerId ?? 0)") { await load() }
    }

    private func load() async {
        guard let taskId = task.serverId, let attachmentId = task.coverAttachmentServerId else { return }
        failed = false
        let data = await services.coverImageData(taskServerId: taskId, attachmentServerId: attachmentId)
        guard let data, let loaded = PlatformImage(data: data), loaded.size.width > 0, loaded.size.height > 0 else {
            image = nil
            failed = true
            return
        }
        image = loaded
    }
}
