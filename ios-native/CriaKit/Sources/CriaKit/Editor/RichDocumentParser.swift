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
/// dropped and headings deeper than 3 become 3. The structure HTML nests is kept in each block's `BlockContext`: the
/// blockquotes around it, and whether it is more content of the list item above (a second paragraph, a code block).
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

    private static func isList(_ frame: ParserFrame) -> Bool {
        if case .list = frame { return true }
        return false
    }

    private static func isItem(_ frame: ParserFrame) -> Bool {
        if case .item = frame { return true }
        return false
    }

    private static func isQuote(_ frame: ParserFrame) -> Bool {
        if case .quote = frame { return true }
        return false
    }

    private var listDepth: Int {
        frames.filter(Self.isList).count
    }

    private mutating func emitBlock() {
        append(headingLevel.map(BlockKind.heading) ?? .paragraph, runs: runs)
        runs = []
    }

    /// Adds a block of this natural kind, working out where it sits: the quotes around it, and, inside a list item,
    /// whether it is the item's own text (the first paragraph) or more content of the item.
    private mutating func append(_ natural: BlockKind, runs content: [InlineRun]) {
        var block = Block(kind: natural, runs: content)
        let firstList = frames.firstIndex(where: Self.isList)
        let outer = frames.enumerated().filter { Self.isQuote($0.element) && $0.offset < (firstList ?? frames.count) }.count
        guard let container = frames.lastIndex(where: { Self.isList($0) || Self.isItem($0) }),
              case .item(var state) = frames[container] else {
            // Not inside a list item: a paragraph in a quote is a quote block, anything else keeps its kind.
            if natural == .paragraph, outer > 0 {
                block.kind = .quote
                block.context.quoteLevel = outer > 1 ? outer : 0
            } else {
                block.context.quoteLevel = outer
            }
            blocks.append(block)
            return
        }
        let depth = max(listDepth - 1, 0)
        let insideItemQuote = frames[container...].contains(where: Self.isQuote)
        if !state.used, natural == .paragraph {
            block = Block(kind: state.kind, depth: depth, runs: content, context: BlockContext(quoteLevel: outer))
        } else {
            if !state.used {
                // Content before any paragraph (an image, a heading): the item still needs a block of its own first.
                blocks.append(Block(kind: state.kind, depth: depth, context: BlockContext(quoteLevel: outer)))
            }
            block.depth = depth
            if natural == .paragraph, insideItemQuote { block.kind = .quote }
            block.context = BlockContext(quoteLevel: outer, joinsItem: true)
        }
        state.used = true
        frames[container] = .item(state)
        blocks.append(block)
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
            append(.rule, runs: [])
        case "img":
            flushPending()
            append(.image(image(attributes)), runs: [])
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
        // An item with no paragraph still becomes a block, and text left after its last paragraph is more content.
        if case .item(let state)? = frames.last, !state.used || !runs.isEmpty { emitBlock() }
        _ = frames.popLast()
    }

    private mutating func finishCodeBlock() {
        append(.code, runs: runs)
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
