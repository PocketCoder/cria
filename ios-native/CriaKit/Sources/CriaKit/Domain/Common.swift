import Foundation

/// Vikunja serialises "no date" as `0001-01-01T00:00:00Z`. Map it to `nil`.
/// Ported from `normaliseDate` in `src/domain/task.ts`.
public func normaliseDate(_ value: String?) -> String? {
    guard let value, !value.isEmpty else { return nil }
    if value.hasPrefix("0001-01-01") { return nil }
    return value
}

/// Arbitrary JSON, for fields the server types as "unknown" in the Zod schemas.
public enum JSONValue: Decodable, Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }
}
