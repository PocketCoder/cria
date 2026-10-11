import XCTest
@testable import CriaKit

final class HTMLSanitizerTests: XCTestCase {
    private func clean(_ html: String) -> String {
        HTMLSanitizer.sanitize(html)
    }

    func testStripsUnsafeMarkup() {
        XCTAssertEqual(clean("<script>alert(1)</script><p>ok</p>"), "<p>ok</p>")
        XCTAssertEqual(clean("<img src=\"x\" onerror=\"alert(1)\">"), "<img src=\"x\">")
        XCTAssertEqual(clean("<iframe src=\"https://evil\"></iframe>"), "")
        XCTAssertEqual(clean("<p style=\"background:url(x)\" onclick=\"x()\">t</p>"), "<p>t</p>")
    }

    func testDropsUnsafeHrefs() {
        let hrefs = ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "vbscript:x"]
        for href in hrefs {
            XCTAssertFalse(clean("<a href=\"\(href)\">x</a>").contains("href"), href)
        }
    }

    func testHardensSafeLinks() {
        let out = clean("<a href=\"https://ok.example\" target=\"_self\" rel=\"opener\">x</a>")
        XCTAssertTrue(out.contains("href=\"https://ok.example\""))
        XCTAssertTrue(out.contains("target=\"_blank\""))
        XCTAssertTrue(out.contains("rel=\"noopener noreferrer\""))
        XCTAssertFalse(out.contains("_self"))
    }

    func testKeepsTaskListState() {
        let html = "<ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"true\">done</li></ul>"
        XCTAssertEqual(clean(html), html)
    }

    func testKeepsQueuedUploadPlaceholder() {
        let html = "<p><img src=\"#\" data-src=\"cria://pending/V1StGXR8_Z5jdHi6B-myT\"></p>"
        XCTAssertEqual(clean(html), html)
    }

    func testKeepsVikunjaInlineImageMinusItsId() {
        let url = "https://vikunja.example/api/v2/tasks/5/attachments/9"
        XCTAssertEqual(
            clean("<p><img data-src=\"\(url)\" src=\"#\" alt=\"Shelf\" id=\"tiptap-image-5-9\"></p>"),
            "<p><img data-src=\"\(url)\" src=\"#\" alt=\"Shelf\"></p>"
        )
    }

    func testStripsScriptUrlsFromInlineImages() {
        XCTAssertEqual(
            clean("<img src=\"#\" data-src=\"javascript:alert(1)\" onload=\"x()\" onerror=\"y()\">"),
            "<img src=\"#\">"
        )
        XCTAssertEqual(clean("<img src=\"javascript:alert(1)\">"), "<img>")
    }

    func testAllowsNoOtherCriaUrlAndNoPlaceholderLink() {
        XCTAssertEqual(clean("<img data-src=\"cria://evil/x\">"), "<img>")
        XCTAssertFalse(clean("<a href=\"cria://pending/abc\">x</a>").contains("href"))
    }

    func testPreservesMentionMarkup() {
        let html = "<p>hi <mention-user data-id=\"alice\">@alice</mention-user>!</p>"
        XCTAssertEqual(clean(html), html)
    }

    func testStripsHandlersAroundMentions() {
        let out = clean(
            "<p><mention-user data-id=\"a\" onclick=\"alert(1)\">@a</mention-user><script>alert(2)</script></p>"
        )
        XCTAssertTrue(out.contains("<mention-user data-id=\"a\">@a</mention-user>"))
        XCTAssertFalse(out.contains("script"))
        XCTAssertFalse(out.contains("onclick"))
    }

    func testDoesNotAllowOtherCustomElements() {
        let out = clean("<other-thing data-id=\"x\">y</other-thing>")
        XCTAssertFalse(out.contains("other-thing"))
        XCTAssertTrue(out.contains("y"))
    }

    func testClosesUnbalancedTags() {
        XCTAssertEqual(clean("<p><strong>x"), "<p><strong>x</strong></p>")
        XCTAssertEqual(clean("a</p>b"), "ab")
    }
}
