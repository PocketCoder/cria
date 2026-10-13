import CriaKit
import PhotosUI
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Account: display name, avatar source and avatar upload. Ported from `AccountTab.tsx`.
struct AccountSettingsView: View {
    let services: AppServices
    /// Shared with the Settings screen, so its account card shows a saved name straight away.
    let model: SettingsModel
    @State private var name = ""
    /// True once the user has edited the field; the server's name no longer overwrites it.
    @State private var nameTouched = false
    @State private var provider = AvatarProvider.standard
    @State private var avatar: PlatformImage?
    @State private var picked: PhotosPickerItem?
    @State private var uploading = false
    @State private var errorMessage: String?

    init(services: AppServices, model: SettingsModel) {
        self.services = services
        self.model = model
    }

    var body: some View {
        Form {
            previewSection
            Section {
                TextField("Display name", text: Binding(get: { name }, set: { name = $0; nameTouched = true }))
                    .submitLabel(.done)
                    .onSubmit { saveName() }
                    .disabled(!model.loaded)
                Button("Save name") { saveName() }
                    .disabled(pendingName == nil)
            } header: {
                Text("Name")
            } footer: {
                Text("Shown on tasks you create and to people you share with.").font(Theme.caption)
            }
            avatarSection
            if let message = errorMessage ?? model.errorMessage ?? loadMessage {
                Section { Text(message).font(Theme.caption).foregroundStyle(Color(.destructive)) }
            }
        }
        .criaSurface()
        .tint(Color(.primary))
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onChange(of: model.general.name, initial: true) { _, serverName in
            if !nameTouched { name = serverName }
        }
        // Leaving with an unsaved edit saves it, as tapping Save would.
        .onDisappear { saveName() }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task { await upload(item) }
        }
    }

    private var previewSection: some View {
        Section {
            HStack(spacing: 14) {
                avatarView
                VStack(alignment: .leading, spacing: 2) {
                    Text(name.isEmpty ? model.username : name).font(Theme.rowTitle)
                    Text("@\(model.username)").font(Theme.rowSubtitle).foregroundStyle(Color(.mutedForeground))
                }
            }
            .frame(minHeight: 64)
            .accessibilityElement(children: .combine)
        }
    }

    @ViewBuilder
    private var avatarView: some View {
        if let avatar {
            Image(platformImage: avatar).resizable().scaledToFill()
                .frame(width: 48, height: 48).clipShape(Circle())
                .accessibilityHidden(true)
        } else {
            Text(initials)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color(.primary))
                .frame(width: 48, height: 48)
                .background(Color(.primarySoft), in: Circle())
                .accessibilityHidden(true)
        }
    }

    private var avatarSection: some View {
        Section {
            Picker(selection: Binding(
                get: { provider },
                set: { choice in changeProvider(choice) }
            )) {
                ForEach(AvatarProvider.allCases, id: \.self) { Text($0.title).tag($0) }
            } label: {
                SettingsLabel("Avatar", symbol: "person.crop.circle", token: .llama500)
            }
            if provider == .upload {
                PhotosPicker(selection: $picked, matching: .images) {
                    HStack {
                        SettingsLabel(uploading ? "Uploading…" : "Choose image", symbol: "photo", token: .sky500)
                        Spacer()
                        if uploading { ProgressView() }
                    }
                }
                .disabled(uploading)
            }
        } header: {
            Text("Avatar")
        } footer: {
            if provider == .upload {
                Text("Pick a photo to use as your avatar.").font(Theme.caption)
            }
        }
    }

    private var initials: String {
        let source = name.isEmpty ? model.username : name
        let letters = source.split(separator: " ").prefix(2).compactMap(\.first)
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }

    /// Shown only while nothing has loaded: afterwards a failed refresh leaves the last good values in place.
    private var loadMessage: String? {
        model.loaded ? nil : model.loadError.map { "Couldn\u{2019}t load your account: \($0)" }
    }

    private func load() async {
        await model.loadIfNeeded()
        if let raw = try? await services.api.avatarProvider() {
            provider = AvatarProvider(rawValue: raw) ?? .standard
        }
        await loadAvatar()
    }

    private func loadAvatar() async {
        guard !model.username.isEmpty, let data = try? await services.api.avatarData(username: model.username) else { return }
        avatar = PlatformImage(data: data)
    }

    /// The trimmed name to save: non-empty and changed, and only once the server's settings have loaded (before that
    /// the field cannot be compared with anything). Nil when there is nothing to save.
    private var pendingName: String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard model.loaded, !trimmed.isEmpty, trimmed != model.general.name else { return nil }
        return trimmed
    }

    private func saveName() {
        guard let trimmed = pendingName else { return }
        name = trimmed
        Task {
            if await model.save(GeneralSettings.changeName(trimmed), apply: { $0.name = trimmed }) { nameTouched = false }
        }
    }

    private func changeProvider(_ choice: AvatarProvider) {
        let previous = provider
        provider = choice
        Task {
            do {
                try await services.api.setAvatarProvider(choice.rawValue)
                errorMessage = nil
                await loadAvatar()
            } catch {
                provider = previous
                errorMessage = String(describing: error)
            }
        }
    }

    private func upload(_ item: PhotosPickerItem) async {
        defer { picked = nil }
        guard let data = try? await item.loadTransferable(type: Data.self) else {
            errorMessage = "Could not open that photo."
            return
        }
        uploading = true
        defer { uploading = false }
        // iPhone photos are HEIC, which Vikunja rejects as "not an image": send a downscaled JPEG whatever was picked.
        guard let jpeg = AvatarImage.jpeg(from: data) else {
            errorMessage = "That file is not an image Cria can read."
            return
        }
        do {
            try await services.api.uploadAvatar(fileName: "avatar.jpg", mime: "image/jpeg", bytes: jpeg)
            errorMessage = nil
            await loadAvatar()
        } catch {
            errorMessage = String(describing: error)
        }
    }
}
