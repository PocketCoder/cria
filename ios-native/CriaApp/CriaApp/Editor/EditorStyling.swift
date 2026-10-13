import CriaKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

enum EditorMetrics {
    static let indent: CGFloat = 24
    static let imageMaxWidth: CGFloat = 280
    /// How far each enclosing blockquote shifts the text.
    static let quoteIndent: CGFloat = 16
}

/// Turns the semantic attributes from `RichDocumentText` into fonts, colours and paragraph styles. This is the UIKit
/// half of the editor; `CriaKit` only records meaning (block kind, styles, link, mention).
@MainActor
enum EditorStyling {
    typealias ImageProvider = @MainActor (String) -> PlatformImage?

    static func restyleAll(_ storage: NSMutableAttributedString, images: ImageProvider) {
        for paragraph in EditorParagraphs.all(in: storage) { style(paragraph, in: storage, images: images) }
    }

    static func restyle(_ storage: NSMutableAttributedString, around range: NSRange, images: ImageProvider) {
        for paragraph in EditorParagraphs.intersecting(range, in: storage) { style(paragraph, in: storage, images: images) }
    }

    /// Attributes for text typed into a paragraph of this kind with these inline styles.
    static func typingAttributes(
        kind: BlockKind, depth: Int, styles: Set<InlineStyle>, context: BlockContext = .none
    ) -> [NSAttributedString.Key: Any] {
        var attributes = RichDocumentText.blockAttributes(kind: kind, depth: depth, context: context)
        if !styles.isEmpty { attributes[.criaStyles] = styles.map(\.rawValue).sorted().joined(separator: ",") }
        attributes[.font] = font(kind: kind, styles: styles)
        attributes[.foregroundColor] = color(for: kind)
        attributes[.paragraphStyle] = paragraphStyle(kind: kind, depth: depth, context: context)
        return attributes
    }

