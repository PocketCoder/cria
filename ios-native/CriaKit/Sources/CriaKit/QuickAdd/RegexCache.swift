import Foundation

/// Compiled regular expressions, kept by pattern and options. The quick-add parsers run on every keystroke and used
/// to recompile the same patterns each time.
enum RegexCache {
    private nonisolated(unsafe) static var store: [String: NSRegularExpression] = [:]
    private static let lock = NSLock()

    static func regex(_ pattern: String, options: NSRegularExpression.Options = []) -> NSRegularExpression? {
        let key = "\(options.rawValue)|\(pattern)"
        return lock.withLock {
            if let hit = store[key] { return hit }
            guard let made = try? NSRegularExpression(pattern: pattern, options: options) else { return nil }
            store[key] = made
            return made
        }
    }
}
