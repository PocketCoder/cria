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

/// One block. `depth` only matters for list items (0 is the top level list).
public struct Block: Equatable, Sendable {
    public var kind: BlockKind
    public var depth: Int
    public var runs: [InlineRun]

    public init(kind: BlockKind, depth: Int = 0, runs: [InlineRun] = []) {
        self.kind = kind
        self.depth = depth
        self.runs = runs
    }

    public var plainText: String { runs.map(\.text).joined() }
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
