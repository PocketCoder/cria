import CriaKit
import Foundation

/// Images for the editor: pending uploads from their queued bytes, and images on the Vikunja server (uploaded
/// attachments) fetched with the session token. A server image shows the placeholder until it arrives; `onLoad` then
/// tells the editor to swap it in. Images elsewhere keep the placeholder, as before.
@MainActor
final class EditorImageLoader {
    private static let pendingPrefix = "cria://pending/"
    private var loaded: [String: PlatformImage] = [:]
    private var inFlight: Set<String> = []
    /// Not on the server, offline or not an image: not asked for again while this editor is open.
    private var failed: Set<String> = []

    func image(for source: String, services: AppServices, onLoad: @escaping @MainActor (String) -> Void) -> PlatformImage? {
        if source.hasPrefix(Self.pendingPrefix) {
            return services.pendingBlobData(String(source.dropFirst(Self.pendingPrefix.count))).flatMap { PlatformImage(data: $0) }
        }
        if let image = loaded[source] { return image }
        guard Self.mayBeOnServer(source), !inFlight.contains(source), !failed.contains(source),
              let url = URL(string: source) else { return nil }
        inFlight.insert(source)
        Task { [weak self] in
            // Nil for any host but the signed-in server.
            let data = await services.serverImageData(url)
            guard let self else { return }
            inFlight.remove(source)
            guard let data, let image = PlatformImage(data: data) else {
                failed.insert(source)
                return
            }
            loaded[source] = image
            onLoad(source)
        }
        return nil
    }

    private static func mayBeOnServer(_ source: String) -> Bool {
        let lower = source.lowercased()
        return (lower.hasPrefix("https://") || lower.hasPrefix("http://")) && lower.contains("/api/v1/")
    }
}
