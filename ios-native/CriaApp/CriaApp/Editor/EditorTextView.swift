#if canImport(UIKit)
import CriaKit
import UIKit

/// The editor's text view. TextKit 1 is used on purpose: the marker overlay reads line rects from the layout manager.
/// Bullets, numbers, checkboxes, quote bars and rules are drawn by `MarkerOverlay`, not stored in the text.
@MainActor
final class EditorTextView: UITextView {
    private let overlay = MarkerOverlay()
    private var checkboxTap = UITapGestureRecognizer()
    var onToggleTask: ((EditorParagraph) -> Void)?
    /// Backspace with the caret at the very start. Returns false when it handled the key (cleared list formatting).
    var onBackspaceAtStart: (() -> Bool)?
    /// Set by `configureInline`: the height the text needs at the current width, reported when it changes.
    private var onHeightChange: (@MainActor (CGFloat) -> Void)?
    private var reportedHeight: CGFloat = 0
    private var idleTap = UITapGestureRecognizer()
    /// A double tap on the read-only view starts editing with the word selected. Without it the first tap of the
    /// pair started editing with a bare caret, which undid the system's word selection.
    private var idleDoubleTap = UITapGestureRecognizer()
    private let idleTapDelegate = SimultaneousTapDelegate()
    /// The text size changed while the editor is open; the controller restyles at the new size.
    var onContentSizeChange: (() -> Void)?
    /// Set by `RichTextEditor`: an idle tap on an inline image opens it instead of starting to edit.
    var onOpenImage: ((String) -> Void)?

    init() {
        let storage = NSTextStorage()
        let layout = NSLayoutManager()
        let container = NSTextContainer(size: .zero)
        container.widthTracksTextView = true
        layout.addTextContainer(container)
        storage.addLayoutManager(layout)
        super.init(frame: .zero, textContainer: container)
        overlay.host = self
        addSubview(overlay)
        checkboxTap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        addGestureRecognizer(checkboxTap)
        NotificationCenter.default.addObserver(
            self, selector: #selector(contentSizeChanged), name: UIContentSizeCategory.didChangeNotification, object: nil
        )
    }

    @objc private func contentSizeChanged() {
        onContentSizeChange?()
    }

