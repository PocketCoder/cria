import CriaKit
import PhotosUI
import SwiftUI
import UIKit
import Vision

/// Photo of a handwritten or printed list to tasks: Vision reads the text, `ShoppingItems` cleans it, the model
/// (when available) tidies it further, and the user reviews before anything is created.
struct ShoppingPhotoSheet: View {
    let services: AppServices
    @Environment(\.dismiss) private var dismiss
    @State private var picked: PhotosPickerItem?
    @State private var showCamera = false
    @State private var items: [DraftItem] = []
    @State private var projects: [ProjectRecord] = []
    @State private var projectId = ""
    @State private var label = "shopping"
    @State private var working = false
    @State private var errorMessage: String?
    @State private var captured: UIImage?
    @State private var libraryRequested = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    viewport
                    if items.isEmpty {
                        libraryRow
                    } else {
                        reviewSection
                    }
                    if let errorMessage {
                        Text(errorMessage).font(Theme.caption).foregroundStyle(Color(.destructive))
                    }
                }
                .padding(16)
                .animation(.snappy(duration: 0.36), value: items.isEmpty)
            }
            .background(Color(.grouped))
            .navigationTitle("List from photo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }
                if !items.isEmpty {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(ShoppingItems.addButtonLabel(ShoppingItems.selected(items).count), systemImage: "checkmark") { save() }
                            .disabled(ShoppingItems.selected(items).isEmpty || projectId.isEmpty)
                            .modifier(CriaProminentToolbarButton())
                    }
                }
            }
            .onChange(of: picked) { _, item in
                guard let item else { return }
                Task { await read(item) }
            }
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker { data in Task { await recognise(data) } }.ignoresSafeArea()
            }
            .task {
                projects = ProjectTree.visible((try? services.store.projects()) ?? [])
                // Settings > Photo capture: a chosen project is preselected, blank asks each time.
                let defaults = PreferencesStore().load()
                if let chosen = defaults.photoProjectId, projects.contains(where: { $0.localId == chosen }) { projectId = chosen }
                label = defaults.photoLabel
            }
        }
        .presentationDetents([.large])
    }

    /// Dark viewport with white corner guides and a shutter. The shutter opens the system camera (or the photo
    /// library where there is no camera). After a capture it shrinks to 180pt and shows the photo.
    private var viewport: some View {
        let compact = !items.isEmpty
        return ZStack {
            RoundedRectangle(cornerRadius: 28, style: .continuous).fill(Color.black)
            if let captured, compact {
                Image(uiImage: captured).resizable().scaledToFill()
                    .frame(maxWidth: .infinity, maxHeight: 180)
                    .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
            } else {
                CornerGuides().padding(18)
                VStack {
                    Spacer()
                    Text("Point at a handwritten or printed list")
                        .font(Theme.rowSubtitle).foregroundStyle(.white.opacity(0.8))
                    shutter.padding(.top, 8).padding(.bottom, 20)
                }
                if working { ProgressView().tint(.white) }
            }
        }
        .frame(height: compact ? 180 : 440)
    }

    private var shutter: some View {
        Button {
            if CameraPicker.isAvailable { showCamera = true } else { libraryRequested = true }
        } label: {
            Circle().fill(.white).frame(width: 56, height: 56)
                .padding(4)
                .overlay(Circle().strokeBorder(.white, lineWidth: 4))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Take a photo")
        .photosPicker(isPresented: $libraryRequested, selection: $picked, matching: .images)
    }

    private var libraryRow: some View {
        PhotosPicker(selection: $picked, matching: .images) {
            Label("Choose from library", systemImage: "photo")
                .font(.system(size: 16, weight: .semibold))
                .frame(maxWidth: .infinity, minHeight: 48)
                .foregroundStyle(Color(.primary))
                .background(Color(.primarySoft), in: Capsule())
        }
    }

    private var reviewSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(ShoppingItems.selectedLabel(ShoppingItems.selected(items).count))
                .font(Theme.headline).padding(.horizontal, 6)
            VStack(spacing: 0) {
                ForEach($items) { $item in
                    HStack(spacing: 12) {
                        Button {
                            item.include.toggle()
                        } label: {
                            Image(systemName: item.include ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 22))
                                .foregroundStyle(item.include ? Color(.primary) : Color(.mutedForeground))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(item.include ? "Included" : "Excluded")
                        TextField("Item", text: $item.text)
                    }
                    .padding(.vertical, 12)
                    .padding(.horizontal, 14)
                }
            }
            .background(Color(.cell), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            VStack(spacing: 0) {
                Picker("Project", selection: $projectId) {
                    Text("Choose a project").tag("")
                    ForEach(projects, id: \.localId) { Text($0.title).tag($0.localId) }
                }
                .padding(.horizontal, 14).frame(minHeight: 48)
                Divider().padding(.leading, 14)
                TextField("Label (optional)", text: $label).padding(.horizontal, 14).frame(minHeight: 48)
            }
            .background(Color(.cell), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            Button("Start over", role: .destructive) { items = []; captured = nil }
                .font(Theme.rowSubtitle).frame(maxWidth: .infinity)
        }
    }

    private func read(_ item: PhotosPickerItem) async {
        defer { picked = nil }
        guard let data = try? await item.loadTransferable(type: Data.self) else {
            errorMessage = "Could not open that photo."
            return
        }
        await recognise(data)
    }

    private func recognise(_ data: Data) async {
        working = true
        defer { working = false }
        captured = UIImage(data: data)
        let lines = await TextRecogniser.lines(in: data)
        var parsed = ShoppingItems.parse(lines)
        if AIStatus.shared.isOfferable, !parsed.isEmpty,
           let tidy = try? await AIStatus.shared.features.tidyList(parsed) {
            parsed = ShoppingItems.parse(tidy)
        }
        items = ShoppingItems.drafts(from: parsed)
        errorMessage = items.isEmpty ? "No list items found in that photo." : nil
    }

    private func save() {
        do {
            try services.store.createTasks(fromItems: ShoppingItems.selected(items), projectId: projectId, label: label) { saved in
                items.removeAll { $0.id == saved.id }
            }
            dismiss()
        } catch {
            errorMessage = String(describing: error)
        }
    }
}

/// Four white L-shaped corner marks, 26pt long with a 3pt stroke.
private struct CornerGuides: View {
    var body: some View {
        GeometryReader { proxy in
            Path { path in
                let size = proxy.size
                let arm: CGFloat = 26
                for corner in 0..<4 {
                    let stepX: CGFloat = corner.isMultiple(of: 2) ? 1 : -1
                    let stepY: CGFloat = corner < 2 ? 1 : -1
                    let originX = corner.isMultiple(of: 2) ? 0 : size.width
                    let originY = corner < 2 ? 0 : size.height
                    path.move(to: CGPoint(x: originX + stepX * arm, y: originY))
                    path.addLine(to: CGPoint(x: originX, y: originY))
                    path.addLine(to: CGPoint(x: originX, y: originY + stepY * arm))
                }
            }
            .stroke(.white, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
        }
    }
}

/// Vision text recognition, top to bottom.
enum TextRecogniser {
    static func lines(in data: Data) async -> [String] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        // From the data, not a CGImage: that keeps the EXIF orientation, so portrait photos are read upright.
        let handler = VNImageRequestHandler(data: data, options: [:])
        guard (try? handler.perform([request])) != nil else { return [] }
        let ordered = (request.results ?? []).sorted { $0.boundingBox.midY > $1.boundingBox.midY }
        return ordered.compactMap { $0.topCandidates(1).first?.string }
    }
}
