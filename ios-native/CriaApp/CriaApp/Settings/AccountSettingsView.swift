import CriaKit
import PhotosUI
import SwiftUI
import UIKit

/// Account: display name, avatar source and avatar upload. Ported from `AccountTab.tsx`.
struct AccountSettingsView: View {
    let services: AppServices
    @State private var model: SettingsModel
    @State private var name = ""
    @State private var provider = AvatarProvider.standard
    @State private var avatar: UIImage?
    @State private var picked: PhotosPickerItem?
    @State private var uploading = false
    @State private var errorMessage: String?
    @FocusState private var nameFocused: Bool

    init(services: AppServices) {
        self.services = services
        _model = State(initialValue: SettingsModel(services: services))
    }

    var body: some View {
        Form {
            previewSection
            Section {
                TextField("Display name", text: $name)
                    .focused($nameFocused)
                    .submitLabel(.done)
                    .onSubmit { saveName() }
                    .onChange(of: nameFocused) { _, focused in if !focused { saveName() } }
            } header: {
                Text("Name")
            } footer: {
                Text("Shown on tasks you create and to people you share with.").font(Theme.caption)
            }
            avatarSection
            if let message = errorMessage ?? model.errorMessage {
                Section { Text(message).font(Theme.caption).foregroundStyle(Color(.destructive)) }
            }
        }
        .criaSurface()
        .tint(Color(.primary))
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
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
            Image(uiImage: avatar).resizable().scaledToFill()
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

    private func load() async {
        await model.load()
        name = model.general.name
        if let raw = try? await services.api.avatarProvider() {
            provider = AvatarProvider(rawValue: raw) ?? .standard
        }
        await loadAvatar()
    }

    private func loadAvatar() async {
        guard !model.username.isEmpty, let data = try? await services.api.avatarData(username: model.username) else { return }
        avatar = UIImage(data: data)
    }

    /// Saves only when the trimmed name is non-empty and changed, as the Tauri tab does.
    private func saveName() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != model.general.name else { return }
        name = trimmed
        Task { await model.save(GeneralSettings.changeName(trimmed)) { $0.name = trimmed } }
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
        let isPNG = data.starts(with: [0x89, 0x50, 0x4E, 0x47])
        do {
            try await services.api.uploadAvatar(
                fileName: isPNG ? "avatar.png" : "avatar.jpg", mime: isPNG ? "image/png" : "image/jpeg", bytes: data
            )
            errorMessage = nil
            await loadAvatar()
        } catch {
            errorMessage = String(describing: error)
        }
    }
}
