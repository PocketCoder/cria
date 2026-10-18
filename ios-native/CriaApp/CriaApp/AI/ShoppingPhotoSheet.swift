import CriaKit
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import Vision

/// Photo of a handwritten or printed list to tasks: Vision reads the text, `ShoppingItems` cleans it, the model
/// (when available) tidies it further, and the user reviews before anything is created. "Tidy up" runs the model again
/// on the ticked lines, and "Undo tidy" restores the list from before the last tidy, since the model may drop lines.
struct ShoppingPhotoSheet: View {
    let services: AppServices
    #if os(macOS)
    /// Set when hosted in the Mac quick-add panel: goes back to quick add instead of dismissing a sheet.
    var onClose: (() -> Void)?
    #endif
    @Environment(\.dismiss) private var dismiss
    @State private var picked: PhotosPickerItem?
    @State private var showCamera = false
    @State var items: [DraftItem] = []
    @State var projects: [ProjectRecord] = []
    @State var projectId = ""
    @State var label = "shopping"
    @State var working = false
    @State var errorMessage: String?
    @State var captured: PlatformImage?
    /// The Mac has no camera: a file picker (and Paste) stand in for it.
    @State private var choosingFile = false
    @State private var libraryRequested = false
    @State var tidying = false
    @State var untidied: [DraftItem]?

    @ViewBuilder var body: some View {
        #if os(macOS)
        if onClose != nil { macPanel } else { sheet }
        #else
        sheet
        #endif
    }

    private var sheet: some View {
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
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { finish() } }
                if !items.isEmpty {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(ShoppingItems.addButtonLabel(ShoppingItems.selected(items).count), systemImage: "checkmark") { save() }
                            .disabled(tidying || ShoppingItems.selected(items).isEmpty || projectId.isEmpty)
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
            .task { loadDefaults() }
        }
        .presentationDetents([.large])
        .macSheetFrame()
    }

    /// Dark viewport with white corner guides and a shutter. The shutter opens the system camera (or the photo
    /// library where there is no camera). After a capture it shrinks to 180pt and shows the photo.
    private var viewport: some View {
        let compact = !items.isEmpty
        return ZStack {
            RoundedRectangle(cornerRadius: 28, style: .continuous).fill(Color.black)
            if let captured, compact {
                Image(platformImage: captured).resizable().scaledToFill()
                    .frame(maxWidth: .infinity, maxHeight: 180)
                    .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
            } else {
                CornerGuides().padding(18)
                VStack {
                    Spacer()
                    Text(Self.viewportHint)
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
        .accessibilityLabel(Self.shutterLabel)
        .photosPicker(isPresented: $libraryRequested, selection: $picked, matching: .images)
    }

    private var libraryRow: some View {
        VStack(spacing: 10) {
            PhotosPicker(selection: $picked, matching: .images) {
                Label("Choose from library", systemImage: "photo")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .foregroundStyle(Color(.primary))
                    .background(Color(.primarySoft), in: Capsule())
            }
            #if os(macOS)
            macSources
            #endif
        }
    }

    private var reviewSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            reviewHeader
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
            .disabled(tidying)
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
            Button("Start over", role: .destructive) { items = []; captured = nil; untidied = nil }
                .font(Theme.rowSubtitle).frame(maxWidth: .infinity)
                .disabled(tidying)
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

    func recognise(_ data: Data) async {
        working = true
        defer { working = false }
        captured = PlatformImage(data: data)
        let lines = await TextRecogniser.lines(in: data)
        items = ShoppingItems.drafts(from: ShoppingItems.parse(lines))
        untidied = nil
        errorMessage = items.isEmpty ? "No list items found in that photo." : nil
        if AIStatus.shared.isOfferable, AIStatus.shared.notReadyMessage == nil { await tidy() }
    }

    /// The count, then "Undo tidy" and "Tidy up" where the device can run the model.
    private var reviewHeader: some View {
        HStack(spacing: 12) {
            Text(ShoppingItems.selectedLabel(ShoppingItems.selected(items).count)).font(Theme.headline)
            Spacer()
            if AIStatus.shared.isOfferable {
                if untidied != nil {
                    Button("Undo tidy", systemImage: "arrow.uturn.backward") { undoTidy() }
                        .accessibilityHint("Restores the list as it was before tidying")
                }
                Button(tidying ? "Tidying…" : "Tidy up", systemImage: "sparkles") { Task { await tidy() } }
                    .disabled(AIStatus.shared.notReadyMessage != nil)
                    .accessibilityHint("Fixes misreadings and drops prices and headings, on this device")
            }
        }
        .font(Theme.rowSubtitle)
        .buttonStyle(.borderless)
        .disabled(tidying)
        .padding(.horizontal, 6)
    }

    /// On-device clean-up of the ticked lines (misreadings, split items, prices). Replaces the list and keeps the one
    /// before it for "Undo tidy". The list is locked while it runs, since the result would overwrite edits.
    private func tidy() async {
        let before = items
        let lines = ShoppingItems.selected(before).map(\.text)
        guard !lines.isEmpty, !tidying else { return }
        tidying = true
        defer { tidying = false }
        do {
            let cleaned = ShoppingItems.parse(try await AIStatus.shared.features.tidyList(lines))
            guard !cleaned.isEmpty else { return }
            items = ShoppingItems.drafts(from: cleaned)
            untidied = before
            errorMessage = nil
        } catch {
            errorMessage = AIPrompts.errorMessage(String(describing: error))
        }
    }

    private func undoTidy() {
        if let untidied { items = untidied }
        untidied = nil
    }

    func save() {
        // A pre-tidy list would bring back items saved below.
        untidied = nil
        do {
            try services.store.createTasks(fromItems: ShoppingItems.selected(items), projectId: projectId, label: label) { saved in
                items.removeAll { $0.id == saved.id }
            }
            finish()
        } catch {
            errorMessage = String(describing: error)
        }
    }
}

extension ShoppingPhotoSheet {
    /// Settings > Photo capture: a chosen project is preselected, blank asks each time.
    func loadDefaults() {
        projects = ProjectTree.visible((try? services.store.projects()) ?? [])
        let defaults = PreferencesStore().load()
        if let chosen = defaults.photoProjectId, projects.contains(where: { $0.localId == chosen }) { projectId = chosen }
        label = defaults.photoLabel
    }

    /// Back to quick add in the Mac panel, else dismisses the sheet.
    func finish() {
        #if os(macOS)
        if let onClose {
            onClose()
            return
        }
        #endif
        dismiss()
    }

    private static var viewportHint: String {
        #if os(macOS)
        "Choose a photo of a handwritten or printed list"
        #else
        "Point at a handwritten or printed list"
        #endif
    }

    private static var shutterLabel: String {
        #if os(macOS)
        "Choose a photo"
        #else
        "Take a photo"
        #endif
    }

    #if os(macOS)
    /// Files and the clipboard, the Mac's stand-ins for the camera.
    private var macSources: some View {
        HStack(spacing: 10) {
            Button("Choose file…", systemImage: "doc") { choosingFile = true }
            Button("Paste image", systemImage: "doc.on.clipboard") {
                guard let data = Pasteboard.image()?.pngRepresentation() else {
                    errorMessage = "There is no image on the clipboard."
                    return
                }
                Task { await recognise(data) }
            }
        }
        .buttonStyle(.bordered)
        .fileImporter(isPresented: $choosingFile, allowedContentTypes: [.image]) { result in
            guard case .success(let url) = result else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else {
                errorMessage = "Could not open that file."
                return
            }
            Task { await recognise(data) }
        }
    }
    #endif
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
