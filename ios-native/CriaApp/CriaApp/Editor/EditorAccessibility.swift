import CriaKit
import Observation
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// What the formatting bar shows as on: the inline styles and block kind at the caret or across the selection.
/// VoiceOver reads these as the buttons' selected state.
@MainActor @Observable
final class EditorBarState {
    var styles: Set<InlineStyle> = []
    var block: BlockKind = .paragraph

    func isOn(_ style: InlineStyle) -> Bool { styles.contains(style) }

    /// True when the current block is `kind`, ignoring a heading's level and a task's tick.
    func isBlock(_ kind: BlockKind) -> Bool {
        switch (block, kind) {
        case (.heading, .heading), (.task, .task): return true
        default: return block == kind
        }
    }
}

extension EditorController {
    /// Re-reads the bar state after the caret, the selection or the text changes.
    func refreshBarState() {
        guard let view = textView else { return }
        let range = view.selection
        let storage = view.storage
        var styles: Set<InlineStyle>
        if range.length == 0 || NSMaxRange(range) > storage.length {
            styles = EditorStyling.styleSet(view.typing[.criaStyles])
        } else {
            // A style counts as on only when every character in the selection has it, as `toggleStyle` decides.
            styles = Set(InlineStyle.allCases)
            storage.enumerateAttribute(.criaStyles, in: range) { value, _, _ in
                styles.formIntersection(EditorStyling.styleSet(value))
            }
        }
        let paragraph = EditorParagraphs.containing(range.location, in: storage)
        let block = paragraph?.kind ?? RichDocumentText.blockInfo(from: view.typing).kind
        if barState.styles != styles { barState.styles = styles }
        if barState.block != block { barState.block = block }
    }
}

extension EditorController {
    /// The text size changed while the editor is open. Fonts are built at a fixed size when styled, so the whole
    /// text is restyled at the new one. Attributes only, so nothing is saved and undo is untouched.
    func restyleForTextSize() {
        guard let view = textView else { return }
        let selection = view.selection
        EditorStyling.restyleAll(view.storage, images: imageProvider)
        let info = RichDocumentText.blockInfo(from: view.typing)
        let styles = EditorStyling.styleSet(view.typing[.criaStyles])
        view.typing = EditorStyling.typingAttributes(
            kind: info.kind, depth: info.depth, styles: styles, context: info.context
        )
        view.selection = selection
        view.refreshMarkers()
    }
}
