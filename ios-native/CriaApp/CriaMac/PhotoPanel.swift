import AppKit
import CriaKit
import SwiftUI
import UniformTypeIdentifiers

/// From photo inside the Mac quick-add panel: a 180pt dashed drop zone ("Drop a photo of a list", then "or paste with
/// ⌘V · Choose File…"), then the same review list as Ramble, with the tasks going to the photo capture project.
extension ShoppingPhotoSheet {
    var macPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            MacPanelHeader(title: "From photo", onBack: finish) { EmptyView() }
            Divider()
            if items.isEmpty {
                PhotoDropZone(working: working, onData: { data in Task { await recognise(data) } }, onPaste: pasteImage)
                    .padding(18)
                if let errorMessage {
                    Text(errorMessage).font(.system(size: 12)).foregroundStyle(Color(.destructive)).padding(.horizontal, 18)
                }
                Spacer(minLength: 0)
            } else {
                photoReview
            }
        }
        .frame(height: 420)
        .task { loadDefaults() }
        .onExitCommand { finish() }
    }

    private func pasteImage() {
        guard let data = Pasteboard.image()?.pngRepresentation() else {
            errorMessage = "There is no image on the clipboard."
            return
        }
        Task { await recognise(data) }
    }

    private var photoReview: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 0) {
                    ForEach($items) { $item in
                        MacReviewRow(include: $item.include, title: item.text)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 8)
            }
            if let errorMessage {
                Text(errorMessage).font(.system(size: 12)).foregroundStyle(Color(.destructive))
            }
            Divider()
            HStack(spacing: 8) {
                Button("Start Over") { items = []; captured = nil; untidied = nil }
                Picker("Project", selection: $projectId) {
                    Text("Choose a project").tag("")
                    ForEach(projects, id: \.localId) { Text($0.title).tag($0.localId) }
                }
                .labelsHidden()
                .frame(maxWidth: 180)
                Spacer()
                Button(action: save) {
                    Text(MacReviewRow.addLabel(ShoppingItems.selected(items).count)).padding(.horizontal, 4).frame(height: 30)
                }
                .buttonStyle(.borderedProminent)
                .disabled(tidying || ShoppingItems.selected(items).isEmpty || projectId.isEmpty)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
        }
    }
}

/// The dashed drop target. Takes a dropped image file, ⌘V, or Choose File….
struct PhotoDropZone: View {
    let working: Bool
    let onData: (Data) -> Void
    let onPaste: () -> Void
    @State private var choosing = false
    @State private var targeted = false

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "photo").font(.system(size: 28)).foregroundStyle(Color(.primary))
            Text("Drop a photo of a list").font(.system(size: 15, weight: .semibold))
            HStack(spacing: 4) {
                Text("or paste with ⌘V ·").foregroundStyle(MacTheme.label2)
                Button("Choose File…") { choosing = true }
                    .buttonStyle(.link)
            }
            .font(.system(size: 12))
            if working { ProgressView().controlSize(.small) }
            // ⌘V reads an image off the clipboard.
            Button("Paste", action: onPaste).keyboardShortcut("v", modifiers: .command).hidden()
        }
        .frame(maxWidth: .infinity)
        .frame(height: 180)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(targeted ? Color(.primary).opacity(0.08) : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
                .foregroundStyle(targeted ? Color(.primary) : MacTheme.label3)
        )
        .dropDestination(for: URL.self) { urls, _ in
            guard let url = urls.first, let data = try? Data(contentsOf: url) else { return false }
            onData(data)
            return true
        } isTargeted: { targeted = $0 }
        .fileImporter(isPresented: $choosing, allowedContentTypes: [.image]) { result in
            guard case .success(let url) = result else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            if let data = try? Data(contentsOf: url) { onData(data) }
        }
    }
}
