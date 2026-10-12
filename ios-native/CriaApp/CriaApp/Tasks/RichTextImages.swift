import CriaKit
import Foundation
import WebKit

/// Points the images of sanitised HTML at the schemes `RichTextImageSchemeHandler` serves: `cria://pending/{localId}`
/// for an image still waiting to upload, and `cria-server://` for one on the Vikunja server, which needs the session
/// token the web view does not have. Everything else is left as it is.
enum RichTextImages {
    static let pendingScheme = "cria"
    static let serverScheme = "cria-server"
    private static let pendingPrefix = "cria://pending/"

    /// `serverBase` is the server origin as `ApiClient.serverBase()` gives it (no trailing slash).
    static func rewrite(_ html: String, serverBase: String?) -> String {
        var output = ""
        var cursor = html.startIndex
        while let open = html.range(of: "<img", options: .caseInsensitive, range: cursor..<html.endIndex),
              let close = html[open.upperBound...].firstIndex(of: ">") {
            output += html[cursor..<open.lowerBound]
            let end = html.index(after: close)
            output += rewriteTag(String(html[open.lowerBound..<end]), serverBase: serverBase)
            cursor = end
        }
        output += html[cursor...]
        return output
    }

    /// The sanitiser writes every attribute as ` name="value"`. The editor stores an image as `src="#"` with the real
    /// address in `data-src`; `src` then takes that address.
    private static func rewriteTag(_ tag: String, serverBase: String?) -> String {
        guard let src = value(of: "src", in: tag) else { return tag }
        let dataSrc = value(of: "data-src", in: tag)
        let source = src.isEmpty || src == "#" ? (dataSrc ?? src) : src
        let target: String
        if source.hasPrefix(pendingPrefix) {
            target = source
        } else if let mapped = serverAddress(source, serverBase: serverBase) {
            target = mapped
        } else {
            return tag
        }
        guard target != src else { return tag }
        return tag.replacingOccurrences(of: " src=\"\(src)\"", with: " src=\"\(target)\"")
    }

    private static func value(of name: String, in tag: String) -> String? {
        guard let start = tag.range(of: " \(name)=\"") else { return nil }
        let rest = tag[start.upperBound...]
        guard let end = rest.firstIndex(of: "\"") else { return nil }
        return String(rest[..<end])
    }

    /// `https://server/api/v1/…` becomes `cria-server://server/api/v1/…`; nil for any other address.
    private static func serverAddress(_ source: String, serverBase: String?) -> String? {
        guard let serverBase, !serverBase.isEmpty,
              source.lowercased().hasPrefix((serverBase + "/api/v1/").lowercased()),
              let schemeEnd = source.range(of: "://") else { return nil }
        return serverScheme + source[schemeEnd.lowerBound...]
    }
}

/// Serves the images `RichTextImages` rewrote: queued bytes for `cria://pending/{localId}`, and the server's bytes
/// (fetched with the session token by `AppServices.serverImageData`) for `cria-server://`.
@MainActor
final class RichTextImageSchemeHandler: NSObject, @preconcurrency WKURLSchemeHandler {
    private let services: AppServices
    /// The server's own scheme, put back on a `cria-server://` address before it is fetched.
    var serverScheme = "https"
    /// Server fetches WebKit has not stopped. WebKit raises an exception for any call on a stopped task.
    private var running: Set<ObjectIdentifier> = []

    init(services: AppServices) {
        self.services = services
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        if url.scheme == RichTextImages.serverScheme {
            startServerFetch(urlSchemeTask, url: url)
            return
        }
        guard url.host() == "pending", let data = services.pendingBlobData(url.lastPathComponent) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        Self.respond(urlSchemeTask, url: url, data: data)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
        running.remove(ObjectIdentifier(urlSchemeTask as AnyObject))
    }

    private func startServerFetch(_ urlSchemeTask: any WKURLSchemeTask, url: URL) {
        var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
        parts?.scheme = serverScheme
        guard let original = parts?.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        let key = ObjectIdentifier(urlSchemeTask as AnyObject)
        running.insert(key)
        let services = services
        Task { [weak self] in
            let data = await services.serverImageData(original)
            guard let self, running.remove(key) != nil else { return }
            if let data {
                Self.respond(urlSchemeTask, url: url, data: data)
            } else {
                urlSchemeTask.didFailWithError(URLError(.resourceUnavailable))
            }
        }
    }

    private static func respond(_ urlSchemeTask: any WKURLSchemeTask, url: URL, data: Data) {
        let response = URLResponse(url: url, mimeType: imageType(data), expectedContentLength: data.count, textEncodingName: nil)
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    /// The image type from the first bytes; WebKit sniffs anything else.
    private static func imageType(_ data: Data) -> String? {
        let head = [UInt8](data.prefix(4))
        if head.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "image/png" }
        if head.starts(with: [0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
        if head.starts(with: [0x47, 0x49, 0x46]) { return "image/gif" }
        return nil
    }
}