    /// Checkboxes are drawn, not text, so VoiceOver cannot tap them; the caret's task line gets an action instead.
    override var accessibilityCustomActions: [UIAccessibilityCustomAction]? {
        get {
            var actions = super.accessibilityCustomActions ?? []
            let location = selectedRange.location
            if let paragraph = EditorParagraphs.containing(location, in: textStorage), case .task(let checked) = paragraph.kind {
                actions.append(UIAccessibilityCustomAction(name: checked ? "Untick task" : "Tick task") { [weak self] _ in
                    MainActor.assumeIsolated {
                        guard let self, let current = EditorParagraphs.containing(location, in: self.textStorage) else { return }
                        self.onToggleTask?(current)
                    }
                    return true
                })
            }
            return actions
        }
        set { super.accessibilityCustomActions = newValue }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    /// Inline mode (the task screen): no scrolling, the height follows the text, and the view stays read-only until
    /// tapped, so a tap on a link opens it instead of placing the caret.
    func configureInline(onHeightChange: @escaping @MainActor (CGFloat) -> Void) {
        self.onHeightChange = onHeightChange
        isScrollEnabled = false
        alwaysBounceVertical = false
        isEditable = false
        textContainer.lineFragmentPadding = 0
        textContainerInset = UIEdgeInsets(top: 6, left: 0, bottom: 6, right: 0)
        setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        idleDoubleTap = UITapGestureRecognizer(target: self, action: #selector(handleIdleDoubleTap(_:)))
        idleDoubleTap.numberOfTapsRequired = 2
        idleDoubleTap.delegate = idleTapDelegate
        addGestureRecognizer(idleDoubleTap)
        idleTap = UITapGestureRecognizer(target: self, action: #selector(handleIdleTap(_:)))
        idleTap.delegate = idleTapDelegate
        idleTap.require(toFail: idleDoubleTap)
        addGestureRecognizer(idleTap)
    }

    /// Back to read-only once editing ends (inline mode only).
    func endInlineEditing() {
        if onHeightChange != nil { isEditable = false }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        reportHeight()
        // This runs every scroll frame. Redraw only when the overlay's size changes (width or content height);
        // text edits redraw through `refreshMarkers`.
        let size = CGSize(width: max(bounds.width, contentSize.width), height: max(bounds.height, contentSize.height))
        guard overlay.frame.size != size else { return }
        overlay.frame = CGRect(origin: .zero, size: size)
        overlay.setNeedsDisplay()
    }

    override func deleteBackward() {
        if selectedRange == NSRange(location: 0, length: 0), let onBackspaceAtStart, !onBackspaceAtStart() { return }
        super.deleteBackward()
    }

    func refreshMarkers() {
        overlay.setNeedsDisplay()
        reportHeight()
    }

    private func reportHeight() {
        guard onHeightChange != nil, bounds.width > 0 else { return }
        let fitting = ceil(sizeThatFits(CGSize(width: bounds.width, height: .greatestFiniteMagnitude)).height)
        guard abs(fitting - reportedHeight) > 0.5 else { return }
        reportedHeight = fitting
        // Not during this layout pass: the receiver updates SwiftUI state.
        Task { @MainActor [weak self] in self?.onHeightChange?(fitting) }
    }

    /// The http(s) or mailto link under a point, if any.
    private func link(at point: CGPoint) -> URL? {
        guard textStorage.length > 0 else { return nil }
        let inContainer = CGPoint(x: point.x - textContainerInset.left, y: point.y - textContainerInset.top)
        let index = layoutManager.characterIndex(
            for: inContainer, in: textContainer, fractionOfDistanceBetweenInsertionPoints: nil
        )
        guard index < textStorage.length else { return nil }
        // The nearest character can be far from the point (past the end of a short line).
        let glyphs = layoutManager.glyphRange(forCharacterRange: NSRange(location: index, length: 1), actualCharacterRange: nil)
        let box = layoutManager.boundingRect(forGlyphRange: glyphs, in: textContainer)
        guard box.insetBy(dx: -4, dy: -4).contains(inContainer),
              let address = textStorage.attribute(.criaLink, at: index, effectiveRange: nil) as? String,
              let url = URL(string: address),
              ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") else { return nil }
        return url
    }

    @objc private func handleIdleTap(_ gesture: UITapGestureRecognizer) {
        let point = gesture.location(in: self)
        if let url = link(at: point) {
            LinkOpener.open(url)
            return
        }
        if let source = imageSource(at: point), let onOpenImage {
            onOpenImage(source)
            return
        }
        isEditable = true
        becomeFirstResponder()
        if let position = closestPosition(to: point) {
            selectedTextRange = textRange(from: position, to: position)
        }
    }

    @objc private func handleIdleDoubleTap(_ gesture: UITapGestureRecognizer) {
        let point = gesture.location(in: self)
        isEditable = true
        becomeFirstResponder()
        guard let position = closestPosition(to: point) else { return }
        let word = tokenizer.rangeEnclosingPosition(position, with: .word, inDirection: .storage(.forward))
            ?? tokenizer.rangeEnclosingPosition(position, with: .word, inDirection: .storage(.backward))
        selectedTextRange = word ?? textRange(from: position, to: position)
    }

    /// The rect of the first line of a paragraph, in the text view's content coordinates.
    func firstLineRect(of paragraph: EditorParagraph) -> CGRect {
        layoutManager.ensureLayout(for: textContainer)
        let glyph = layoutManager.glyphIndexForCharacter(at: min(paragraph.range.location, max(textStorage.length - 1, 0)))
        let line = layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
        return line.offsetBy(dx: textContainerInset.left, dy: textContainerInset.top)
    }

    /// The rect covering every line of a paragraph (used for the quote bar).
    func fullRect(of paragraph: EditorParagraph) -> CGRect {
        layoutManager.ensureLayout(for: textContainer)
        let glyphs = layoutManager.glyphRange(forCharacterRange: paragraph.range, actualCharacterRange: nil)
        let box = layoutManager.boundingRect(forGlyphRange: glyphs, in: textContainer)
        return box.offsetBy(dx: textContainerInset.left, dy: textContainerInset.top)
    }

    /// The tappable area of a task paragraph's checkbox.
    func checkboxRect(of paragraph: EditorParagraph) -> CGRect {
        let line = firstLineRect(of: paragraph)
        let originX = textContainerInset.left + EditorMetrics.indent * CGFloat(paragraph.depth)
            + EditorMetrics.quoteIndent * CGFloat(paragraph.quoteLevels)
        return CGRect(x: originX, y: line.minY, width: EditorMetrics.indent, height: max(line.height, EditorMetrics.indent))
    }

    private func taskParagraph(at point: CGPoint) -> EditorParagraph? {
        EditorParagraphs.all(in: textStorage).first { paragraph in
            guard case .task = paragraph.kind else { return false }
            return checkboxRect(of: paragraph).insetBy(dx: -6, dy: -6).contains(point)
        }
    }

    @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
        guard let paragraph = taskParagraph(at: gesture.location(in: self)) else { return }
        onToggleTask?(paragraph)
    }

    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        if gestureRecognizer === checkboxTap { return taskParagraph(at: gestureRecognizer.location(in: self)) != nil }
        if gestureRecognizer === idleTap || gestureRecognizer === idleDoubleTap {
            return !isEditable && taskParagraph(at: gestureRecognizer.location(in: self)) == nil
        }
        return super.gestureRecognizerShouldBegin(gestureRecognizer)
    }
}

/// Lets the inline view's tap run alongside the text view's own recognisers.
@MainActor
private final class SimultaneousTapDelegate: NSObject, UIGestureRecognizerDelegate {
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
    ) -> Bool {
        true
    }
}

