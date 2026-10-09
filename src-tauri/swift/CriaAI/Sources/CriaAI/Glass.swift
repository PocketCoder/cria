#if os(iOS)
import UIKit
import WebKit
#if canImport(Symbols)
import Symbols
#endif

// iOS 26 Liquid Glass tab bar, laid over the WKWebView (see src-tauri/src/glass.rs).
//
// The web TabBar stays mounted but invisible and is the source of truth: it
// sends its capsule frame (CSS px == points), tabs, active tab, badge, theme
// and whether anything covers it (a sheet or dialog) as JSON on every change.
// Taps come back to the page as a `cria:native-tab` DOM event. Older iOS keeps
// the web capsule, so everything here is gated on iOS 26.

@_cdecl("cria_glass_tabbar_supported")
public func criaGlassTabbarSupported() -> Bool {
    if #available(iOS 26, *) { return true }
    return false
}

/// Main thread only (Rust calls it through `with_webview`).
@_cdecl("cria_glass_tabbar_update")
public func criaGlassTabbarUpdate(_ webView: UnsafeMutableRawPointer, _ json: UnsafePointer<CChar>) {
    guard #available(iOS 26, *) else { return }
    let view = Unmanaged<WKWebView>.fromOpaque(webView).takeUnretainedValue()
    guard let state = try? JSONDecoder().decode(TabBarState.self, from: Data(String(cString: json).utf8))
    else { return }
    MainActor.assumeIsolated {
        GlassTabBar.shared.apply(state, in: view)
    }
}

struct TabBarState: Decodable {
    struct Frame: Decodable {
        let x: Double
        let y: Double
        let width: Double
        let height: Double
    }
    struct Tab: Decodable {
        let key: String
        let label: String
        /// SF Symbol name.
        let symbol: String
        let active: Bool
        let badge: String?
    }
    let visible: Bool
    let dark: Bool
    let frame: Frame
    let tabs: [Tab]
}

@available(iOS 26, *)
@MainActor
final class GlassTabBar {
    static let shared = GlassTabBar()

    private weak var webView: WKWebView?
    private var bar: UIVisualEffectView?
    private var stack: UIStackView?
    private var buttons: [String: UIButton] = [:]
    private var badges: [String: UILabel] = [:]
    private var keys: [String] = []
    private var activeKey: String?

    func apply(_ state: TabBarState, in webView: WKWebView) {
        self.webView = webView
        let bar = self.bar ?? makeBar(in: webView)
        bar.isHidden = !state.visible
        guard state.visible else { return }

        bar.overrideUserInterfaceStyle = state.dark ? .dark : .light
        bar.frame = CGRect(x: state.frame.x, y: state.frame.y, width: state.frame.width, height: state.frame.height)
        bar.layer.cornerRadius = state.frame.height / 2

        let newKeys = state.tabs.map(\.key)
        if newKeys != keys { rebuild(state.tabs) }

        // Design system: the active tab is Llama purple (lighter in dark mode),
        // the rest secondary label grey.
        let purple = state.dark
            ? UIColor(red: 0xA3 / 255, green: 0x7F / 255, blue: 0xDE / 255, alpha: 1)
            : UIColor(red: 0x64 / 255, green: 0x3B / 255, blue: 0x9F / 255, alpha: 1)
        let onPurple = state.dark ? UIColor(red: 0x13 / 255, green: 0x0A / 255, blue: 0x20 / 255, alpha: 1) : .white

        var newlyActive: String?
        for tab in state.tabs {
            guard let button = buttons[tab.key] else { continue }
            var config = button.configuration ?? .plain()
            config.title = tab.label
            config.image = UIImage(
                systemName: tab.symbol,
                withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .medium)
            )
            config.baseForegroundColor = tab.active ? purple : .secondaryLabel
            button.configuration = config
            button.accessibilityLabel = tab.label
            button.accessibilityTraits = tab.active ? [.button, .selected] : .button

            if let badge = badges[tab.key] {
                badge.text = tab.badge
                badge.isHidden = tab.badge == nil
                badge.backgroundColor = purple
                badge.textColor = onPurple
            }
            if tab.active { newlyActive = tab.key }
        }

        // The active icon hops when the tab changes (the web tab bar's
        // cria-hop, as a native symbol bounce).
        if let key = newlyActive, key != activeKey, activeKey != nil,
           !UIAccessibility.isReduceMotionEnabled {
            buttons[key]?.imageView?.addSymbolEffect(.bounce)
        }
        activeKey = newlyActive
    }

    private func makeBar(in webView: WKWebView) -> UIVisualEffectView {
        let effect = UIGlassEffect()
        effect.isInteractive = true
        let bar = UIVisualEffectView(effect: effect)
        bar.clipsToBounds = true
        bar.layer.cornerCurve = .continuous

        let stack = UIStackView()
        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false
        bar.contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: bar.contentView.leadingAnchor, constant: 8),
            stack.trailingAnchor.constraint(equalTo: bar.contentView.trailingAnchor, constant: -8),
            stack.topAnchor.constraint(equalTo: bar.contentView.topAnchor, constant: 4),
            stack.bottomAnchor.constraint(equalTo: bar.contentView.bottomAnchor, constant: -4),
        ])

        // Above WKWebView's scroll view, so it floats over the page.
        webView.addSubview(bar)
        self.bar = bar
        self.stack = stack
        return bar
    }

    private func rebuild(_ tabs: [TabBarState.Tab]) {
        guard let stack else { return }
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        buttons = [:]
        badges = [:]
        keys = tabs.map(\.key)

        for tab in tabs {
            var config = UIButton.Configuration.plain()
            config.imagePlacement = .top
            config.imagePadding = 2
            config.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0)
            config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attrs in
                var attrs = attrs
                attrs.font = UIFont.systemFont(ofSize: 10, weight: .medium)
                return attrs
            }
            let key = tab.key
            let button = UIButton(
                configuration: config,
                primaryAction: UIAction { [weak self] _ in
                    MainActor.assumeIsolated { self?.send(key) }
                }
            )

            let badge = UILabel()
            badge.font = UIFont.systemFont(ofSize: 9, weight: .semibold)
            badge.textAlignment = .center
            badge.layer.cornerRadius = 7
            badge.layer.masksToBounds = true
            badge.isHidden = true
            badge.translatesAutoresizingMaskIntoConstraints = false
            button.addSubview(badge)
            NSLayoutConstraint.activate([
                badge.topAnchor.constraint(equalTo: button.topAnchor, constant: 2),
                badge.centerXAnchor.constraint(equalTo: button.centerXAnchor, constant: 14),
                badge.heightAnchor.constraint(equalToConstant: 14),
                badge.widthAnchor.constraint(greaterThanOrEqualToConstant: 16),
            ])

            stack.addArrangedSubview(button)
            buttons[key] = button
            badges[key] = badge
        }
    }

    /// Hand the tap to the page. Keys come from our own tab list; anything
    /// else is dropped rather than interpolated into script.
    private func send(_ key: String) {
        guard key.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }) else { return }
        UISelectionFeedbackGenerator().selectionChanged()
        webView?.evaluateJavaScript(
            "window.dispatchEvent(new CustomEvent('cria:native-tab', { detail: '\(key)' }))",
            completionHandler: nil
        )
    }
}
#endif
