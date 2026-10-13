import Foundation

public let defaultPerPage = 50
public let maxPages = 200

public extension ApiClient {
    /// Fetches every page of a list endpoint and returns each item as raw JSON, so the sync layer can
    /// validate items one at a time and store the original payload (`upsert*FromServer(rawJSON:)`).
    /// Page 1 sets the page count (`x-pagination-total-pages`, capped at 200); the rest load concurrently.
    func fetchAllPages(_ path: String, query: [String: String] = [:], perPage: Int = defaultPerPage) async throws -> [Data] {
        @Sendable func page(_ number: Int) async throws -> ApiResponse {
            var params = query
            params["page"] = "\(number)"
            params["per_page"] = "\(perPage)"
            let response = try await send(.get, path, query: params)
            try response.requireSuccess()
            return response
        }
        let first = try await page(1)
        // No page count (a proxy can strip the header): keep reading while pages come back full, as the TypeScript
        // reconcile does. Stopping after page 1 would make reconcile delete every task past it.
        if first.totalPages == 0 {
            var items = try splitJSONArray(first.data)
            var last = items.count
            var number = 1
            while last >= perPage && number < maxPages {
                number += 1
                let next = try splitJSONArray(try await page(number).data)
                items += next
                last = next.count
            }
            return items
        }
        let total = min(first.totalPages, maxPages)
        var responses = [first]
        if total > 1 {
            responses += try await withThrowingTaskGroup(of: (Int, ApiResponse).self) { group in
                for number in 2...total {
                    group.addTask { (number, try await page(number)) }
                }
                var collected: [(Int, ApiResponse)] = []
                for try await result in group { collected.append(result) }
                return collected.sorted { $0.0 < $1.0 }.map(\.1)
            }
        }
        return try responses.flatMap { try splitJSONArray($0.data) }
    }
}

/// Splits a JSON array body into one `Data` per element. An empty or `null` body yields no items.
func splitJSONArray(_ data: Data) throws -> [Data] {
    if data.isEmpty { return [] }
    let parsed = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    if parsed is NSNull { return [] }
    guard let array = parsed as? [Any] else { throw NetworkError("Expected a JSON array") }
    return try array.map { try JSONSerialization.data(withJSONObject: $0, options: [.fragmentsAllowed]) }
}
