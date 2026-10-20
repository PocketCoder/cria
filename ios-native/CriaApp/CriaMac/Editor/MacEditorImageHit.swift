import AppKit
import CriaKit

extension MacEditorTextView {
    /// The address of the inline image at `point` (the text view's own coordinates), or nil when the point is not on
    /// one. The Mac counterpart of `EditorTextView.imageSource(at:)`: a click on a picture opens it full size.
    func imageSource(at point: CGPoint) -> String? {
        guard storage.length > 0, let layout = layoutManager, let container = textContainer else { return nil }
        let inContainer = CGPoint(x: point.x - textContainerOrigin.x, y: point.y - textContainerOrigin.y)
        let index = layout.characterIndex(for: inContainer, in: container, fractionOfDistanceBetweenInsertionPoints: nil)
        guard index < storage.length else { return nil }
        let info = RichDocumentText.blockInfo(from: storage.attributes(at: index, effectiveRange: nil))
        guard case .image(let image) = info.kind else { return nil }
        // The nearest character can be a long way from the point; the picture itself must be under it.
        let glyphs = layout.glyphRange(forCharacterRange: NSRange(location: index, length: 1), actualCharacterRange: nil)
        let box = layout.boundingRect(forGlyphRange: glyphs, in: container)
        guard box.insetBy(dx: -4, dy: -4).contains(inContainer) else { return nil }
        return EditorStyling.source(of: image)
    }
}
