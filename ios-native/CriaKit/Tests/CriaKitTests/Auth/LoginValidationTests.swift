import XCTest
@testable import CriaKit

final class LoginValidationTests: XCTestCase {
    func testAcceptsHTTPSAndTrims() throws {
        XCTAssertEqual(try LoginValidation.validateServerURL("  https://vikunja.example.com ").get(), "https://vikunja.example.com")
        XCTAssertEqual(try LoginValidation.validateServerURL("https://vk.example/").get(), "https://vk.example")
    }

    func testAcceptsHTTPOnlyForLoopback() {
        XCTAssertNoThrow(try LoginValidation.validateServerURL("http://localhost:3456").get())
        XCTAssertNoThrow(try LoginValidation.validateServerURL("http://127.0.0.1:3456").get())
        XCTAssertNoThrow(try LoginValidation.validateServerURL("http://[::1]:3456").get())
        XCTAssertThrowsError(try LoginValidation.validateServerURL("http://example.com").get()) { error in
            XCTAssertEqual((error as? ValidationError)?.message, LoginValidation.invalidURLMessage)
        }
    }

    func testRejectsNonURLs() {
        for input in ["not a url", "", "   ", "vk.example", "ftp://vk.example", "https://"] {
            XCTAssertThrowsError(try LoginValidation.validateServerURL(input).get(), input)
        }
    }

    func testMessagesMapStatuses() {
        func message(_ status: Int, _ text: String = "x") -> String {
            LoginValidation.message(for: ApiError(status: status, code: nil, message: text, retryable: false))
        }
        XCTAssertTrue(message(401).contains("rejected"))
        XCTAssertTrue(message(403).contains("rejected"))
        XCTAssertTrue(message(404).contains("/api/v1"))
        XCTAssertEqual(message(500, "Boom"), "Boom")
        XCTAssertEqual(message(500, ""), "Server returned HTTP 500.")
        XCTAssertTrue(LoginValidation.message(for: NetworkError("x")).contains("reach the server"))
    }

    func testAccountValidation() {
        XCTAssertEqual(LoginValidation.validateNewPassword("abc", confirm: "abd"), "Passwords do not match")
        XCTAssertEqual(LoginValidation.validateNewPassword("abc", confirm: "abc"), "Password must be at least 6 characters")
        XCTAssertNil(LoginValidation.validateNewPassword("abcdef", confirm: "abcdef"))
        XCTAssertEqual(LoginValidation.validateEmail("nope"), "Invalid email address")
        XCTAssertNil(LoginValidation.validateEmail("a@b.c"))
    }
}
