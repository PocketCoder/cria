import Foundation
import CriaKit
#if canImport(UIKit)
import SafariServices
import UIKit
#endif

/// Opens a link tapped in a description or comment: inside Cria (a Safari view) or in the default browser, as set in
/// Settings > Customise > Dates & tasks. Mail links always go to the system. On macOS every link opens in the browser.
@MainActor
enum LinkOpener {
    static func open(_ url: URL) {
        #if canImport(UIKit)
        let scheme = url.scheme?.lowercased() ?? ""
        guard PreferencesStore().load().custom.openLinksInApp, scheme == "http" || scheme == "https",
              let top = topViewController() else {
            ExternalLink.open(url)
            return
        }
        top.present(SFSafariViewController(url: url), animated: true)
        #else
        ExternalLink.open(url)
        #endif
    }

    #if canImport(UIKit)
    private static func topViewController() -> UIViewController? {
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow }
        var top = window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
    #endif
}
