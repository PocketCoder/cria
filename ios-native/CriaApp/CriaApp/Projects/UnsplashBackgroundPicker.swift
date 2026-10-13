import CriaKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Unsplash search for a project background, shown only when the server has the provider enabled. Each photo
/// credits its photographer with a link to their Unsplash profile, and the section links to Unsplash, as
/// Vikunja-web does. Ported from the search half of `ProjectBackgroundModal.tsx`.
struct UnsplashBackgroundPicker: View {
    let services: AppServices
    let disabled: Bool
    let onSelect: (UnsplashImage) -> Void
    @State private var query = ""
    @State private var lastQuery = ""
    @State private var results: [UnsplashImage]?
    @State private var page = 1
    @State private var hasMore = false
    @State private var searching = false
    @State private var searchError: String?

    private static let unsplashURL = URL(string: "https://unsplash.com/?utm_source=vikunja&utm_medium=referral")

    var body: some View {
        Section {
            HStack {
                TextField("Search Unsplash", text: $query)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .onSubmit { Task { await search(reset: true) } }
                if searching { ProgressView() }
            }
            if let searchError {
                Text(searchError).foregroundStyle(Color(.destructive))
            }
            if let results {
                if results.isEmpty {
                    Text("No results.").foregroundStyle(Color(.mutedForeground))
                } else {
                    grid(results)
                }
                if hasMore {
                    Button("Load more") { Task { await search(reset: false) } }
                        .disabled(searching)
                }
            }
        } header: {
            Text("Unsplash")
        } footer: {
            if let url = Self.unsplashURL {
                Link("Powered by Unsplash", destination: url).font(Theme.caption)
            }
        }
    }

    private func grid(_ images: [UnsplashImage]) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), alignment: .leading, spacing: 12) {
            ForEach(images) { image in
                UnsplashThumbnailCell(services: services, image: image, disabled: disabled) { onSelect(image) }
            }
        }
        .padding(.vertical, 4)
        // Several buttons and links share one form row: without this a tap anywhere fires them all.
        .buttonStyle(.borderless)
    }

    private func search(reset: Bool) async {
        let term = reset ? query.trimmingCharacters(in: .whitespacesAndNewlines) : lastQuery
        guard !term.isEmpty, !searching else { return }
        let nextPage = reset ? 1 : page + 1
        searching = true
        defer { searching = false }
        do {
            let found = try await services.api.searchUnsplash(term, page: nextPage)
            let earlier = reset ? [] : (results ?? [])
            let seen = Set(earlier.map(\.id))
            results = earlier + found.filter { !seen.contains($0.id) }
            page = nextPage
            lastQuery = term
            hasMore = !found.isEmpty
            searchError = nil
        } catch {
            searchError = "Search failed: \(error)"
        }
    }
}

/// One search result: the thumbnail (through the server's proxy) as the button, the photographer's name below.
private struct UnsplashThumbnailCell: View {
    let services: AppServices
    let image: UnsplashImage
    let disabled: Bool
    let onSelect: () -> Void
    @State private var thumbnail: PlatformImage?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button(action: onSelect) {
                Color(.muted)
                    .aspectRatio(4 / 3, contentMode: .fit)
                    .overlay {
                        if let thumbnail {
                            Image(platformImage: thumbnail).resizable().scaledToFill()
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            .disabled(disabled)
            .opacity(disabled ? 0.5 : 1)
            .accessibilityLabel(image.credit.map { "Set photo by \($0) as background" } ?? "Set this photo as background")
            if let credit = image.credit {
                if let url = image.authorProfileURL {
                    Link(credit, destination: url)
                } else {
                    Text(credit).foregroundStyle(Color(.mutedForeground))
                }
            }
        }
        .font(Theme.footnote)
        .lineLimit(1)
        .task(id: image.id) {
            guard thumbnail == nil, let data = try? await services.api.unsplashThumbnail(imageId: image.id) else { return }
            thumbnail = PlatformImage(data: data)
        }
    }
}
