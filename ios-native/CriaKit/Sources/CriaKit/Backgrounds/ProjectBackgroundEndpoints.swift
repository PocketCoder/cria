import Foundation

/// One Unsplash search result (Vikunja's `background.Image`). Unsplash asks for the photographer to be credited
/// wherever a photo is offered, so the author comes along. Ported from `UnsplashImage` in `src/api/projects.ts`.
public struct UnsplashImage: Equatable, Sendable, Identifiable {
    public let id: String
    public let url: String
    public let thumb: String
    public let blurHash: String?
    /// The photographer's Unsplash username.
    public let author: String?
    /// The photographer's display name.
    public let authorName: String?

    public init(id: String, url: String = "", thumb: String = "", blurHash: String? = nil,
                author: String? = nil, authorName: String? = nil) {
        self.id = id
        self.url = url
        self.thumb = thumb
        self.blurHash = blurHash
        self.author = author
        self.authorName = authorName
    }

    /// Nil when the entry has no string id (it could not be set as a background anyway).
    init?(_ value: JSONValue) {
        guard let id = value["id"]?.stringValue, !id.isEmpty else { return nil }
        let info = value["info"]
        self.init(
            id: id,
            url: value["url"]?.stringValue ?? "",
            thumb: value["thumb"]?.stringValue ?? "",
            blurHash: Self.nonEmpty(value["blur_hash"]?.stringValue),
            author: Self.nonEmpty(info?["author"]?.stringValue),
            authorName: Self.nonEmpty(info?["author_name"]?.stringValue)
        )
    }

    /// The name to credit: the display name, else the username.
    public var credit: String? { authorName ?? author }

    /// The photographer's Unsplash profile, with the referral tags Vikunja-web uses.
    public var authorProfileURL: URL? {
        guard let author,
              let encoded = author.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else { return nil }
        return URL(string: "https://unsplash.com/@\(encoded)?utm_source=vikunja&utm_medium=referral")
    }

    private static func nonEmpty(_ text: String?) -> String? {
        guard let text, !text.isEmpty else { return nil }
        return text
    }
}

/// Project background changes. All online-only: none of them goes through the outbox. Ported from the background
/// functions in `src/api/projects.ts`; routes checked against Vikunja's `pkg/routes/routes.go`.
public extension ApiClient {
    /// `GET /backgrounds/unsplash/search?s=&p=`. Entries without an id are dropped.
    func searchUnsplash(_ query: String, page: Int = 1) async throws -> [UnsplashImage] {
        let results: JSONValue? = try await get("/backgrounds/unsplash/search", query: ["s": query, "p": String(page)])
        return (results?.arrayValue ?? []).compactMap(UnsplashImage.init)
    }

    /// Thumbnail bytes through the server's authenticated proxy (`/backgrounds/unsplash/images/{id}/thumb`; the
    /// generated schema says `image`, the router says `images`).
    func unsplashThumbnail(imageId: String) async throws -> Data {
        let encoded = imageId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? imageId
        let response = try await send(.get, "/backgrounds/unsplash/images/\(encoded)/thumb")
        try response.requireSuccess()
        return response.data
    }

    /// `POST /projects/{id}/backgrounds/unsplash` with the image object. The server looks the photo up by id.
    func setUnsplashBackground(projectId: Int, image: UnsplashImage) async throws {
        let body: JSONBody = ["id": .string(image.id), "url": .string(image.url), "thumb": .string(image.thumb)]
        try await perform(.post, "/projects/\(projectId)/backgrounds/unsplash", body: body)
    }

    /// `PUT /projects/{id}/backgrounds/upload`, multipart with the file in the `background` field. The server sniffs
    /// the bytes and takes JPEG, PNG, GIF, BMP, TIFF and WebP only (no HEIC).
    func uploadProjectBackground(projectId: Int, fileName: String, mime: String, bytes: Data) async throws {
        let boundary = "cria-\(UUID().uuidString)"
        let form = Self.multipartFile(field: "background", fileName: fileName, mime: mime, bytes: bytes, boundary: boundary)
        let response = try await sendAuthorized { base, token in
            var request = try self.buildRequest(.put, url: base + "/projects/\(projectId)/backgrounds/upload",
                                                query: [:], body: nil, token: token)
            request.httpBody = form
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            return request
        }
        try response.requireSuccess()
    }

    /// `DELETE /projects/{id}/background`. Succeeds when the project had none.
    func removeProjectBackground(projectId: Int) async throws {
        try await perform(.delete, "/projects/\(projectId)/background")
    }

    /// A multipart body holding one file.
    static func multipartFile(field: String, fileName: String, mime: String, bytes: Data, boundary: String) -> Data {
        var form = Data()
        let safeName = fileName.replacingOccurrences(of: "\"", with: "_")
        form.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(field)\"; filename=\"\(safeName)\"\r\n".utf8))
        form.append(Data("Content-Type: \(mime)\r\n\r\n".utf8))
        form.append(bytes)
        form.append(Data("\r\n--\(boundary)--\r\n".utf8))
        return form
    }
}
