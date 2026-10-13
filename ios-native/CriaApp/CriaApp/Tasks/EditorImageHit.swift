#if canImport(UIKit)
import CriaKit
import UIKit

extension EditorTextView {
    /// The address of the inline image at `point` (the text view's own coordinates), or nil when the point is not on
    /// one. For opening the full-screen `ImageViewer` from the description editor while it is not being edited.
    func imageSource(at point: CGPoint) -> String? {
        guard textStorage.length > 0 else { return nil }
        let inContainer = CGPoint(x: point.x - textContainerInset.left, y: point.y - textContainerInset.top)
        let index = layoutManager.characterIndex(
            for: inContainer, in: textContainer, fractionOfDistanceBetweenInsertionPoints: nil
        )
        guard index < textStorage.length else { return nil }
        let info = RichDocumentText.blockInfo(from: textStorage.attributes(at: index, effectiveRange: nil))
        guard case .image(let image) = info.kind else { return nil }
        // The nearest character can be a long way from the point; the picture itself must be under it.
        let glyphs = layoutManager.glyphRange(forCharacterRange: NSRange(location: index, length: 1), actualCharacterRange: nil)
        let box = layoutManager.boundingRect(forGlyphRange: glyphs, in: textContainer)
        guard box.insetBy(dx: -4, dy: -4).contains(inContainer) else { return nil }
        return EditorStyling.source(of: image)
    }
}
#endif
