import CriaKit
import SwiftUI
import UIKit

extension Notification.Name {
    /// Posted after a project's background is set or removed (object: the project's server id), so an open project
    /// screen shows the change straight away.
    static let criaProjectBackgroundChanged = Notification.Name("cria.projectBackgroundChanged")
}

/// A project's background as a rounded banner above the header line. Nothing is drawn over it, so text stays
/// readable on any photo; in dark mode it is dimmed a little so a bright photo does not glare.
struct ProjectBackgroundBanner: View {
    let image: UIImage
    let height: CGFloat
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Color.clear
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .overlay {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                    .strokeBorder(Color(.border), lineWidth: 0.5)
            }
            .opacity(colorScheme == .dark ? 0.85 : 1)
            .accessibilityHidden(true)
    }
}

/// Loads a project's background for the project screen: the cached copy at once, then the server's when it has not
/// been checked lately. Ported from `useProjectBackground.ts` (blob-store cache, 30 minute stale time). Never blocks
/// and never throws: offline, the cached copy stays.
@MainActor
enum ProjectBackgroundLoader {
    /// When each project's background was last checked against the server, this launch.
    private static var checked: [Int: Date] = [:]
    private static let staleAfter: TimeInterval = 30 * 60
    /// Longest side of the decoded image, in pixels: enough for a full-width banner on any iPhone.
    nonisolated private static let maxPixels: CGFloat = 1600

    /// Makes the next load ask the server, e.g. after the background changed.
    static func forget(_ serverId: Int) {
        checked[serverId] = nil
    }

    /// Calls `show` with the cached image (nil when none), then again if the server's differs.
    static func load(services: AppServices, serverId: Int, show: (UIImage?) -> Void) async {
        let cache = services.backgrounds
        let cached = cache.cached(serverId: serverId)
        if let cached {
            show(await decode(cached))
        } else {
            show(nil)
        }
        if let last = checked[serverId], Date().timeIntervalSince(last) < staleAfter { return }
        do {
            let fresh = try await services.api.projectBackground(projectId: serverId)
            guard !Task.isCancelled else { return }
            checked[serverId] = Date()
            cache.replace(serverId: serverId, with: fresh)
            guard fresh != cached else { return }
            if let fresh {
                show(await decode(fresh))
            } else {
                show(nil)
            }
        } catch {
            // Offline or the server is unreachable: keep showing the cached copy.
        }
    }

    /// Decodes and downsizes off the main thread, so a large photo cannot stall scrolling.
    nonisolated static func decode(_ data: Data) async -> sending UIImage? {
        guard let image = UIImage(data: data), image.size.width > 0, image.size.height > 0 else { return nil }
        let width = image.size.width * image.scale
        let height = image.size.height * image.scale
        let factor = min(1, maxPixels / max(width, height))
        let size = CGSize(width: max(1, (width * factor).rounded()), height: max(1, (height * factor).rounded()))
        return image.preparingThumbnail(of: size) ?? image
    }
}