    #if canImport(UIKit)
    static func font(kind: BlockKind, styles: Set<InlineStyle>) -> UIFont {
        let base = baseFont(kind)
        var traits = base.fontDescriptor.symbolicTraits
        if styles.contains(.bold) { traits.insert(.traitBold) }
        if styles.contains(.italic) { traits.insert(.traitItalic) }
        if styles.contains(.code) || kind == .code {
            return UIFont.monospacedSystemFont(ofSize: base.pointSize * 0.92, weight: traits.contains(.traitBold) ? .bold : .regular)
        }
        guard let descriptor = base.fontDescriptor.withSymbolicTraits(traits) else { return base }
        return UIFont(descriptor: descriptor, size: base.pointSize)
    }
    #else
    static func font(kind: BlockKind, styles: Set<InlineStyle>) -> NSFont {
        let base = baseFont(kind)
        let bold = styles.contains(.bold) || NSFontManager.shared.traits(of: base).contains(.boldFontMask)
        if styles.contains(.code) || kind == .code {
            return NSFont.monospacedSystemFont(ofSize: base.pointSize * 0.92, weight: bold ? .bold : .regular)
        }
        var font = base
        if styles.contains(.bold) { font = NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask) }
        if styles.contains(.italic) { font = NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask) }
        return font
    }
    #endif

    /// Where an image's bytes come from: `src`, or `data-src` when `src` is only the "#" stand-in Vikunja-web writes.
    static func source(of image: RichImage) -> String {
        guard image.src.isEmpty || image.src == "#", let dataSrc = image.dataSrc, !dataSrc.isEmpty else { return image.src }
        return dataSrc
    }

    static func styleSet(_ encoded: Any?) -> Set<InlineStyle> {
        Set(((encoded as? String) ?? "").split(separator: ",").compactMap { InlineStyle(rawValue: String($0)) })
    }

    // MARK: Paragraphs

    private static func style(_ paragraph: EditorParagraph, in storage: NSMutableAttributedString, images: ImageProvider) {
        let range = paragraph.range
        storage.removeAttribute(.backgroundColor, range: range)
        let layout = paragraphStyle(kind: paragraph.kind, depth: paragraph.depth, context: paragraph.context)
        storage.addAttribute(.paragraphStyle, value: layout, range: range)
        storage.addAttribute(.foregroundColor, value: color(for: paragraph.kind), range: range)
        if paragraph.kind == .code { storage.addAttribute(.backgroundColor, value: PlatformColor.editorFill, range: range) }
        var runs: [(NSRange, [NSAttributedString.Key: Any])] = []
        storage.enumerateAttributes(in: range) { attributes, subrange, _ in runs.append((subrange, attributes)) }
        for (subrange, attributes) in runs { styleRun(attributes, subrange, paragraph.kind, storage) }
        if case .image(let image) = paragraph.kind { attach(image, at: range.location, in: storage, images: images) }
        if paragraph.kind == .rule { storage.addAttribute(.foregroundColor, value: PlatformColor.clear, range: range) }
    }

    private static func styleRun(
        _ attributes: [NSAttributedString.Key: Any], _ range: NSRange, _ kind: BlockKind, _ storage: NSMutableAttributedString
    ) {
        let styles = styleSet(attributes[.criaStyles])
        let isLink = attributes[.criaLink] != nil
        storage.addAttribute(.font, value: font(kind: kind, styles: styles), range: range)
        storage.addAttribute(.underlineStyle, value: styles.contains(.underline) || isLink ? 1 : 0, range: range)
        storage.addAttribute(.strikethroughStyle, value: styles.contains(.strike) ? 1 : 0, range: range)
        if isLink { storage.addAttribute(.foregroundColor, value: PlatformColor.editorTint, range: range) }
        if attributes[.criaMention] != nil {
            storage.addAttribute(.foregroundColor, value: PlatformColor.editorTint, range: range)
            storage.addAttribute(.backgroundColor, value: PlatformColor.editorTint.withAlphaComponent(0.15), range: range)
        } else if styles.contains(.code), kind != .code {
            storage.addAttribute(.backgroundColor, value: PlatformColor.editorFill, range: range)
        }
    }

    private static func attach(_ image: RichImage, at location: Int, in storage: NSMutableAttributedString, images: ImageProvider) {
        let picture = images(source(of: image)) ?? PlatformImage.symbol("photo") ?? PlatformImage()
        let attachment = NSTextAttachment()
        attachment.image = picture
        let width = min(picture.size.width, EditorMetrics.imageMaxWidth)
        let ratio = picture.size.width > 0 ? picture.size.height / picture.size.width : 1
        attachment.bounds = CGRect(x: 0, y: 0, width: width, height: width * ratio)
        storage.addAttribute(.attachment, value: attachment, range: NSRange(location: location, length: 1))
    }

    #if canImport(UIKit)
    private static func baseFont(_ kind: BlockKind) -> UIFont {
        guard case .heading(let level) = kind else { return UIFont.preferredFont(forTextStyle: .body) }
        let style: UIFont.TextStyle = level == 1 ? .title2 : (level == 2 ? .title3 : .headline)
        let font = UIFont.preferredFont(forTextStyle: style)
        guard let bold = font.fontDescriptor.withSymbolicTraits(.traitBold) else { return font }
        return UIFont(descriptor: bold, size: font.pointSize)
    }
    #else
    private static func baseFont(_ kind: BlockKind) -> NSFont {
        guard case .heading(let level) = kind else { return NSFont.preferredFont(forTextStyle: .body) }
        let style: NSFont.TextStyle = level == 1 ? .title2 : (level == 2 ? .title3 : .headline)
        return NSFontManager.shared.convert(NSFont.preferredFont(forTextStyle: style), toHaveTrait: .boldFontMask)
    }
    #endif

    private static func color(for kind: BlockKind) -> PlatformColor {
        kind == .quote ? .editorSecondaryText : .editorText
    }

    private static func paragraphStyle(kind: BlockKind, depth: Int, context: BlockContext) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.paragraphSpacing = 6
        var indent: CGFloat
        switch kind {
        case .bullet, .ordered, .task: indent = EditorMetrics.indent * CGFloat(depth + 1)
        case .code: indent = 8
        default: indent = 0
        }
        // More content of a list item lines up with the item's text.
        if context.joinsItem, !kind.isListItem { indent += EditorMetrics.indent * CGFloat(depth + 1) }
        let quotes = EditorParagraph(range: NSRange(), kind: kind, depth: depth, context: context, isEmpty: true).quoteLevels
        indent += EditorMetrics.quoteIndent * CGFloat(quotes)
        style.firstLineHeadIndent = indent
        style.headIndent = indent
        if kind == .rule { style.minimumLineHeight = 24 }
        return style
    }
}
