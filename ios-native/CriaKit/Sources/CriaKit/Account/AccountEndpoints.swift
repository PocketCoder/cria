import Foundation

/// Request bodies for the account endpoints, kept pure so tests can pin the wire format.
public enum AccountRequests {
    public static func passwordOnly(_ password: String) -> JSONBody { ["password": .string(password)] }

    public static func email(newEmail: String, password: String) -> JSONBody {
        ["new_email": .string(newEmail), "password": .string(password)]
    }

    public static func enableTotp(passcode: String) -> JSONBody { ["passcode": .string(passcode)] }

    public static func avatarProvider(_ provider: String) -> JSONBody { ["avatar_provider": .string(provider)] }
}

/// Avatar sources, in the order `AccountTab.tsx` lists them.
public enum AvatarProvider: String, CaseIterable, Sendable {
    case standard = "default"
    case initials, gravatar, marble, upload

    public var title: String {
        switch self {
        case .standard: "Default"
        case .initials: "Initials"
        case .gravatar: "Gravatar"
        case .marble: "Marble"
        case .upload: "Upload"
        }
    }
}

/// Last data export, from `GET /user/export`.
public struct ExportStatus: Equatable, Sendable {
    public let created: String?
    public let size: Int?

    init(_ row: JSONValue) {
        created = normaliseDate(row["created"]?.stringValue)
        size = row["size"]?.intValue
    }

    /// "Last export: 3 Jan 2026 (12 KB)", or nil when nothing was exported yet.
    public var summary: String? {
        guard let created else { return nil }
        let day = SessionDates.parse(created).map { $0.formatted(date: .abbreviated, time: .omitted) } ?? created
        let kilobytes = (size ?? 0) > 0 ? " (\((size ?? 0) / 1024) KB)" : ""
        return "Last export: \(day)\(kilobytes)"
    }
}

public enum SessionDates {
    public static func parse(_ value: String) -> Date? {
        let plain = ISO8601DateFormatter()
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return plain.date(from: value) ?? fractional.date(from: value)
    }
}

public extension ApiClient {
    // MARK: Avatar

    func avatarProvider() async throws -> String {
        let row: JSONValue = try await get("/user/settings/avatar")
        return row["avatar_provider"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? AvatarProvider.standard.rawValue
    }

    func setAvatarProvider(_ provider: String) async throws {
        try await perform(.post, "/user/settings/avatar", body: AccountRequests.avatarProvider(provider))
    }

    /// Image bytes for the user's current avatar.
    func avatarData(username: String) async throws -> Data {
        let response = try await avatarResponse(username: username)
        try response.requireSuccess()
        return response.data
    }

    /// `PUT /user/settings/avatar/upload`, multipart with the file in the `avatar` field.
    func uploadAvatar(fileName: String, mime: String, bytes: Data) async throws {
        let boundary = "cria-\(UUID().uuidString)"
        var form = Data()
        let safeName = fileName.replacingOccurrences(of: "\"", with: "_")
        form.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"avatar\"; filename=\"\(safeName)\"\r\n".utf8))
        form.append(Data("Content-Type: \(mime)\r\n\r\n".utf8))
        form.append(bytes)
        form.append(Data("\r\n--\(boundary)--\r\n".utf8))
        let response = try await sendAuthorized { base, token in
            var request = try self.buildRequest(.put, url: base + "/user/settings/avatar/upload", query: [:], body: nil, token: token)
            request.httpBody = form
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            return request
        }
        try response.requireSuccess()
    }

    // MARK: Email

    func updateEmail(newEmail: String, password: String) async throws {
        try await perform(.post, "/user/settings/email", body: AccountRequests.email(newEmail: newEmail, password: password))
    }

    // MARK: Export and deletion

    func exportStatus() async throws -> ExportStatus {
        ExportStatus(try await get("/user/export") as JSONValue)
    }

    func requestExport(password: String) async throws {
        try await perform(.post, "/user/export/request", body: AccountRequests.passwordOnly(password))
    }

    /// The export ZIP.
    func downloadExport(password: String) async throws -> Data {
        let response = try await send(.post, "/user/export/download", body: AccountRequests.passwordOnly(password))
        try response.requireSuccess()
        return response.data
    }

    func requestDeletion(password: String) async throws {
        try await perform(.post, "/user/deletion/request", body: AccountRequests.passwordOnly(password))
    }

    func cancelDeletion(password: String) async throws {
        try await perform(.post, "/user/deletion/cancel", body: AccountRequests.passwordOnly(password))
    }
}

/// A CalDAV app password (`/user/settings/token/caldav`). The token text is only returned once, on create.
public struct CaldavToken: Equatable, Sendable, Identifiable {
    public let id: Int
    public let token: String?
    public let created: String?

    init?(_ value: JSONValue) {
        guard let id = value["id"]?.intValue else { return nil }
        self.id = id
        token = value["token"]?.stringValue
        created = value["created"]?.stringValue
    }
}

public extension ApiClient {
    func caldavTokens() async throws -> [CaldavToken] {
        let rows: JSONValue = try await get("/user/settings/token/caldav")
        guard case .array(let items) = rows else { return [] }
        return items.compactMap(CaldavToken.init)
    }

    func createCaldavToken() async throws -> CaldavToken {
        let row: JSONValue = try await put("/user/settings/token/caldav")
        guard let token = CaldavToken(row) else { throw NetworkError("Unexpected CalDAV token response") }
        return token
    }

    func deleteCaldavToken(id: Int) async throws {
        try await perform(.delete, "/user/settings/token/caldav/\(id)")
    }
}
