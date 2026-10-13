import XCTest
@testable import CriaKit

final class ProjectBackgroundEndpointsTests: XCTestCase {
    private func client(_ status: Int = 200, _ body: String = "{}",
                        type: String = "application/json") -> (ApiClient, StubTransport) {
        let transport = StubTransport { _, _ in (status, body, ["Content-Type": type]) }
        return (ApiClient(session: FakeSession(), core: HTTPCore(transport: transport)), transport)
    }

    func testSearchSendsTermAndPageAndReadsAuthor() async throws {
        let json = """
            [{"id": "abc", "url": "raw-1", "thumb": "", "blur_hash": "LKO2", \
            "info": {"unsplash_id": "abc", "author": "jane doe", "author_name": "Jane Doe"}}, \
            {"url": "no-id"}, {"id": "def", "info": {"author": "", "author_name": ""}}]
            """
        let (api, transport) = client(200, json)
        let images = try await api.searchUnsplash("c++ hills", page: 2)
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/v1/backgrounds/unsplash/search")
        XCTAssertEqual(request.url?.query, "p=2&s=c%2B%2B%20hills")
        XCTAssertEqual(images.map(\.id), ["abc", "def"])
        XCTAssertEqual(images[0].url, "raw-1")
        XCTAssertEqual(images[0].blurHash, "LKO2")
        XCTAssertEqual(images[0].credit, "Jane Doe")
        XCTAssertEqual(images[0].authorProfileURL?.absoluteString,
                       "https://unsplash.com/@jane%20doe?utm_source=vikunja&utm_medium=referral")
        XCTAssertNil(images[1].credit)
        XCTAssertNil(images[1].authorProfileURL)
    }

    func testSearchTreatsNullAsNoResults() async throws {
        let (api, _) = client(200, "null")
        let images = try await api.searchUnsplash("x")
        XCTAssertEqual(images, [])
    }

    func testThumbnailUsesPluralImagesRoute() async throws {
        let (api, transport) = client(200, "jpg", type: "image/jpeg")
        let data = try await api.unsplashThumbnail(imageId: "abc")
        XCTAssertEqual(data, Data("jpg".utf8))
        XCTAssertEqual(transport.requests.first?.url?.path, "/api/v1/backgrounds/unsplash/images/abc/thumb")
    }

    func testSetUnsplashPostsImageObject() async throws {
        let (api, transport) = client()
        try await api.setUnsplashBackground(projectId: 4, image: UnsplashImage(id: "abc", url: "raw-1"))
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/projects/4/backgrounds/unsplash")
        let sent = try XCTUnwrap(request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] })
        XCTAssertEqual(sent, ["id": "abc", "url": "raw-1", "thumb": ""])
    }

    func testUploadIsMultipartPutWithBackgroundField() async throws {
        let (api, transport) = client()
        try await api.uploadProjectBackground(projectId: 4, fileName: "bg.jpg", mime: "image/jpeg", bytes: Data("jpg".utf8))
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "PUT")
        XCTAssertEqual(request.url?.path, "/api/v1/projects/4/backgrounds/upload")
        XCTAssertTrue(header(request, "Content-Type")?.hasPrefix("multipart/form-data; boundary=") ?? false)
        let body = String(bytes: request.httpBody ?? Data(), encoding: .utf8) ?? ""
        XCTAssertTrue(body.contains(#"name="background"; filename="bg.jpg""#))
        XCTAssertTrue(body.contains("Content-Type: image/jpeg\r\n\r\njpg\r\n"))
    }

    func testUploadRejectionThrows() async {
        let (api, _) = client(400, #"{"message": "Uploaded file is no image."}"#)
        do {
            try await api.uploadProjectBackground(projectId: 4, fileName: "x", mime: "image/heic", bytes: Data())
            XCTFail("expected an error")
        } catch {
            XCTAssertTrue(error is ApiError)
        }
    }

    func testRemoveDeletesBackground() async throws {
        let (api, transport) = client()
        try await api.removeProjectBackground(projectId: 4)
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(request.url?.path, "/api/v1/projects/4/background")
    }
}
