import XCTest
@testable import CriaKit

final class RichDocumentTests: XCTestCase {
    private func assertRoundTrip(_ html: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(RichDocument(html: html).html(), html, file: file, line: line)
    }

    func testParagraphWithInlineStylesRoundTrips() {
        assertRoundTrip("<p>Hello <strong>bold</strong> and <em>soft</em> <u>under</u> <s>gone</s> <code>x</code></p>")
    }

    func testStackedStylesKeepFixedNestingOrder() {
        let document = RichDocument(html: "<p><em><strong>both</strong></em></p>")
        let run = document.blocks.first?.runs.first
        XCTAssertEqual(run?.styles, [.bold, .italic])
        XCTAssertEqual(document.html(), "<p><strong><em>both</em></strong></p>")
    }

    func testHeadingsAndEntities() {
        assertRoundTrip("<h1>Title</h1><h2>A &amp; B</h2><h3>&lt;tag&gt;</h3>")
        XCTAssertEqual(RichDocument(html: "<h2>A &amp; B</h2>").blocks.first?.plainText, "A & B")
    }

    func testDeepHeadingsClampToThree() {
        XCTAssertEqual(RichDocument(html: "<h5>Small</h5>").html(), "<h3>Small</h3>")
    }

    func testNestedBulletAndOrderedLists() {
        assertRoundTrip("<ul><li><p>one</p><ul><li><p>nested</p></li></ul></li><li><p>two</p></li></ul>")
        assertRoundTrip("<ol><li><p>first</p></li><li><p>second</p></li></ol>")
    }

    func testTaskListRoundTripsWithCheckedState() {
        let html = "<ul data-type=\"taskList\">"
            + "<li data-checked=\"true\" data-type=\"taskItem\"><label><input type=\"checkbox\" checked=\"checked\">"
            + "<span></span></label><div><p>done</p></div></li>"
            + "<li data-checked=\"false\" data-type=\"taskItem\"><label><input type=\"checkbox\"><span></span></label>"
            + "<div><p>todo</p></div></li></ul>"
        assertRoundTrip(html)
        XCTAssertEqual(RichDocument(html: html).blocks.map(\.kind), [.task(checked: true), .task(checked: false)])
    }

    func testQuoteCodeRuleAndImage() {
        assertRoundTrip("<blockquote><p>q1</p><p>q2</p></blockquote>")
        assertRoundTrip("<pre><code>let x = 1\nlet y = 2 &lt; 3</code></pre>")
        assertRoundTrip("<hr><img src=\"cria://pending/abc\" alt=\"pic\">")
        assertRoundTrip("<img src=\"#\" data-src=\"https://v.test/a.png\">")
    }

    func testLinkAndMention() {
        let html = "<p>Hi <mention-user data-id=\"sam\">@sam</mention-user> see "
            + "<a href=\"https://x.test/a?b=1&amp;c=2\" target=\"_blank\" rel=\"noopener noreferrer\">link</a></p>"
        assertRoundTrip(html)
        let runs = RichDocument(html: html).blocks.first?.runs
        XCTAssertEqual(runs?[1].mentionId, "sam")
        XCTAssertEqual(runs?[3].link, "https://x.test/a?b=1&c=2")
    }

    func testEmptyParagraphAndBareText() {
        assertRoundTrip("<p></p>")
        XCTAssertEqual(RichDocument(html: "just text").html(), "<p>just text</p>")
        XCTAssertEqual(RichDocument(html: "").blocks.count, 0)
    }

    func testLineBreakBecomesNewlineInRun() {
        let document = RichDocument(html: "<p>one<br>two</p>")
        XCTAssertEqual(document.blocks.first?.plainText, "one\ntwo")
        XCTAssertEqual(document.html(), "<p>one<br>two</p>")
    }

    func testMessyLegacyHTMLIsStableAfterOneRoundTrip() {
        let messy = "\n<h4>Old</h4>\n<p><b>bold</b> <i>it</i> <del>x</del></p>\n"
            + "<ul>\n <li>\n  <p>a</p>\n </li>\n <li>bare text</li>\n</ul>\n"
        let first = RichDocument(html: messy)
        let again = RichDocument(html: first.html())
        XCTAssertEqual(again, first)
        XCTAssertEqual(first.blocks.map(\.kind), [.heading(3), .paragraph, .bullet, .bullet])
    }

    func testDepthIsClampedWhenAListJumpsLevels() {
        let document = RichDocument(blocks: [
            Block(kind: .bullet, depth: 3, runs: [InlineRun(text: "a")]),
            Block(kind: .bullet, depth: 0, runs: [InlineRun(text: "b")])
        ])
        XCTAssertEqual(document.html(), "<ul><li><p>a</p></li><li><p>b</p></li></ul>")
    }

    func testOutputPassesTheSanitiser() {
        let html = "<h2>T</h2><p>a <strong>b</strong> <a href=\"https://x.test\" target=\"_blank\" rel=\"noopener noreferrer\">l</a> "
            + "<mention-user data-id=\"sam\">@sam</mention-user></p>"
            + "<blockquote><p>q</p></blockquote><pre><code>c</code></pre><hr><img src=\"cria://pending/x\" alt=\"i\">"
        let written = RichDocument(html: html).html()
        XCTAssertEqual(written, html)
        XCTAssertEqual(HTMLSanitizer.sanitize(written), written)
    }

    func testSanitiserKeepsTaskStateOnWrittenTaskLists() {
        let document = RichDocument(blocks: [Block(kind: .task(checked: true), runs: [InlineRun(text: "t")])])
        let clean = HTMLSanitizer.sanitize(document.html())
        XCTAssertTrue(clean.contains("data-checked=\"true\""))
        XCTAssertTrue(clean.contains("<input type=\"checkbox\" checked=\"checked\">"))
        XCTAssertTrue(clean.contains("<p>t</p>"))
    }
}
