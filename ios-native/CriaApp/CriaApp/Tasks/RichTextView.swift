import CriaKit
import SwiftUI
import WebKit

/// Read-only rendering of a Vikunja description or comment. The HTML goes through `HTMLSanitizer` first and the
/// web view has JavaScript off, so stored markup can never run script.
struct RichTextView: UIViewRepresentable {
    let html: String

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        let body = HTMLSanitizer.sanitize(html)
        let page = """
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>body{font:-apple-system-body;margin:0;color-scheme:light dark}\
        ul[data-type=taskList]{list-style:none;padding-left:0}img{max-width:100%}</style>\(body)
        """
        view.loadHTMLString(page, baseURL: nil)
    }
}
