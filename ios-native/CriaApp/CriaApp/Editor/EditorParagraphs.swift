import CriaKit
import Foundation

/// One paragraph of the editor's text: its range (including the `\n` terminator), kind and list depth.
struct EditorParagraph: Equatable {
    let range: NSRange
    let kind: BlockKind
    let depth: Int
    /// The quotes around it, and whether it is more content of the list item above.
    var context = BlockContext.none
    /// No characters besides the terminator.
    let isEmpty: Bool

    /// Blockquotes around the paragraph, counting a quote inside a list item.
    var quoteLevels: Int {
        let block = Block(kind: kind, depth: depth, context: context)
        return block.effectiveQuoteLevel + (kind == .quote && context.joinsItem ? 1 : 0)
    }
}

/// Splits the editor text into paragraphs using the attributes `RichDocumentText` writes.
enum EditorParagraphs {
    static func all(in text: NSAttributedString) -> [EditorParagraph] {
        let string = characters(of: text)
        var result: [EditorParagraph] = []
        var location = 0
        while location < string.length {
            let range = string.paragraphRange(for: NSRange(location: location, length: 0))
            result.append(paragraph(in: text, string: string, range: range))
            location = range.location + max(range.length, 1)
        }
        return result
    }

    /// The paragraph a caret at `location` sits in. A caret after a final terminator (or in empty text) has none yet.
    static func containing(_ location: Int, in text: NSAttributedString) -> EditorParagraph? {
        let string = characters(of: text)
        guard string.length > 0 else { return nil }
        if location >= string.length {
            guard string.character(at: string.length - 1) != 10 else { return nil }
            let range = string.paragraphRange(for: NSRange(location: string.length - 1, length: 0))
            return paragraph(in: text, string: string, range: range)
        }
        return paragraph(in: text, string: string, range: string.paragraphRange(for: NSRange(location: max(location, 0), length: 0)))
    }

    /// Every paragraph touched by a selection.
    static func intersecting(_ selection: NSRange, in text: NSAttributedString) -> [EditorParagraph] {
        all(in: text).filter { paragraph in
            if selection.length == 0 { return NSLocationInRange(selection.location, paragraph.range) }
            return NSIntersectionRange(paragraph.range, selection).length > 0
        }
    }

    /// The characters without a copy where possible: `string` on a text view's storage copies the whole text, which
    /// done once per paragraph made a scan cost paragraphs times length.
    private static func characters(of text: NSAttributedString) -> NSString {
        (text as? NSMutableAttributedString)?.mutableString ?? (text.string as NSString)
    }

    private static func paragraph(in text: NSAttributedString, string: NSString, range: NSRange) -> EditorParagraph {
        let info = RichDocumentText.blockInfo(from: text.attributes(at: range.location, effectiveRange: nil))
        let endsWithNewline = range.length > 0 && string.character(at: range.location + range.length - 1) == 10
        let contentLength = range.length - (endsWithNewline ? 1 : 0)
        return EditorParagraph(range: range, kind: info.kind, depth: info.depth, context: info.context, isEmpty: contentLength == 0)
    }
}
