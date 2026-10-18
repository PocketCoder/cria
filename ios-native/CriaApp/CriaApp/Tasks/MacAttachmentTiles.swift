#if os(macOS)
import CriaKit
import SwiftUI

/// The inspector's attachments: the section title with "Drop files here" on the right, then two columns of tiles
/// (a 30pt icon square in `primary` at 13%, the file name, and its size in SF 11 `label3`). A click previews the
/// file; the context menu deletes it.
struct MacAttachmentTiles: View {
    let services: AppServices
    let taskLocalId: String
    let attachments: [AttachmentRecord]
    let state: TaskDetailPresentation

    private var actions: AttachmentActions {
        AttachmentActions(services: services, taskLocalId: taskLocalId, state: state)
    }

    private let columns = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]

    var body: some View {
        Section {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
                ForEach(attachments, id: \.localId) { tile($0) }
            }
            if let errorText = state.attachmentError {
                Text(errorText).font(.system(size: 11)).foregroundStyle(Color(.destructive))
            }
        } header: {
            HStack {
                Text("Attachments").font(.system(size: 12, weight: .semibold)).foregroundStyle(MacTheme.label2)
                Spacer()
                Text("Drop files here").font(.system(size: 11)).foregroundStyle(MacTheme.label3)
            }
            .textCase(nil)
        }
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
    }

    private func tile(_ attachment: AttachmentRecord) -> some View {
        Button { actions.open(attachment) } label: {
            HStack(spacing: 8) {
                Image(systemName: icon(attachment))
                    .font(.system(size: 13))
                    .foregroundStyle(Color(.primary))
                    .frame(width: 30, height: 30)
                    .background(Color(.primary).opacity(0.13), in: RoundedRectangle(cornerRadius: 7))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(attachment.fileName).font(.system(size: 12)).lineLimit(1).truncationMode(.middle)
                    Text(detail(attachment)).font(.system(size: 11)).foregroundStyle(detailColour(attachment))
                }
                Spacer(minLength: 0)
            }
            .padding(6)
            .background(MacTheme.cell, in: RoundedRectangle(cornerRadius: 10))
            .contentShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .help(attachment.fileName)
        .accessibilityHint(attachment.pending ? "" : "Opens a preview")
        .contextMenu {
            Button("Delete Attachment", systemImage: "trash", role: .destructive) { state.deletingAttachment = attachment }
        }
    }

    private func icon(_ attachment: AttachmentRecord) -> String {
        if attachment.pending { return "arrow.up.circle" }
        if attachment.mime?.hasPrefix("image/") == true { return "photo" }
        return "doc"
    }

    /// The size, or the upload state while the file is queued.
    private func detail(_ attachment: AttachmentRecord) -> String {
        if attachment.uploadFailed { return "Failed" }
        if attachment.pending { return "Queued" }
        guard let size = attachment.fileSize else { return "" }
        return ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)
    }

    private func detailColour(_ attachment: AttachmentRecord) -> Color {
        attachment.uploadFailed ? Color(.destructive) : MacTheme.label3
    }
}
#endif
