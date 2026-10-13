import CriaKit
import SwiftUI
import UIKit
import WebKit

/// Read-only rendering of a Vikunja description or comment. The HTML goes through `HTMLSanitizer` first and the
/// web view has JavaScript off, so stored markup can never run script. It sizes itself to its content. Links open
/// in the system browser. With `services`, inline images still waiting to upload (`cria://pending/{localId}`) show
/// from their queued bytes, and images on the Vikunja server (uploaded attachments, which need the session token)
/// load through `cria-server://`.
struct RichTextView: View {
    let html: String
    var services: AppServices?
    @State private var height: CGFloat = 28
    @State private var serverBase: String?
    @State private var baseResolved = false
    @State private var viewing: ImageViewerItem?
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        RichTextWebView(
            html: html, services: services, serverBase: serverBase, ready: services == nil || baseResolved,
            typeSize: typeSize, height: $height, onOpenImage: { viewing = ImageViewerItem(source: $0) }
        )
        .frame(height: height)
        // Tapping an inline image opens it full screen.
        .fullScreenCover(item: $viewing) { ImageViewer(item: $0, services: services) }
        .task {
            // Known before the first load, so server images are rewritten from the start.
            if let services { serverBase = await services.api.serverBase() }
            baseResolved = true
        }
    }
}

private struct RichTextWebView: UIViewRepresentable {
    let html: String
    let services: AppServices?
    let serverBase: String?
    /// False until the server address is known; nothing loads before then.
    let ready: Bool
    /// The page's `-apple-system-body` follows Dynamic Type; a size change reloads it so the height is measured again.
    let typeSize: DynamicTypeSize
    @Binding var height: CGFloat
    let onOpenImage: @MainActor (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(height: $height)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        if let services {
            let handler = RichTextImageSchemeHandler(services: services)
            configuration.setURLSchemeHandler(handler, forURLScheme: RichTextImages.pendingScheme)
            configuration.setURLSchemeHandler(handler, forURLScheme: RichTextImages.serverScheme)
            context.coordinator.images = handler
        }
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        // An image is wrapped in a link of our own, which a long press would otherwise preview as an address.
        view.allowsLinkPreview = false
        view.navigationDelegate = context.coordinator
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        // Every parent re-render (each sync) lands here; only a real change of content reloads the page.
        context.coordinator.onOpenImage = onOpenImage
        guard ready, context.coordinator.loadedHTML != html || context.coordinator.loadedTypeSize != typeSize else { return }
        context.coordinator.loadedHTML = html
        context.coordinator.loadedTypeSize = typeSize
        context.coordinator.images?.serverScheme = serverBase.flatMap { URL(string: $0)?.scheme } ?? "https"
        let body = RichTextImages.rewrite(HTMLSanitizer.sanitize(html), serverBase: serverBase)
        let page = """
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>body{font:-apple-system-body;margin:0;color-scheme:light dark}\
        ul[data-type=taskList]{list-style:none;padding-left:0}img{max-width:100%}\
        a[href^="cria-image:"]{-webkit-tap-highlight-color:transparent}</style>\(body)
        """
        view.loadHTMLString(page, baseURL: nil)
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        var loadedHTML: String?
        var loadedTypeSize: DynamicTypeSize?
        var images: RichTextImageSchemeHandler?
        var onOpenImage: @MainActor (String) -> Void = { _ in }
        private let height: Binding<CGFloat>

        init(height: Binding<CGFloat>) {
            self.height = height
        }

        /// Only our own `loadHTMLString` (about:blank) loads in place. A tapped link opens through `LinkOpener`;
        /// anything else is refused.
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = navigationAction.request.url else { return .cancel }
            if url.scheme == "about" { return .allow }
            if let source = RichTextImages.openedSource(url) {
                onOpenImage(source)
                return .cancel
            }
            if navigationAction.navigationType == .linkActivated, ["http", "https", "mailto"].contains(url.scheme?.lowercased()) {
                LinkOpener.open(url)
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
