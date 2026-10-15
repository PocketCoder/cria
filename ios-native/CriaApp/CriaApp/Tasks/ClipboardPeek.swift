import Foundation
import Observation
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif
import UniformTypeIdentifiers

/// What the clipboard would paste as an attachment, worked out from its type list alone. Reading the contents (or the
/// item providers, which would give a file name) makes iOS ask for permission, so the name is never shown here.
@MainActor @Observable
final class ClipboardPeek {
    struct Content: Equatable {
        /// The type the Paste button asks for.
        let type: UTType
        /// For example "PNG image" or "PDF document, first of 3 items".
        let summary: String
    }

    private(set) var content: Content?
    #if !canImport(UIKit)
    /// The answer for the clipboard as of `changeCount`, shared by every task screen.
    private static var cached: (changeCount: Int, content: Content?) = (-1, nil)
    #endif

    func refresh() {
        #if canImport(UIKit)
        let board = UIPasteboard.general
        let next = board.numberOfItems > 0
            ? Self.content(types: board.types, hasImages: board.hasImages, count: board.numberOfItems)
            : nil
        #else
        // The type list alone: `pasteboardItems` builds an item (and can read an image) for everything copied, on the
        // main thread, every time a task opens.
        // Nothing is read again until the clipboard changes: resolving its types is the slow part, and this runs for
        // every task that opens.
        let board = NSPasteboard.general
        if board.changeCount != Self.cached.changeCount {
            let types = (board.types ?? []).map(\.rawValue)
            Self.cached = (board.changeCount, types.isEmpty ? nil : Self.content(types: types, hasImages: false, count: 1))
        }
        let next = Self.cached.content
        #endif
        if next != content { content = next }
    }

    /// An image wins; otherwise a file, unless the item is text (copied text carries rich-text types that are not
    /// worth attaching). Nil when there is nothing to attach.
    static func content(types: [String], hasImages: Bool, count: Int) -> Content? {
        let candidates = types.compactMap { UTType($0) }
        let hasText = candidates.contains { $0.conforms(to: .text) || $0 == .flatRTFD || $0 == .rtfd }
        let image = candidates.first { $0.conforms(to: .image) }
        let file = hasText ? nil : candidates.first { $0.conforms(to: .data) && !$0.conforms(to: .url) }
        guard let type = image ?? file ?? (hasImages ? UTType.image : nil) else { return nil }
        var summary = type.localizedDescription ?? (type.conforms(to: .image) ? "Image" : "File")
        if count > 1 { summary += ", first of \(count) items" }
        return Content(type: type, summary: summary)
    }
}
