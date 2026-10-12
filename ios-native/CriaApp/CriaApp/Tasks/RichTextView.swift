import CriaKit
import SwiftUI
import UIKit
import WebKit

/// Read-only rendering of a Vikunja description or comment. The HTML goes through `HTMLSanitizer` first and the
/// web view has JavaScript off, so stored markup can never run script. It sizes itself to its content. Links open
/// in the system browser. With `services`, inline images still waiting to upload (`cria://pending/{localId}`) show
/// from their queued bytes. Images on the server that need the session token are not loaded here.
struct RichTextView: View {
    let html: String
    var services: AppServices?
    @State private var height: CGFloat = 28

    var body: some View {
        RichTextWebView(html: html, services: services, height: $height).frame(height: height)
    }
}

private struct RichTextWebView: UIViewRepresentable {
    let html: String
    let services: AppServices?
    @Binding var height: CGFloat

    func makeCoordinator() -> Coordinator {
        Coordinator(height: $height)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        if let services {
            configuration.setURLSchemeHandler(PendingImageSchemeHandler(services: services), forURLScheme: "cria")
        }
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.navigationDelegate = context.coordinator
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        // Every parent re-render (each sync) lands here; only a real change of content reloads the page.
        guard context.coordinator.loadedHTML != html else { return }
        context.coordinator.loadedHTML = html
        let body = HTMLSanitizer.sanitize(html)
        let page = """
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>body{font:-apple-system-body;margin:0;color-scheme:light dark}\
        ul[data-type=taskList]{list-style:none;padding-left:0}img{max-width:100%}</style>\(body)
        """
        view.loadHTMLString(page, baseURL: nil)
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        var loadedHTML: String?
        private let height: Binding<CGFloat>

        init(height: Binding<CGFloat>) {
            self.height = height
        }

        /// Only our own `loadHTMLString` (about:blank) loads in place. A tapped link opens in the system browser;
        /// anything else is refused.
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = navigationAction.request.url else { return .cancel }
            if url.scheme == "about" { return .allow }
            if navigationAction.navigationType == .linkActivated, ["http", "https", "mailto"].contains(url.scheme?.lowercased()) {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
            return .cancel
        }

        /// Native evaluation still works with page JavaScript off.
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.evaluateJavaScript("document.documentElement.scrollHeight") { [weak self] result, _ in
                guard let measured = result as? Double, measured > 0 else { return }
                self?.height.wrappedValue = max(28, CGFloat(measured))
            }
        }
    }
}

/// Serves `cria://pending/{localId}` from the queued bytes of an attachment that has not uploaded yet.
@MainActor
private final class PendingImageSchemeHandler: NSObject, @preconcurrency WKURLSchemeHandler {
    private let services: AppServices

    init(services: AppServices) {
        self.services = services
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, url.host() == "pending",
              let data = services.pendingBlobData(url.lastPathComponent) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let response = URLResponse(url: url, mimeType: Self.imageType(data), expectedContentLength: data.count, textEncodingName: nil)
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {}

    /// The image type from the first bytes; WebKit sniffs anything else.
    private static func imageType(_ data: Data) -> String? {
        let head = [UInt8](data.prefix(4))
        if head.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "image/png" }
        if head.starts(with: [0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
        if head.starts(with: [0x47, 0x49, 0x46]) { return "image/gif" }
        return nil
    }
}
