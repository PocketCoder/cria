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

    var body: some View {
        NavigationStack {
            Form {
                if items.isEmpty {
                    sourceSection
                } else {
                    reviewSection
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(Color(.destructive)) }
                }
            }
            .criaSurface()
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
                let remembered = try? services.store.captureProjectId()
                projectId = remembered ?? projects.first?.localId ?? ""
            }
        }
    }

    private var sourceSection: some View {
        Section {
            PhotosPicker(selection: $picked, matching: .images) { Label("Choose a photo", systemImage: "photo") }
            if CameraPicker.isAvailable {
                Button("Take a photo", systemImage: "camera") { showCamera = true }
            }
            if working { ProgressView("Reading the list…") }
        } footer: {
            Text("Works best on a flat, well lit list with one item per line.")
        }
    }

    private var reviewSection: some View {
        Group {
            Section(ShoppingItems.selectedLabel(ShoppingItems.selected(items).count)) {
                ForEach($items) { $item in
                    Toggle(isOn: $item.include) { TextField("Item", text: $item.text) }
                }
            }
            Section {
                Picker("Project", selection: $projectId) {
                    ForEach(projects, id: \.localId) { Text($0.title).tag($0.localId) }
                }
                TextField("Label (optional)", text: $label)
                Button("Start over", role: .destructive) { items = [] }
            }
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
