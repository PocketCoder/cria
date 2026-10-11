import CriaKit
import UIKit

/// The editor's text view. TextKit 1 is used on purpose: the marker overlay reads line rects from the layout manager.
/// Bullets, numbers, checkboxes, quote bars and rules are drawn by `MarkerOverlay`, not stored in the text.
@MainActor
final class EditorTextView: UITextView {
    private let overlay = MarkerOverlay()
    private var checkboxTap = UITapGestureRecognizer()
    var onToggleTask: ((EditorParagraph) -> Void)?

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
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        overlay.frame = CGRect(x: 0, y: 0, width: max(bounds.width, contentSize.width), height: max(bounds.height, contentSize.height))
        overlay.setNeedsDisplay()
    }

    func refreshMarkers() {
        overlay.setNeedsDisplay()
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
        return super.gestureRecognizerShouldBegin(gestureRecognizer)
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
        let numbers = EditorRules.listNumbers(for: paragraphs.map { Block(kind: $0.kind, depth: $0.depth) })
        for (index, paragraph) in paragraphs.enumerated() {
            let line = host.firstLineRect(of: paragraph)
            guard line.maxY >= rect.minY, line.minY <= rect.maxY else { continue }
            drawMarker(paragraph, number: numbers[index], host: host, line: line)
        }
    }

    private func drawMarker(_ paragraph: EditorParagraph, number: Int?, host: EditorTextView, line: CGRect) {
        let originX = host.textContainerInset.left + EditorMetrics.indent * CGFloat(paragraph.depth)
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
        case .quote:
            let box = host.fullRect(of: paragraph)
            UIColor.separator.setFill()
            UIBezierPath(rect: CGRect(x: host.textContainerInset.left + 2, y: box.minY, width: 3, height: box.height)).fill()
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

    private func drawText(_ text: String, at point: CGPoint) {
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.preferredFont(forTextStyle: .body),
            .foregroundColor: UIColor.secondaryLabel
        ]
        (text as NSString).draw(at: point, withAttributes: attributes)
    }
}
