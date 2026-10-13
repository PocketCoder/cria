import Foundation

/// What Return should do in the current paragraph.
public enum ReturnAction: Equatable, Sendable {
    /// Start a new paragraph of this kind (a list continues, a checked task restarts unchecked).
    case continueWith(BlockKind)
    /// Empty list item or quote: turn it into a plain paragraph instead of adding another.
    case exitToParagraph
    /// Empty nested list item: move it out one level first.
    case outdent
    /// Code block: insert a line break inside the block.
    case lineBreak
}

/// What Backspace should do when the cursor is at the very start of a paragraph.
public enum BackspaceAction: Equatable, Sendable {
    case outdent
    case toParagraph
    /// A plain paragraph: join with the previous one, as the text view does by default.
    case mergeWithPrevious
}

/// Editing rules the text view applies. Pure functions so they are unit tested without a device.
public enum EditorRules {
    public static let maxListDepth = 4

    public static func returnAction(kind: BlockKind, depth: Int, isEmpty: Bool) -> ReturnAction {
        switch kind {
        case .bullet, .ordered, .task:
            if isEmpty { return depth > 0 ? .outdent : .exitToParagraph }
            if case .task = kind { return .continueWith(.task(checked: false)) }
            return .continueWith(kind)
        case .quote:
            return isEmpty ? .exitToParagraph : .continueWith(.quote)
        case .code:
            return .lineBreak
        default:
            return .continueWith(.paragraph)
        }
    }

    public static func backspaceAction(kind: BlockKind, depth: Int) -> BackspaceAction {
        if kind.isListItem, depth > 0 { return .outdent }
        return kind == .paragraph ? .mergeWithPrevious : .toParagraph
    }

    /// The kind after the user taps a block button: tapping the active kind turns it back into a paragraph.
    /// Tasks match each other whatever their checked state.
    public static func toggled(_ current: BlockKind, to target: BlockKind) -> BlockKind {
        sameFamily(current, target) ? .paragraph : target
    }

    public static func indented(depth: Int, kind: BlockKind) -> Int {
        kind.isListItem ? min(depth + 1, maxListDepth) : depth
    }

    public static func outdented(depth: Int) -> Int {
        max(depth - 1, 0)
    }

    /// Converting between list kinds keeps the nesting; leaving lists resets it.
    public static func depth(afterChangingTo kind: BlockKind, from depth: Int) -> Int {
        kind.isListItem ? depth : 0
    }

    /// Number shown beside each ordered item (nil for other blocks). Numbering restarts after any interruption
    /// at that depth and when the list drops to a shallower level and returns.
    public static func listNumbers(for blocks: [Block]) -> [Int?] {
        var counters: [Int] = Array(repeating: 0, count: maxListDepth + 1)
        var result: [Int?] = []
        for block in blocks {
            guard block.kind.isListItem else {
                // More content of an item (a second paragraph, a code block) does not interrupt the numbering.
                if !block.context.joinsItem { counters = Array(repeating: 0, count: maxListDepth + 1) }
                result.append(nil)
                continue
            }
            let depth = min(max(block.depth, 0), maxListDepth)
            if depth < maxListDepth {
                for deeper in (depth + 1)...maxListDepth { counters[deeper] = 0 }
            }
            if block.kind == .ordered {
                counters[depth] += 1
                result.append(counters[depth])
            } else {
                counters[depth] = 0
                result.append(nil)
            }
        }
        return result
    }

    private static func sameFamily(_ first: BlockKind, _ second: BlockKind) -> Bool {
        if case .task = first, case .task = second { return true }
        return first == second
    }
}
