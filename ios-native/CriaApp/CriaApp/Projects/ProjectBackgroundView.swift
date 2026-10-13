import CriaKit
import PhotosUI
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// A project's background: upload a photo, pick one from Unsplash (when the server offers it) or remove it. Online
/// only, with no outbox: each change is sent at once, with a spinner while it runs and the error if it fails. Ported
/// from `ProjectBackgroundModal.tsx`.
struct ProjectBackgroundView: View {
    let services: AppServices
    let project: ProjectRecord
    /// The server's background providers from `/info`; nil until loaded.
    @State private var providers: [String]?
    @State private var offline = false
    @State private var current: PlatformImage?
    @State private var picked: PhotosPickerItem?
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var confirmingRemove = false

    private var canUpload: Bool { ApiClient.hasBackgroundProvider(providers ?? [], "upload") }
    private var canUnsplash: Bool { ApiClient.hasBackgroundProvider(providers ?? [], "unsplash") }
    private var disabled: Bool { busy || offline || project.serverId == nil }

    var body: some View {
        Form {
            statusSection
            if let current {
                Section {
                    ProjectBackgroundBanner(image: current, height: 140)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
            }
            actionsSection
            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(Color(.destructive)) }
            }
            if canUnsplash, let serverId = project.serverId {
                UnsplashBackgroundPicker(services: services, disabled: disabled) { image in
                    Task { await change(serverId) { try await services.api.setUnsplashBackground(projectId: serverId, image: image) } }
                }
            }
        }
        .criaSurface()
        .navigationTitle("Background")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if busy { ProgressView().accessibilityLabel("Saving") }
            }
        }
        .confirmationDialog("Remove this project\u{2019}s background image?", isPresented: $confirmingRemove,
                            titleVisibility: .visible) {
            Button("Remove", role: .destructive) { Task { await remove() } }
        }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task { await upload(item) }
        }
        .task { await load() }
    }

    @ViewBuilder private var statusSection: some View {
        if project.serverId == nil {
            Section { Text("This project hasn\u{2019}t synced yet. Try again in a moment.").foregroundStyle(Color(.mutedForeground)) }
        } else if offline {
            Section {
                Label("You\u{2019}re offline. Backgrounds need a connection.", systemImage: "wifi.slash")
                    .foregroundStyle(Color(.warningText))
            }
        } else if providers == nil {
            Section { ProgressView().frame(maxWidth: .infinity) }
        } else if !canUpload && !canUnsplash {
            Section { Text("This server has no background providers enabled.").foregroundStyle(Color(.mutedForeground)) }
        }
    }

    @ViewBuilder private var actionsSection: some View {
        if canUpload || current != nil {
            Section {
                if canUpload {
                    PhotosPicker(selection: $picked, matching: .images) {
                        Label(current == nil ? "Choose photo" : "Replace with photo", systemImage: "photo.on.rectangle")
                    }
                    .disabled(disabled)
                }
                if current != nil {
                    Button(role: .destructive) {
                        confirmingRemove = true
                    } label: {
                        Label("Remove background", systemImage: "trash")
                    }
                    .disabled(disabled)
                }
            }
        }
    }

    private func load() async {
        if let serverId = project.serverId, let data = services.backgrounds.cached(serverId: serverId) {
            current = await ProjectBackgroundLoader.decode(data)
        }
        do {
            providers = try await services.api.info().backgroundProviders
            offline = false
        } catch {
            offline = true
            return
        }
        if let serverId = project.serverId { await refreshCurrent(serverId) }
    }

    /// Re-reads the background from the server into the cache, this screen and any open project screen.
    private func refreshCurrent(_ serverId: Int) async {
        do {
            let fresh = try await services.api.projectBackground(projectId: serverId)
            services.backgrounds.replace(serverId: serverId, with: fresh)
            if let fresh {
                current = await ProjectBackgroundLoader.decode(fresh)
            } else {
                current = nil
            }
        } catch {
            // Unreachable: keep what is shown.
        }
    }

    /// Runs one change, then refreshes the cached copy and tells the project screen.
    private func change(_ serverId: Int, _ work: () async throws -> Void) async {
        busy = true
        errorMessage = nil
        defer { busy = false }
        do {
            try await work()
        } catch {
            errorMessage = String(describing: error)
            return
        }
        ProjectBackgroundLoader.forget(serverId)
        await refreshCurrent(serverId)
        NotificationCenter.default.post(name: .criaProjectBackgroundChanged, object: serverId)
    }

    private func remove() async {
        guard let serverId = project.serverId else { return }
        busy = true
        errorMessage = nil
        defer { busy = false }
        do {
            try await services.api.removeProjectBackground(projectId: serverId)
        } catch {
            errorMessage = String(describing: error)
            return
        }
        services.backgrounds.replace(serverId: serverId, with: nil)
        ProjectBackgroundLoader.forget(serverId)
        withAnimation { current = nil }
        NotificationCenter.default.post(name: .criaProjectBackgroundChanged, object: serverId)
    }

    private func upload(_ item: PhotosPickerItem) async {
        defer { picked = nil }
        guard let serverId = project.serverId else { return }
        guard let data = try? await item.loadTransferable(type: Data.self) else {
            errorMessage = "Could not open that photo."
            return
        }
        // iPhone photos are HEIC, which Vikunja rejects: send a JPEG whatever was picked.
        guard let jpeg = BackgroundImage.jpeg(from: data) else {
            errorMessage = "That file is not an image Cria can read."
            return
        }
        await change(serverId) {
            try await services.api.uploadProjectBackground(projectId: serverId, fileName: "background.jpg",
                                                           mime: "image/jpeg", bytes: jpeg)
        }
    }
}

/// Re-encodes a picked photo for the background upload. Vikunja takes JPEG, PNG, GIF, BMP, TIFF and WebP, and the
/// photo library hands out HEIC.
private enum BackgroundImage {
    /// Longest side after downscaling, in pixels: sharp as a desktop backdrop, still a modest upload.
    static let maxSide: CGFloat = 2560
    static let quality: CGFloat = 0.85

    @MainActor
    static func jpeg(from data: Data) -> Data? {
        #if os(macOS)
        return JPEGReencoder.jpeg(from: data, maxSide: maxSide, quality: quality)
        #else
        guard let image = PlatformImage(data: data), image.size.width > 0, image.size.height > 0 else { return nil }
        let factor = min(1, maxSide / max(image.size.width, image.size.height))
        let size = CGSize(width: max(1, (image.size.width * factor).rounded()), height: max(1, (image.size.height * factor).rounded()))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let rendered = UIGraphicsImageRenderer(size: size, format: format).image { context in
            // JPEG has no alpha: a transparent PNG would otherwise come out black.
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return rendered.jpegData(compressionQuality: quality)
        #endif
    }
}
