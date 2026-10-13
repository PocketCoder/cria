import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// One name for the platform's image, colour and font types, so shared views need no `#if`.
#if canImport(UIKit)
typealias PlatformImage = UIImage
typealias PlatformColor = UIColor
typealias PlatformFont = UIFont
#else
typealias PlatformImage = NSImage
typealias PlatformColor = NSColor
typealias PlatformFont = NSFont
#endif

extension Image {
    init(platformImage: PlatformImage) {
        #if canImport(UIKit)
        self.init(uiImage: platformImage)
        #else
        self.init(nsImage: platformImage)
        #endif
    }
}

extension Color {
    /// The colour as sRGB components, each 0 to 1. Nil when it has no sRGB form.
    func srgbComponents() -> (red: CGFloat, green: CGFloat, blue: CGFloat, alpha: CGFloat)? {
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        #if canImport(UIKit)
        guard UIColor(self).getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return nil }
        #else
        guard let converted = NSColor(self).usingColorSpace(.sRGB) else { return nil }
        converted.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        #endif
        return (red, green, blue, alpha)
    }
}

extension PlatformImage {
    /// Pixels per point: the screen scale on iOS, 1 on the Mac (an `NSImage` size is already in pixels here).
    var pixelScale: CGFloat {
        #if canImport(UIKit)
        scale
        #else
        1
        #endif
    }

    /// A copy scaled to `size`, decoded ready to draw. Nil when it cannot be made.
    func thumbnail(of size: CGSize) -> PlatformImage? {
        #if canImport(UIKit)
        preparingThumbnail(of: size)
        #else
        let result = NSImage(size: size)
        result.lockFocus()
        draw(in: NSRect(origin: .zero, size: size), from: .zero, operation: .copy, fraction: 1)
        result.unlockFocus()
        return result
        #endif
    }

    /// PNG bytes of the image. Nil when it cannot be encoded.
    func pngRepresentation() -> Data? {
        #if canImport(UIKit)
        pngData()
        #else
        guard let tiff = tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) else { return nil }
        return bitmap.representation(using: .png, properties: [:])
        #endif
    }
}

enum Pasteboard {
    /// Posted when the clipboard changes. Only iOS announces it; the Mac has no such notification.
    static var changedNotification: Notification.Name {
        #if canImport(UIKit)
        UIPasteboard.changedNotification
        #else
        Notification.Name("io.cria.pasteboard.changed")
        #endif
    }

    static func copy(_ text: String) {
        #if canImport(UIKit)
        UIPasteboard.general.string = text
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }

    static func image() -> PlatformImage? {
        #if canImport(UIKit)
        UIPasteboard.general.image
        #else
        NSImage(pasteboard: NSPasteboard.general)
        #endif
    }
}

enum ExternalLink {
    @MainActor
    static func open(_ url: URL) {
        #if canImport(UIKit)
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
        #else
        NSWorkspace.shared.open(url)
        #endif
    }

    /// The system settings page for this app, or for notifications where the system has one.
    @MainActor
    static func openAppSettings() {
        #if canImport(UIKit)
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
        #else
        guard let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") else { return }
        NSWorkspace.shared.open(url)
        #endif
    }

    @MainActor
    static func openNotificationSettings() {
        #if canImport(UIKit)
        guard let url = URL(string: UIApplication.openNotificationSettingsURLString) else { return }
        UIApplication.shared.open(url)
        #else
        openAppSettings()
        #endif
    }
}

enum PlatformApp {
    /// Has VoiceOver speak a short message.
    @MainActor
    static func announce(_ message: String) {
        #if canImport(UIKit)
        UIAccessibility.post(notification: .announcement, argument: message)
        #else
        NSAccessibility.post(
            element: NSApplication.shared, notification: .announcementRequested,
            userInfo: [.announcement: message, .priority: NSAccessibilityPriorityLevel.high.rawValue]
        )
        #endif
    }

    /// True while the app is in the foreground.
    @MainActor
    static var isActive: Bool {
        #if canImport(UIKit)
        UIApplication.shared.applicationState == .active
        #else
        NSApplication.shared.isActive
        #endif
    }

    /// Posted when the app comes to the foreground.
    static var didBecomeActive: Notification.Name {
        #if canImport(UIKit)
        UIApplication.didBecomeActiveNotification
        #else
        NSApplication.didBecomeActiveNotification
        #endif
    }
}
