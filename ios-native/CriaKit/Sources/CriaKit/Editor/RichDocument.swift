import Foundation

/// Inline formatting a run of text can carry.
public enum InlineStyle: String, CaseIterable, Sendable {
    case bold, italic, underline, strike, code
}

/// A stretch of text with one set of formatting. A mention run carries the user's id; its text is `@name`.
public struct InlineRun: Equatable, Sendable {
    public var text: String
    public var styles: Set<InlineStyle>
    public var link: String?
    public var mentionId: String?

    public init(text: String, styles: Set<InlineStyle> = [], link: String? = nil, mentionId: String? = nil) {
        self.text = text
        self.styles = styles
        self.link = link
        self.mentionId = mentionId
    }
}

/// An inline image. `dataSrc` is the real URL when `src` is a placeholder (the web editor writes both).
public struct RichImage: Equatable, Sendable, Codable {
    public var src: String
    public var alt: String?
    public var dataSrc: String?

    public init(src: String, alt: String? = nil, dataSrc: String? = nil) {
        self.src = src
        self.alt = alt
        self.dataSrc = dataSrc
    }
}

public enum BlockKind: Equatable, Sendable {
    case paragraph
    case heading(Int)
    case bullet
    case ordered
    case task(checked: Bool)
    case quote
    case code
    case rule
    case image(RichImage)

    public var isListItem: Bool {
        switch self {
        case .bullet, .ordered, .task: true
        default: false
        }
    }
}

/// Where a block sits beyond its own kind. The document is a flat list of blocks; this is what keeps the structure
/// HTML can nest around them: blockquotes around anything, and several blocks inside one list item.
public struct BlockContext: Equatable, Sendable {
    /// Blockquotes around the block. A `.quote` block counts as being in one already, so this only needs to be set for
    /// other kinds (a list or a heading inside a quote) or for quotes nested in quotes.
    public var quoteLevel = 0
    /// The block is more content of the list item above it, not a new item: a second paragraph, a code block, an image.
    /// Its `depth` is the item's depth.
    public var joinsItem = false

    public static let none = BlockContext()

    public init(quoteLevel: Int = 0, joinsItem: Bool = false) {
        self.quoteLevel = quoteLevel
        self.joinsItem = joinsItem
    }

    public var isNone: Bool { quoteLevel == 0 && !joinsItem }

    /// Compact text for an attributed-string attribute: "q2", "j", "q1j".
    public var encoded: String {
        (quoteLevel > 0 ? "q\(quoteLevel)" : "") + (joinsItem ? "j" : "")
    }

    public init(encoded: String?) {
        guard let encoded else { self = .none; return }
        let digits = encoded.drop { $0 != "q" }.dropFirst().prefix { $0.isNumber }
        self.init(quoteLevel: Int(digits) ?? 0, joinsItem: encoded.contains("j"))
    }
}

/// One block. `depth` only matters for list items and the blocks that join them (0 is the top level list).
public struct Block: Equatable, Sendable {
    public var kind: BlockKind
    public var depth: Int
    public var runs: [InlineRun]
    public var context: BlockContext

    public init(kind: BlockKind, depth: Int = 0, runs: [InlineRun] = [], context: BlockContext = .none) {
        self.kind = kind
        self.depth = depth
        self.runs = runs
        self.context = context
    }

    public var plainText: String { runs.map(\.text).joined() }

    /// How many blockquotes wrap the block. For a block that joins a list item, a `.quote` is a quote inside the item,
    /// so only the explicit level counts.
    public var effectiveQuoteLevel: Int {
        if kind == .quote, !context.joinsItem { return max(context.quoteLevel, 1) }
        return context.quoteLevel
    }
}

/// The editor's document model. Parses and writes the TipTap HTML that Vikunja stores.
public struct RichDocument: Equatable, Sendable {
    public var blocks: [Block]

    public init(blocks: [Block] = []) {
        self.blocks = blocks
    }

    public init(html: String) {
        self = RichDocumentParser.parse(html)
    }

    /// TipTap-shaped HTML. Heading levels are 1 to 3; deeper source headings were clamped on parse.
    public func html() -> String {
        var writer = RichDocumentWriter(self)
        return writer.write()
    }
}
