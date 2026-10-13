import Foundation

private enum ListTag {
    case bullet, ordered, task

    init?(_ kind: BlockKind) {
        switch kind {
        case .bullet: self = .bullet
        case .ordered: self = .ordered
        case .task: self = .task
        default: return nil
        }
    }

    var open: String {
        switch self {
        case .bullet: "<ul>"
        case .ordered: "<ol>"
        case .task: "<ul data-type=\"taskList\">"
        }
    }

    var close: String { self == .ordered ? "</ol>" : "</ul>" }
}

/// Writes a `RichDocument` as TipTap-shaped HTML (task items, nested lists and mentions in the web editor's form).
/// Blocks are flat; their `BlockContext` says which blockquotes wrap them and which list item they are more content of.
struct RichDocumentWriter {
    private let blocks: [Block]
    private let depths: [Int]
    /// Blockquote levels per block, after resolving blocks that join the item above.
    private let levels: [Int]
    private let joins: [Bool]
    private var index = 0
    private var output = ""

    init(_ document: RichDocument) {
        blocks = document.blocks
        var normalised: [Int] = []
        var joined: [Bool] = []
        var resolved: [Int] = []
        var previous = -1
        for (position, block) in document.blocks.enumerated() {
            if block.kind.isListItem {
                // A list inside a different blockquote level is a new list: it starts at depth 0.
                if position > 0, resolved[position - 1] != block.effectiveQuoteLevel { previous = -1 }
                previous = min(max(block.depth, 0), previous + 1)
                normalised.append(previous)
                joined.append(false)
                resolved.append(block.effectiveQuoteLevel)
            } else if block.context.joinsItem, previous >= 0, position > 0 {
                // More content of the item above: same depth (never deeper than the item) and same quotes.
                previous = min(max(block.depth, 0), previous)
                normalised.append(previous)
                joined.append(true)
                resolved.append(resolved[position - 1])
            } else {
                normalised.append(0)
                joined.append(false)
                resolved.append(block.effectiveQuoteLevel)
                previous = -1
            }
        }
        depths = normalised
        joins = joined
        levels = resolved
    }

    mutating func write() -> String {
        writeSequence(level: 0)
        return output
    }

    // MARK: Containers

    /// Writes blocks while they are at least `level` deep in blockquotes. A deeper block opens a blockquote and
    /// recurses, so quotes around lists, headings and code come out as TipTap writes them.
    private mutating func writeSequence(level: Int) {
        while index < blocks.count, levels[index] >= level {
            if levels[index] > level {
                output += "<blockquote>"
                writeSequence(level: level + 1)
                output += "</blockquote>"
            } else if blocks[index].kind.isListItem {
                let start = index
                writeList(depth: 0, level: level)
                // Never loop on a block the list writer could not take: write it as a paragraph instead.
                if index == start {
                    output += Self.simple(blocks[index], joined: false)
                    index += 1
                }
            } else {
                output += Self.simple(blocks[index], joined: false)
                index += 1
            }
        }
    }

    private mutating func writeList(depth: Int, level: Int) {
        guard let tag = ListTag(blocks[index].kind), depths[index] == depth else { return }
        output += tag.open
        while index < blocks.count, levels[index] == level, let kind = ListTag(blocks[index].kind), kind == tag,
              depths[index] == depth {
            let block = blocks[index]
            index += 1
            output += Self.itemOpen(block.kind) + "<p>" + Self.inline(block.runs) + "</p>"
            writeItemContent(depth: depth, level: level)
            output += Self.itemClose(block.kind)
        }
        output += tag.close
    }

    /// What follows an item's first paragraph: more blocks of the same item and nested lists, in document order.
    private mutating func writeItemContent(depth: Int, level: Int) {
        while index < blocks.count, levels[index] == level {
            if joins[index], depths[index] == depth {
                output += Self.simple(blocks[index], joined: true)
                index += 1
            } else if blocks[index].kind.isListItem, depths[index] > depth {
                let start = index
                writeList(depth: depth + 1, level: level)
                if index == start { break }
            } else {
                break
            }
        }
    }

    private static func itemOpen(_ kind: BlockKind) -> String {
        guard case .task(let checked) = kind else { return "<li>" }
        let box = checked ? "<input type=\"checkbox\" checked=\"checked\">" : "<input type=\"checkbox\">"
        return "<li data-checked=\"\(checked)\" data-type=\"taskItem\"><label>\(box)<span></span></label><div>"
    }

    private static func itemClose(_ kind: BlockKind) -> String {
        if case .task = kind { return "</div></li>" }
        return "</li>"
    }

    // MARK: Leaf blocks and inline runs

    /// A leaf block. `joined` blocks are inside a list item, where a `.quote` block is a blockquote of its own.
    private static func simple(_ block: Block, joined: Bool) -> String {
        switch block.kind {
        case .quote where joined:
            return "<blockquote><p>" + inline(block.runs) + "</p></blockquote>"
        case .heading(let level):
            let tag = "h\(min(max(level, 1), 3))"
            return "<\(tag)>" + inline(block.runs) + "</\(tag)>"
        case .code:
            return "<pre><code>" + HTMLEntities.encode(block.plainText) + "</code></pre>"
        case .rule:
            return "<hr>"
        case .image(let image):
            return imageTag(image)
        default:
            return "<p>" + inline(block.runs) + "</p>"
        }
    }

    private static func imageTag(_ image: RichImage) -> String {
        var tag = "<img src=\"\(HTMLEntities.encodeAttribute(image.src))\""
        if let dataSrc = image.dataSrc { tag += " data-src=\"\(HTMLEntities.encodeAttribute(dataSrc))\"" }
        if let alt = image.alt { tag += " alt=\"\(HTMLEntities.encodeAttribute(alt))\"" }
        return tag + ">"
    }

    private static let styleTags: [(InlineStyle, String)] = [
        (.bold, "strong"), (.italic, "em"), (.underline, "u"), (.strike, "s"), (.code, "code")
    ]

    private static func inline(_ runs: [InlineRun]) -> String {
        runs.map(inlineRun).joined()
    }

    private static func inlineRun(_ run: InlineRun) -> String {
        guard !run.text.isEmpty else { return "" }
        let escaped = HTMLEntities.encode(run.text).replacingOccurrences(of: "\n", with: "<br>")
        if let mention = run.mentionId {
            return "<mention-user data-id=\"\(HTMLEntities.encodeAttribute(mention))\">\(escaped)</mention-user>"
        }
        var result = escaped
        for (style, tag) in styleTags.reversed() where run.styles.contains(style) {
            result = "<\(tag)>\(result)</\(tag)>"
        }
        if let link = run.link {
            result = "<a href=\"\(HTMLEntities.encodeAttribute(link))\" target=\"_blank\" rel=\"noopener noreferrer\">\(result)</a>"
        }
        return result
    }
}
