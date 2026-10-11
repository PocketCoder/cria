import CriaKit
import SwiftUI
import WebKit

/// Read-only rendering of a Vikunja description or comment. The HTML goes through `HTMLSanitizer` first and the
/// web view has JavaScript off, so stored markup can never run script. It sizes itself to its content.
struct RichTextView: View {
    let html: String
    @State private var height: CGFloat = 28

    var body: some View {
        RichTextWebView(html: html, height: $height).frame(height: height)
    }
}

private struct RichTextWebView: UIViewRepresentable {
    let html: String
    @Binding var height: CGFloat

    func makeCoordinator() -> Coordinator {
        Coordinator(height: $height)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
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

        /// Native evaluation still works with page JavaScript off.
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.evaluateJavaScript("document.documentElement.scrollHeight") { [weak self] result, _ in
                guard let measured = result as? Double, measured > 0 else { return }
                self?.height.wrappedValue = max(28, CGFloat(measured))
            }
        }
    }
}
