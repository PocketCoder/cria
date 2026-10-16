import AppKit
import CriaKit
import UniformTypeIdentifiers

/// The Mac editor's text view: `NSTextView` on a TextKit 1 stack, driven by the same `EditorController` as the iOS
/// `EditorTextView`. Bullets, numbers, checkboxes, quote bars and rules are drawn over the text, not stored in it.
@MainActor
final class MacEditorTextView: NSTextView, EditorSurface {
    var onToggleTask: ((EditorParagraph) -> Void)?
    var onBackspaceAtStart: (() -> Bool)?
    var onContentSizeChange: (() -> Void)?
    /// An image pasted or dropped: its bytes, a file name and the MIME type.
    var onImageData: ((Data, String, String) -> Void)?
    /// Set for the inline editor, which reports the height its text needs.
    var onHeightChange: (@MainActor (CGFloat) -> Void)?
    private var reportedHeight: CGFloat = 0
    /// A layout manager and a text container do not retain what they point back to, and the view retains only its
    /// container: without these two the storage is freed as soon as `init` returns.
    private let ownedStorage: NSTextStorage
    private let ownedLayout: NSLayoutManager

    init() {
        let storage = NSTextStorage()
        let layout = NSLayoutManager()
        ownedStorage = storage
        ownedLayout = layout
        let container = NSTextContainer(size: NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layout.addTextContainer(container)
        storage.addLayoutManager(layout)
        super.init(frame: .zero, textContainer: container)
        isRichText = true
        allowsUndo = true
        drawsBackground = false
        usesFontPanel = false
        importsGraphics = false
        isAutomaticQuoteSubstitutionEnabled = false
        isAutomaticDashSubstitutionEnabled = false
        isAutomaticLinkDetectionEnabled = false
        isVerticallyResizable = true
        isHorizontallyResizable = false
        autoresizingMask = [.width]
        minSize = .zero
        maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        registerForDraggedTypes([.fileURL, .tiff, .png])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    // MARK: EditorSurface

    var storage: NSTextStorage { ownedStorage }

    var selection: NSRange {
        get { selectedRange() }
        set { setSelectedRange(newValue) }
    }

    var typing: [NSAttributedString.Key: Any] {
        get { typingAttributes }
        set { typingAttributes = newValue }
    }

    var holdsKeyboardFocus: Bool { window?.firstResponder === self }

    var isInWindow: Bool { window != nil }

    var editorUndoManager: UndoManager? { undoManager }

    func focus() -> Bool { window?.makeFirstResponder(self) ?? false }

    func unfocus() { window?.makeFirstResponder(nil) }

    func endInlineEditing() {}

    func refreshMarkers() {
        needsDisplay = true
        reportHeight()
    }

    // MARK: Sizing

    override func layout() {
        super.layout()
        reportHeight()
    }

    override func didChangeText() {
        super.didChangeText()
        reportHeight()
    }

    private func reportHeight() {
        guard onHeightChange != nil, bounds.width > 0, let layout = layoutManager, let container = textContainer else { return }
        layout.ensureLayout(for: container)
        let fitting = ceil(layout.usedRect(for: container).height + textContainerInset.height * 2)
        guard abs(fitting - reportedHeight) > 0.5 else { return }
        reportedHeight = fitting
        // Not during this layout pass: the receiver updates SwiftUI state.
        Task { @MainActor [weak self] in self?.onHeightChange?(fitting) }
    }

    // MARK: Keys and mouse

    override func deleteBackward(_ sender: Any?) {
        if selection == NSRange(location: 0, length: 0), let onBackspaceAtStart, !onBackspaceAtStart() { return }
        super.deleteBackward(sender)
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if let paragraph = taskParagraph(at: point) {
            onToggleTask?(paragraph)
            return
        }
        if event.modifierFlags.contains(.command), let url = link(at: point) {
            LinkOpener.open(url)
            return
        }
        super.mouseDown(with: event)
    }

    /// The http(s) or mailto link under a point, if any.
    private func link(at point: CGPoint) -> URL? {
        guard storage.length > 0, let layout = layoutManager, let container = textContainer else { return nil }
        let inContainer = CGPoint(x: point.x - textContainerOrigin.x, y: point.y - textContainerOrigin.y)
        let index = layout.characterIndex(for: inContainer, in: container, fractionOfDistanceBetweenInsertionPoints: nil)
        guard index < storage.length else { return nil }
        let glyphs = layout.glyphRange(forCharacterRange: NSRange(location: index, length: 1), actualCharacterRange: nil)
        let box = layout.boundingRect(forGlyphRange: glyphs, in: container)
        guard box.insetBy(dx: -4, dy: -4).contains(inContainer),
              let address = storage.attribute(.criaLink, at: index, effectiveRange: nil) as? String,
              let url = URL(string: address),
              ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") else { return nil }
        return url
    }

    // MARK: Images

    override func paste(_ sender: Any?) {
        let board = NSPasteboard.general
        // Text wins when there is any: copied web content carries both text and an image.
        if board.string(forType: .string) == nil, let image = Self.imageData(from: board) {
            onImageData?(image.data, image.name, image.mime)
            return
        }
        super.paste(sender)
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let board = sender.draggingPasteboard
        if let image = Self.imageData(from: board) {
            onImageData?(image.data, image.name, image.mime)
            return true
        }
        return super.performDragOperation(sender)
    }

    private static func imageData(from board: NSPasteboard) -> (data: Data, name: String, mime: String)? {
        let stamp = Int(Date().timeIntervalSince1970)
        if let urls = board.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL],
           let url = urls.first, let type = UTType(filenameExtension: url.pathExtension), type.conforms(to: .image),
           let data = try? Data(contentsOf: url) {
            return (data, url.lastPathComponent, type.preferredMIMEType ?? "image/jpeg")
        }
        if let png = board.data(forType: .png) { return (png, "pasted-\(stamp).png", "image/png") }
        if let tiff = board.data(forType: .tiff), let bitmap = NSBitmapImageRep(data: tiff),
           let png = bitmap.representation(using: .png, properties: [:]) {
            return (png, "pasted-\(stamp).png", "image/png")
        }
        return nil
    }

    // MARK: Layout geometry (the view is flipped, so y grows downward as in UIKit)

    func firstLineRect(of paragraph: EditorParagraph) -> CGRect {
        guard let layout = layoutManager, let container = textContainer else { return .zero }
        layout.ensureLayout(for: container)
        let glyph = layout.glyphIndexForCharacter(at: min(paragraph.range.location, max(storage.length - 1, 0)))
        let line = layout.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
        return line.offsetBy(dx: textContainerOrigin.x, dy: textContainerOrigin.y)
    }

    func fullRect(of paragraph: EditorParagraph) -> CGRect {
        guard let layout = layoutManager, let container = textContainer else { return .zero }
        layout.ensureLayout(for: container)
        let glyphs = layout.glyphRange(forCharacterRange: paragraph.range, actualCharacterRange: nil)
        return layout.boundingRect(forGlyphRange: glyphs, in: container).offsetBy(dx: textContainerOrigin.x, dy: textContainerOrigin.y)
    }

    func checkboxRect(of paragraph: EditorParagraph) -> CGRect {
        let line = firstLineRect(of: paragraph)
        let originX = textContainerOrigin.x + EditorMetrics.indent * CGFloat(paragraph.depth)
            + EditorMetrics.quoteIndent * CGFloat(paragraph.quoteLevels)
        return CGRect(x: originX, y: line.minY, width: EditorMetrics.indent, height: max(line.height, EditorMetrics.indent))
    }

    private func taskParagraph(at point: CGPoint) -> EditorParagraph? {
        EditorParagraphs.all(in: storage).first { paragraph in
            guard case .task = paragraph.kind else { return false }
            return checkboxRect(of: paragraph).insetBy(dx: -6, dy: -6).contains(point)
        }
    }

    // MARK: Markers

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard let layout = layoutManager, let container = textContainer else { return }
        let paragraphs = EditorParagraphs.all(in: storage)
        // Numbers count from the top, so every paragraph is read; only those under the dirty rect are measured and drawn.
        let numbers = EditorRules.listNumbers(for: paragraphs.map { Block(kind: $0.kind, depth: $0.depth, context: $0.context) })
        let inContainer = dirtyRect.offsetBy(dx: -textContainerOrigin.x, dy: -textContainerOrigin.y)
        let glyphs = layout.glyphRange(forBoundingRect: inContainer, in: container)
        let visible = layout.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil)
        let reach = NSRange(location: visible.location, length: visible.length + 1)
        for (index, paragraph) in paragraphs.enumerated() where NSIntersectionRange(paragraph.range, reach).length > 0 {
            drawMarker(paragraph, number: numbers[index], line: firstLineRect(of: paragraph))
        }
    }

    private func drawMarker(_ paragraph: EditorParagraph, number: Int?, line: CGRect) {
        let originX = textContainerOrigin.x + EditorMetrics.indent * CGFloat(paragraph.depth)
            + EditorMetrics.quoteIndent * CGFloat(paragraph.quoteLevels)
        drawQuoteBars(paragraph)
        switch paragraph.kind {
        case .bullet:
            let glyphs = ["\u{2022}", "\u{25E6}", "\u{25AA}"]
            drawText(glyphs[paragraph.depth % glyphs.count], at: CGPoint(x: originX + 8, y: line.minY))
        case .ordered:
            drawText("\(number ?? 1).", at: CGPoint(x: originX + 2, y: line.minY))
        case .task(let checked):
            let image = checked ? Self.checkedBox : Self.emptyBox
            image?.draw(in: CGRect(x: originX + 2, y: line.minY + 2, width: 16, height: 16))
        case .rule:
            NSColor.separatorColor.setStroke()
            let path = NSBezierPath()
            path.move(to: CGPoint(x: textContainerOrigin.x, y: line.midY))
            path.line(to: CGPoint(x: bounds.width - textContainerOrigin.x, y: line.midY))
            path.stroke()
        default:
            break
        }
    }

    /// One bar per enclosing blockquote, so a list or code block inside a quote is marked as quoted too.
    private func drawQuoteBars(_ paragraph: EditorParagraph) {
        let levels = paragraph.quoteLevels
        guard levels > 0 else { return }
        let box = fullRect(of: paragraph)
        NSColor.separatorColor.setFill()
        for level in 0..<levels {
            let originX = textContainerOrigin.x + 2 + EditorMetrics.quoteIndent * CGFloat(level)
            NSBezierPath(rect: CGRect(x: originX, y: box.minY, width: 3, height: box.height)).fill()
        }
    }

    /// Made once rather than on every draw.
    private static let checkedBox = checkbox("checkmark.square.fill")
    private static let emptyBox = checkbox("square")

    private static func checkbox(_ name: String) -> NSImage? {
        let configuration = NSImage.SymbolConfiguration(paletteColors: [.controlAccentColor])
        return NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(configuration)
    }

    private func drawText(_ text: String, at point: CGPoint) {
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.preferredFont(forTextStyle: .body),
            .foregroundColor: NSColor.secondaryLabelColor
        ]
        (text as NSString).draw(at: point, withAttributes: attributes)
    }
}
