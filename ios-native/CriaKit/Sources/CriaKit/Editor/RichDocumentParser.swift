import Foundation

private struct ItemState {
    var kind: BlockKind
    var used = false
}

private enum ParserFrame {
    case list(BlockKind)
    case item(ItemState)
    case quote
}

/// Builds a `RichDocument` from Vikunja HTML. Forgiving: unknown tags are transparent, whitespace between blocks is
/// dropped, headings deeper than 3 become 3, and extra paragraphs inside one list item become plain paragraphs.
struct RichDocumentParser {
    private var blocks: [Block] = []
    private var runs: [InlineRun] = []
    private var frames: [ParserFrame] = []
    private var styleCounts: [InlineStyle: Int] = [:]
    private var links: [String] = []
    private var mention: String?
    private var headingLevel: Int?
    private var inCodeBlock = false

    static func parse(_ html: String) -> RichDocument {
        var parser = RichDocumentParser()
        var tokenizer = HTMLTokenizer(html)
        for token in tokenizer.tokens() { parser.consume(token) }
        parser.flushPending()
        return RichDocument(blocks: parser.blocks)
    }

    private mutating func consume(_ token: HTMLToken) {
        switch token {
        case .text(let text): addText(HTMLEntities.decode(text))
        case .start(let name, let attributes, _): start(name, attributes)
        case .end(let name): end(name)
        }
    }

    // MARK: Text and runs

    private mutating func addText(_ text: String) {
        if !inCodeBlock, runs.isEmpty, text.allSatisfy(\.isWhitespace) { return }
        // Line breaks in the source are ordinary whitespace outside <pre>; only <br> makes a hard break.
        let collapsed = inCodeBlock ? text : text.replacingOccurrences(of: "[ \\t\\r\\n]+", with: " ", options: .regularExpression)
        appendRun(collapsed)
    }

    private mutating func appendRun(_ text: String) {
        let styles = Set(styleCounts.filter { $0.value > 0 }.keys)
        let run = InlineRun(text: text, styles: styles, link: links.last, mentionId: mention)
        // Two mentions side by side stay two runs, or they would merge into one `@sam@sam` mention.
        if var last = runs.last, mention == nil, last.styles == run.styles, last.link == run.link, last.mentionId == nil {
            last.text += text
            runs[runs.count - 1] = last
        } else {
            runs.append(run)
        }
    }

    // MARK: Blocks

    private var listDepth: Int {
        frames.filter { if case .list = $0 { true } else { false } }.count
    }

    private mutating func takeItemKind() -> BlockKind? {
        guard case .item(var state)? = frames.last, !state.used else { return nil }
        state.used = true
        frames[frames.count - 1] = .item(state)
        return state.kind
    }

    private var inQuote: Bool {
        frames.contains { if case .quote = $0 { true } else { false } }
    }

    private mutating func emitBlock() {
        let kind: BlockKind
        if let level = headingLevel {
            kind = .heading(level)
        } else if let item = takeItemKind() {
            kind = item
        } else {
            kind = inQuote ? .quote : .paragraph
        }
        let depth = kind.isListItem ? max(listDepth - 1, 0) : 0
        blocks.append(Block(kind: kind, depth: depth, runs: runs))
        runs = []
    }

    private mutating func flushPending() {
        if !runs.isEmpty { emitBlock() }
    }

    // MARK: Tags

    private mutating func start(_ name: String, _ attributes: [HTMLAttribute]) {
        if startBlock(name, attributes) { return }
        startInline(name, attributes)
    }

    private mutating func startBlock(_ name: String, _ attributes: [HTMLAttribute]) -> Bool {
        switch name {
        case "p":
            flushPending()
        case "h1", "h2", "h3", "h4", "h5", "h6":
            flushPending()
            headingLevel = min(Int(name.dropFirst()) ?? 1, 3)
        case "ul", "ol":
            flushPending()
            frames.append(.list(listKind(name, attributes)))
        case "li":
            frames.append(.item(ItemState(kind: itemKind(attributes))))
        case "blockquote":
            flushPending()
            frames.append(.quote)
        case "pre":
            flushPending()
            inCodeBlock = true
        case "hr":
            flushPending()
            blocks.append(Block(kind: .rule))
        case "img":
            flushPending()
            blocks.append(Block(kind: .image(image(attributes))))
        default:
            return false
        }
        return true
    }

    private mutating func startInline(_ name: String, _ attributes: [HTMLAttribute]) {
        switch name {
        case "br": if !inCodeBlock { appendRun("\n") }
        case "a": links.append(HTMLEntities.decode(attribute("href", attributes) ?? ""))
        case "mention-user": mention = HTMLEntities.decode(attribute("data-id", attributes) ?? "")
        case "input": markCheckedFromInput(attributes)
        default: if let style = inlineStyle(name) { styleCounts[style, default: 0] += 1 }
        }
    }

    private mutating func end(_ name: String) {
        switch name {
        case "p": emitBlock()
        case "h1", "h2", "h3", "h4", "h5", "h6":
            emitBlock()
            headingLevel = nil
        case "ul", "ol", "blockquote": closeContainer()
        case "li": finishItem()
        case "pre": finishCodeBlock()
        case "a": _ = links.popLast()
        case "mention-user": mention = nil
        default: if let style = inlineStyle(name) { styleCounts[style, default: 0] -= 1 }
        }
    }

    private mutating func closeContainer() {
        flushPending()
        _ = frames.popLast()
    }

    private mutating func finishItem() {
        if case .item(let state)? = frames.last, !state.used { emitBlock() }
        _ = frames.popLast()
    }

    private mutating func finishCodeBlock() {
        blocks.append(Block(kind: .code, runs: runs))
        runs = []
        inCodeBlock = false
    }

    // MARK: Attribute helpers

    private func inlineStyle(_ name: String) -> InlineStyle? {
        switch name {
        case "strong", "b": .bold
        case "em", "i": .italic
        case "u": .underline
        case "s", "strike", "del": .strike
        case "code": inCodeBlock ? nil : .code
        default: nil
        }
    }

    private func attribute(_ name: String, _ attributes: [HTMLAttribute]) -> String? {
        attributes.first { $0.name == name }.map { $0.value ?? "" }
    }

    private func listKind(_ name: String, _ attributes: [HTMLAttribute]) -> BlockKind {
        if name == "ol" { return .ordered }
        return attribute("data-type", attributes) == "taskList" ? .task(checked: false) : .bullet
    }

    private func itemKind(_ attributes: [HTMLAttribute]) -> BlockKind {
        let isTaskItem = attribute("data-type", attributes) == "taskItem" || attribute("data-checked", attributes) != nil
        if isTaskItem { return .task(checked: attribute("data-checked", attributes) == "true") }
        if case .list(let kind)? = frames.last(where: { if case .list = $0 { true } else { false } }) {
            if case .task = kind { return .task(checked: false) }
            return kind
        }
        return .bullet
    }

    private mutating func markCheckedFromInput(_ attributes: [HTMLAttribute]) {
        guard attribute("checked", attributes) != nil, case .item(var state)? = frames.last else { return }
        state.kind = .task(checked: true)
        frames[frames.count - 1] = .item(state)
    }

    private func image(_ attributes: [HTMLAttribute]) -> RichImage {
        RichImage(
            src: HTMLEntities.decode(attribute("src", attributes) ?? ""),
            alt: attribute("alt", attributes).map(HTMLEntities.decode),
            dataSrc: attribute("data-src", attributes).map(HTMLEntities.decode)
        )
    }
}
