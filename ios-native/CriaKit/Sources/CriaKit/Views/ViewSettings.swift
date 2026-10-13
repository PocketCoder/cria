import Foundation

/// A view's filter as Vikunja stores it: a TaskCollection object `{"filter": "...", "filter_include_nulls": false}`
/// (older rows hold a bare query string). Ported from `viewFilterParams` in `src/domain/view.ts` and the form in
/// `ViewFilterForm.tsx`.
public struct ViewFilterParams: Equatable, Sendable {
    public var query: String
    public var includeNulls: Bool

    public init(query: String, includeNulls: Bool) {
        self.query = query
        self.includeNulls = includeNulls
    }

    /// The filter held by a stored value, or nil when there is none (empty, blank query or unreadable JSON).
    public static func parse(_ raw: String?) -> ViewFilterParams? {
        guard let raw, !raw.isEmpty else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("{") else {
            return trimmed.isEmpty ? nil : ViewFilterParams(query: raw, includeNulls: false)
        }
        guard let object = parseJSONObject(trimmed) else { return nil }
        let query = object["filter"] as? String ?? ""
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return ViewFilterParams(query: query, includeNulls: object["filter_include_nulls"] as? Bool ?? false)
    }

    /// The value to store, or nil to clear the filter (a blank query). Keys the form does not show (a timezone or
    /// search term on the filter) are carried over from `previousRaw`, so saving never drops server-side data.
    public static func serialize(query: String, includeNulls: Bool, previousRaw: String?) -> String? {
        let cleaned = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return nil }
        var object = previousRaw.flatMap { parseJSONObject($0.trimmingCharacters(in: .whitespacesAndNewlines)) } ?? [:]
        object["filter"] = cleaned
        object["filter_include_nulls"] = includeNulls
        return jsonObjectText(object)
    }

    /// The parser's message when `query` is not a valid filter, else nil. A blank query is valid (no filter).
    public static func validate(_ query: String, now: Date = Date()) -> String? {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        do {
            _ = try parseFilterQuery(query, now: now)
            return nil
        } catch {
            return String(describing: error)
        }
    }
}

/// One column of a filter-mode board while it is being edited. Ported from `BucketFilterConfig` in `bucketConfig.ts`.
public struct BucketFilterDraft: Equatable, Sendable {
    public var title: String
    public var filter: String
    public var includeNulls: Bool

    public init(title: String = "", filter: String = "", includeNulls: Bool = false) {
        self.title = title
        self.filter = filter
        self.includeNulls = includeNulls
    }
}

public enum BucketConfiguration {
    /// The editable columns held by a view's `bucket_configuration`.
    public static func parse(_ raw: String?) -> [BucketFilterDraft] {
        Kanban.filterConfigs(from: raw).map {
            BucketFilterDraft(title: $0.title, filter: $0.filter, includeNulls: $0.includeNulls)
        }
    }

    /// The JSON to store. Fields the editor does not show (a timezone on a column's filter, say) are carried over
    /// from the entry at the same index in `previousRaw`.
    public static func serialize(_ drafts: [BucketFilterDraft], previousRaw: String?) -> String {
        let previous = rawEntries(previousRaw)
        let entries: [[String: Any]] = drafts.enumerated().map { index, draft in
            var entry = index < previous.count ? previous[index] : [:]
            var filter = entry["filter"] as? [String: Any] ?? [:]
            filter["filter"] = draft.filter.trimmingCharacters(in: .whitespacesAndNewlines)
            filter["filter_include_nulls"] = draft.includeNulls
            entry["title"] = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
            entry["filter"] = filter
            return entry
        }
        guard let data = try? JSONSerialization.data(withJSONObject: entries, options: [.sortedKeys]) else { return "[]" }
        return String(bytes: data, encoding: .utf8) ?? "[]"
    }

    /// A message for the first problem with a filter-mode board's columns, or nil.
    public static func validate(_ drafts: [BucketFilterDraft], now: Date = Date()) -> String? {
        if drafts.isEmpty { return "Add at least one column." }
        for (index, draft) in drafts.enumerated() {
            let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
            if title.isEmpty { return "Column \(index + 1) needs a title." }
            if let problem = ViewFilterParams.validate(draft.filter, now: now) { return "Column \u{201C}\(title)\u{201D}: \(problem)" }
        }
        return nil
    }

    private static func rawEntries(_ raw: String?) -> [[String: Any]] {
        guard let raw, let data = raw.data(using: .utf8),
              let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [Any] else { return [] }
        return parsed.compactMap { $0 as? [String: Any] }
    }
}

private func parseJSONObject(_ text: String) -> [String: Any]? {
    guard let data = text.data(using: .utf8) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
}

private func jsonObjectText(_ object: [String: Any]) -> String? {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return nil }
    return String(bytes: data, encoding: .utf8)
}