/// Draws list markers, checkboxes, quote bars and rules over the text.
@MainActor
final class MarkerOverlay: UIView {
    weak var host: EditorTextView?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear
        isOpaque = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func draw(_ rect: CGRect) {
        guard let host else { return }
        let paragraphs = EditorParagraphs.all(in: host.textStorage)
        let numbers = EditorRules.listNumbers(for: paragraphs.map { Block(kind: $0.kind, depth: $0.depth, context: $0.context) })
        for (index, paragraph) in paragraphs.enumerated() {
            let line = host.firstLineRect(of: paragraph)
            guard line.maxY >= rect.minY, line.minY <= rect.maxY else { continue }
            drawMarker(paragraph, number: numbers[index], host: host, line: line)
        }
    }

    private func drawMarker(_ paragraph: EditorParagraph, number: Int?, host: EditorTextView, line: CGRect) {
        let originX = host.textContainerInset.left + EditorMetrics.indent * CGFloat(paragraph.depth)
            + EditorMetrics.quoteIndent * CGFloat(paragraph.quoteLevels)
        drawQuoteBars(paragraph, host: host)
        switch paragraph.kind {
        case .bullet:
            let glyphs = ["\u{2022}", "\u{25E6}", "\u{25AA}"]
            drawText(glyphs[paragraph.depth % glyphs.count], at: CGPoint(x: originX + 8, y: line.minY))
        case .ordered:
            drawText("\(number ?? 1).", at: CGPoint(x: originX + 2, y: line.minY))
        case .task(let checked):
            let name = checked ? "checkmark.square.fill" : "square"
            let image = UIImage(systemName: name)?.withTintColor(host.tintColor, renderingMode: .alwaysOriginal)
            image?.draw(in: CGRect(x: originX + 2, y: line.minY + 2, width: 20, height: 20))
        case .rule:
            UIColor.separator.setStroke()
            let path = UIBezierPath()
            path.move(to: CGPoint(x: host.textContainerInset.left, y: line.midY))
            path.addLine(to: CGPoint(x: bounds.width - host.textContainerInset.right, y: line.midY))
            path.stroke()
        default:
            break
        }
    }

    /// One bar per enclosing blockquote, so a list or code block inside a quote is marked as quoted too.
    private func drawQuoteBars(_ paragraph: EditorParagraph, host: EditorTextView) {
        let levels = paragraph.quoteLevels
        guard levels > 0 else { return }
        let box = host.fullRect(of: paragraph)
        UIColor.separator.setFill()
        for level in 0..<levels {
            let originX = host.textContainerInset.left + 2 + EditorMetrics.quoteIndent * CGFloat(level)
            UIBezierPath(rect: CGRect(x: originX, y: box.minY, width: 3, height: box.height)).fill()
        }
    }

    private func drawText(_ text: String, at point: CGPoint) {
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.preferredFont(forTextStyle: .body),
            .foregroundColor: UIColor.secondaryLabel
        ]
        (text as NSString).draw(at: point, withAttributes: attributes)
    }
}

extension EditorTextView: EditorSurface {
    var storage: NSTextStorage { textStorage }

    var selection: NSRange {
        get { selectedRange }
        set { selectedRange = newValue }
    }

    var typing: [NSAttributedString.Key: Any] {
        get { typingAttributes ?? [:] }
        set { typingAttributes = newValue }
    }

    var holdsKeyboardFocus: Bool { isFirstResponder }

    var isInWindow: Bool { window != nil }

    var editorUndoManager: UndoManager? { undoManager }

    func focus() -> Bool { becomeFirstResponder() }

    func unfocus() { resignFirstResponder() }
}
#endif
