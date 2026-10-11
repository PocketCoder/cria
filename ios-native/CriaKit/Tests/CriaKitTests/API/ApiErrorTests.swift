import XCTest
@testable import CriaKit

final class ApiErrorTests: XCTestCase {
    func testClassifiesRetryableStatuses() {
        for status in [500, 502, 503, 408, 429] { XCTAssertTrue(classifyRetryable(status: status), "\(status)") }
        for status in [400, 401, 403, 404, 412] { XCTAssertFalse(classifyRetryable(status: status), "\(status)") }
    }

    func testParsesVikunjaEnvelope() {
        let error = buildApiError(status: 400, body: Data(#"{"code": 4001, "message": "Bad title"}"#.utf8))
        XCTAssertEqual(error.code, 4001)
        XCTAssertEqual(error.message, "Bad title")
        XCTAssertFalse(error.retryable)
    }

    func testFallsBackToPlainTextThenStatus() {
        XCTAssertEqual(buildApiError(status: 502, body: Data("Bad gateway".utf8)).message, "Bad gateway")
        XCTAssertEqual(buildApiError(status: 500, body: nil).message, "HTTP 500")
        XCTAssertEqual(buildApiError(status: 500, body: Data()).message, "HTTP 500")
        XCTAssertEqual(buildApiError(status: 400, body: Data(#"{"code": 1}"#.utf8)).message, "HTTP 400")
        XCTAssertTrue(buildApiError(status: 502, body: Data("x".utf8)).retryable)
    }

    func testTruncatesLongPlainText() {
        let error = buildApiError(status: 500, body: Data(String(repeating: "a", count: 500).utf8))
        XCTAssertEqual(error.message.count, 200)
    }

    func testTotpRequiredIs412() {
        XCTAssertTrue(isTotpRequired(ApiError(status: 412, code: 1017, message: "totp", retryable: false)))
        XCTAssertFalse(isTotpRequired(ApiError(status: 401, code: nil, message: "x", retryable: false)))
        XCTAssertFalse(isTotpRequired(NetworkError("x")))
    }

    func testOfflineDetection() {
        XCTAssertTrue(isOfflineError(NetworkError("anything")))
        XCTAssertTrue(isOfflineError(URLError(.notConnectedToInternet)))
        XCTAssertTrue(isOfflineError(URLError(.timedOut)))
        XCTAssertFalse(isOfflineError(ApiError(status: 400, code: nil, message: "Bad", retryable: false)))
    }

    func testNetworkErrorIsRetryable() {
        XCTAssertTrue(NetworkError("x").retryable)
    }
}
