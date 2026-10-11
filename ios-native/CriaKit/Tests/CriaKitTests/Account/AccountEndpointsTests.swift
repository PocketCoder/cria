import XCTest
@testable import CriaKit

final class AccountEndpointsTests: XCTestCase {
    private func client(_ status: Int = 200, _ body: String = "{}") -> (ApiClient, StubTransport) {
        let transport = StubTransport { _, _ in (status, body, ["Content-Type": "application/json"]) }
        return (ApiClient(session: FakeSession(), core: HTTPCore(transport: transport)), transport)
    }

    private func sentJSON(_ request: URLRequest) throws -> [String: String] {
        try XCTUnwrap(request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] })
    }

    func testEmailUsesPostWithNewEmailAndPassword() async throws {
        let (api, transport) = client()
        try await api.updateEmail(newEmail: "a@b.c", password: "pw")
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/user/settings/email")
        XCTAssertEqual(try sentJSON(request), ["new_email": "a@b.c", "password": "pw"])
    }

    func testAvatarProviderRoundTrip() async throws {
        let (api, transport) = client(200, #"{"avatar_provider": "marble"}"#)
        let provider = try await api.avatarProvider()
        XCTAssertEqual(provider, "marble")
        try await api.setAvatarProvider("upload")
        let request = try XCTUnwrap(transport.requests.last)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(try sentJSON(request), ["avatar_provider": "upload"])
    }

    func testAvatarProviderDefaultsWhenMissing() async throws {
        let (api, _) = client(200, "{}")
        let provider = try await api.avatarProvider()
        XCTAssertEqual(provider, "default")
    }

    func testAvatarUploadIsMultipartPutWithAvatarField() async throws {
        let (api, transport) = client()
        try await api.uploadAvatar(fileName: "me.png", mime: "image/png", bytes: Data("png".utf8))
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "PUT")
        XCTAssertEqual(request.url?.path, "/api/v1/user/settings/avatar/upload")
        XCTAssertTrue(header(request, "Content-Type")?.hasPrefix("multipart/form-data; boundary=") ?? false)
        let body = String(decoding: request.httpBody ?? Data(), as: UTF8.self)
        XCTAssertTrue(body.contains(#"name="avatar"; filename="me.png""#))
    }

    func testExportAndDeletionBodies() async throws {
        let (api, transport) = client()
        try await api.requestExport(password: "pw")
        _ = try await api.downloadExport(password: "pw")
        try await api.requestDeletion(password: "pw")
        try await api.cancelDeletion(password: "pw")
        let paths = transport.requests.map { $0.url?.path ?? "" }
        XCTAssertEqual(paths, ["/api/v1/user/export/request", "/api/v1/user/export/download",
                               "/api/v1/user/deletion/request", "/api/v1/user/deletion/cancel"])
        XCTAssertTrue(transport.requests.allSatisfy { $0.httpMethod == "POST" })
        for request in transport.requests { XCTAssertEqual(try sentJSON(request), ["password": "pw"]) }
    }

    func testExportSummaryHidesNoDate() {
        XCTAssertNil(ExportStatus(.object(["created": .string("0001-01-01T00:00:00Z")])).summary)
        let summary = ExportStatus(.object(["created": .string("2026-01-03T10:00:00Z"), "size": .number(2048)])).summary
        XCTAssertTrue(summary?.hasSuffix("(2 KB)") ?? false)
    }
}
