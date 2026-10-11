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
struct RichDocumentWriter {
    private let blocks: [Block]
    private let depths: [Int]
    private var index = 0
    private var output = ""

    init(_ document: RichDocument) {
        blocks = document.blocks
        var normalised: [Int] = []
        var previous = -1
        for block in document.blocks {
            if block.kind.isListItem {
                previous = min(max(block.depth, 0), previous + 1)
                normalised.append(previous)
            } else {
                normalised.append(0)
                previous = -1
            }
        }
        depths = normalised
    }

    mutating func write() -> String {
        while index < blocks.count {
            let block = blocks[index]
            if block.kind.isListItem {
                writeList(depth: 0)
            } else if block.kind == .quote {
                writeQuote()
            } else {
                output += Self.simple(block)
                index += 1
            }
        }
        return output
    }

    // MARK: Containers

    private mutating func writeList(depth: Int) {
        guard let tag = ListTag(blocks[index].kind) else { return }
        output += tag.open
        while index < blocks.count, let kind = ListTag(blocks[index].kind), kind == tag, depths[index] == depth {
            let block = blocks[index]
            index += 1
            output += Self.itemOpen(block.kind) + "<p>" + Self.inline(block.runs) + "</p>"
            while index < blocks.count, blocks[index].kind.isListItem, depths[index] > depth {
                writeList(depth: depth + 1)
            }
            output += Self.itemClose(block.kind)
        }
        output += tag.close
    }

    private mutating func writeQuote() {
        output += "<blockquote>"
        while index < blocks.count, blocks[index].kind == .quote {
            output += "<p>" + Self.inline(blocks[index].runs) + "</p>"
            index += 1
        }
        output += "</blockquote>"
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

    private static func simple(_ block: Block) -> String {
        switch block.kind {
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
