import Foundation

public extension NSAttributedString.Key {
    /// Block kind code of the paragraph a character belongs to (see `BlockKind.code`).
    static let criaBlock = NSAttributedString.Key("cria.block")
    /// List nesting depth (Int), set on list item paragraphs.
    static let criaDepth = NSAttributedString.Key("cria.depth")
    /// Comma-joined `InlineStyle` raw values.
    static let criaStyles = NSAttributedString.Key("cria.styles")
    /// Link target (String). The app maps it to the system link style, which lives in UIKit.
    static let criaLink = NSAttributedString.Key("cria.link")
    /// Mention user id (String).
    static let criaMention = NSAttributedString.Key("cria.mention")
    /// JSON of a `RichImage`, set on image paragraphs.
    static let criaImage = NSAttributedString.Key("cria.image")
}

extension BlockKind {
    var code: String {
        switch self {
        case .paragraph: "p"
        case .heading(let level): "h\(level)"
        case .bullet: "ul"
        case .ordered: "ol"
        case .task(let checked): checked ? "task1" : "task0"
        case .quote: "quote"
        case .code: "code"
        case .rule: "rule"
        case .image: "img"
        }
    }

    init(code: String, image: RichImage?) {
        switch code {
        case "h1": self = .heading(1)
        case "h2": self = .heading(2)
        case "h3": self = .heading(3)
        case "ul": self = .bullet
        case "ol": self = .ordered
        case "task0": self = .task(checked: false)
        case "task1": self = .task(checked: true)
        case "quote": self = .quote
        case "code": self = .code
        case "rule": self = .rule
        case "img": self = image.map(BlockKind.image) ?? .paragraph
        default: self = .paragraph
        }
    }
}

/// Maps a `RichDocument` to and from attributed text for the editor's text view. Only semantic attributes are set here
/// (block kind, styles, link, mention, image); the app applies fonts and paragraph styles from them, because fonts
/// need UIKit and this package stays UIKit-free.
///
/// Layout: every block ends with a `\n` terminator that carries the block's attributes, so an empty paragraph keeps
/// its kind. Line breaks inside a block (a `<br>`, or code block newlines) use U+2028. Rules and images are one U+FFFC.
/// A trailing empty paragraph has no characters to carry it and is dropped when reading back.
public enum RichDocumentText {
    static let lineSeparator = "\u{2028}"
    static let objectCharacter = "\u{FFFC}"

    public static func attributedString(from document: RichDocument) -> NSAttributedString {
        let output = NSMutableAttributedString()
        for block in document.blocks { output.append(paragraph(block)) }
        return output
    }

    public static func document(from text: NSAttributedString) -> RichDocument {
        let string = text.string as NSString
        var blocks: [Block] = []
        var start = 0
        while start < string.length {
            let searchRange = NSRange(location: start, length: string.length - start)
            let newline = string.range(of: "\n", range: searchRange)
            let end = newline.location == NSNotFound ? string.length : newline.location
            blocks.append(block(in: text, content: NSRange(location: start, length: end - start), first: start))
            start = end + 1
        }
        return RichDocument(blocks: blocks)
    }

    // MARK: Document to text

    private static func paragraph(_ block: Block) -> NSAttributedString {
        let attributes = blockAttributes(block)
        let result = NSMutableAttributedString()
        switch block.kind {
        case .rule, .image:
            result.append(NSAttributedString(string: objectCharacter, attributes: attributes))
        default:
            for run in block.runs where !run.text.isEmpty {
                let text = run.text.replacingOccurrences(of: "\n", with: lineSeparator)
                let merged = attributes.merging(runAttributes(run)) { _, new in new }
                result.append(NSAttributedString(string: text, attributes: merged))
            }
        }
        result.append(NSAttributedString(string: "\n", attributes: attributes))
        return result
    }

    private static func blockAttributes(_ block: Block) -> [NSAttributedString.Key: Any] {
        var attributes: [NSAttributedString.Key: Any] = [.criaBlock: block.kind.code]
        if block.kind.isListItem { attributes[.criaDepth] = block.depth }
        if case .image(let image) = block.kind,
           let data = try? JSONEncoder().encode(image), let json = String(bytes: data, encoding: .utf8) {
            attributes[.criaImage] = json
        }
        return attributes
    }

    private static func runAttributes(_ run: InlineRun) -> [NSAttributedString.Key: Any] {
        var attributes: [NSAttributedString.Key: Any] = [:]
        if !run.styles.isEmpty { attributes[.criaStyles] = run.styles.map(\.rawValue).sorted().joined(separator: ",") }
        if let link = run.link { attributes[.criaLink] = link }
        if let mention = run.mentionId { attributes[.criaMention] = mention }
        return attributes
    }

    // MARK: Text to document

    private static func block(in text: NSAttributedString, content: NSRange, first: Int) -> Block {
        let attributes = text.attributes(at: first, effectiveRange: nil)
        let code = attributes[.criaBlock] as? String ?? "p"
        var image: RichImage?
        if let json = attributes[.criaImage] as? String {
            image = try? JSONDecoder().decode(RichImage.self, from: Data(json.utf8))
        }
        let kind = BlockKind(code: code, image: image)
        let depth = kind.isListItem ? (attributes[.criaDepth] as? Int ?? 0) : 0
        switch kind {
        case .rule, .image:
            return Block(kind: kind)
        default:
            return Block(kind: kind, depth: depth, runs: runs(in: text, range: content, plain: kind == .code))
        }
    }

    private static func runs(in text: NSAttributedString, range: NSRange, plain: Bool) -> [InlineRun] {
        var result: [InlineRun] = []
        guard range.length > 0 else { return result }
        text.enumerateAttributes(in: range) { attributes, subrange, _ in
            let raw = (text.string as NSString).substring(with: subrange)
            let run = InlineRun(
                text: raw.replacingOccurrences(of: lineSeparator, with: "\n"),
                styles: plain ? [] : styles(attributes[.criaStyles] as? String),
                link: plain ? nil : attributes[.criaLink] as? String,
                mentionId: plain ? nil : attributes[.criaMention] as? String
            )
            append(run, to: &result)
        }
        return result
    }

    private static func append(_ run: InlineRun, to runs: inout [InlineRun]) {
        if var last = runs.last, last.styles == run.styles, last.link == run.link, last.mentionId == run.mentionId {
            last.text += run.text
            runs[runs.count - 1] = last
        } else {
            runs.append(run)
        }
    }

    private static func styles(_ encoded: String?) -> Set<InlineStyle> {
        Set((encoded ?? "").split(separator: ",").compactMap { InlineStyle(rawValue: String($0)) })
    }
}
