import CriaKit
import SafariServices
import UIKit

/// Opens a link tapped in a description or comment: inside Cria (a Safari view) or in the default browser, as set in
/// Settings > Customise > Dates & tasks. Mail links always go to the system.
@MainActor
enum LinkOpener {
    static func open(_ url: URL) {
        let scheme = url.scheme?.lowercased() ?? ""
        guard PreferencesStore().load().custom.openLinksInApp, scheme == "http" || scheme == "https",
              let top = topViewController() else {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
            return
        }
        top.present(SFSafariViewController(url: url), animated: true)
    }

    private static func topViewController() -> UIViewController? {
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow }
        var top = window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}
