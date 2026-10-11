import XCTest
@testable import CriaKit

/// Structure HTML nests around blocks: quotes around anything, several blocks in one list item.
final class RichDocumentNestingTests: XCTestCase {
    private func assertRoundTrip(_ html: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(RichDocument(html: html).html(), html, file: file, line: line)
    }

    func testSecondParagraphStaysInsideItsListItem() {
        assertRoundTrip("<ul><li><p>a</p><p>b</p></li><li><p>c</p></li></ul>")
        let document = RichDocument(html: "<ul><li><p>a</p><p>b</p></li></ul>")
        XCTAssertEqual(document.blocks.map(\.context.joinsItem), [false, true])
    }

    func testCodeBlockImageAndHeadingInsideAnItem() {
        assertRoundTrip("<ul><li><p>a</p><pre><code>x = 1</code></pre></li></ul>")
        assertRoundTrip("<ol><li><p>a</p><img src=\"cria://pending/x\" alt=\"i\"></li></ol>")
        assertRoundTrip("<ul><li><p>a</p><h2>sub</h2></li></ul>")
    }

    func testContinuationBelongsToItsOwnNestingLevel() {
        assertRoundTrip("<ul><li><p>a</p><ul><li><p>b</p><p>b2</p></li></ul><p>a2</p></li></ul>")
    }

    func testOrderedItemsKeepNumberingAcrossContinuations() {
        let blocks = RichDocument(html: "<ol><li><p>a</p><p>x</p></li><li><p>b</p></li></ol>").blocks
        XCTAssertEqual(EditorRules.listNumbers(for: blocks), [1, nil, 2])
    }

    func testListsAndOtherBlocksInsideAQuote() {
        assertRoundTrip("<blockquote><ul><li><p>a</p><p>b</p></li></ul></blockquote>")
        assertRoundTrip("<blockquote><h2>t</h2><pre><code>c</code></pre><p>after</p></blockquote>")
        assertRoundTrip("<p>before</p><blockquote><ol><li><p>one</p></li></ol></blockquote><p>after</p>")
    }

    func testQuoteInsideQuoteAndInsideAnItem() {
        assertRoundTrip("<blockquote><p>a</p><blockquote><p>b</p></blockquote></blockquote>")
        assertRoundTrip("<ul><li><p>a</p><blockquote><p>q</p></blockquote></li></ul>")
    }

    func testTaskItemWithMoreContent() {
        let html = "<ul data-type=\"taskList\"><li data-checked=\"false\" data-type=\"taskItem\">"
            + "<label><input type=\"checkbox\"><span></span></label><div><p>a</p><p>b</p></div></li></ul>"
        assertRoundTrip(html)
    }

    func testBareTextAfterAParagraphBecomesMoreContent() {
        XCTAssertEqual(
            RichDocument(html: "<ul><li><p>a</p>tail</li></ul>").html(),
            "<ul><li><p>a</p><p>tail</p></li></ul>"
        )
    }

    func testItemStartingWithAHeadingGetsAnEmptyFirstBlock() {
        let document = RichDocument(html: "<ul><li><h2>t</h2></li></ul>")
        XCTAssertEqual(document.blocks.map(\.kind), [.bullet, .heading(2)])
        XCTAssertEqual(document.html(), "<ul><li><p></p><h2>t</h2></li></ul>")
    }

    func testContextSurvivesTheAttributedStringRoundTrip() {
        let html = "<blockquote><ul><li><p>a</p><p>b</p></li></ul></blockquote><ul><li><p>c</p><pre><code>d</code></pre></li></ul>"
        let document = RichDocument(html: html)
        let text = RichDocumentText.attributedString(from: document)
        XCTAssertEqual(RichDocumentText.document(from: text), document)
        XCTAssertEqual(RichDocumentText.document(from: text).html(), html)
    }

    func testContextEncodingRoundTrips() {
        let contexts = [
            BlockContext.none, BlockContext(quoteLevel: 2), BlockContext(joinsItem: true), BlockContext(quoteLevel: 1, joinsItem: true)
        ]
        for context in contexts {
            XCTAssertEqual(BlockContext(encoded: context.isNone ? nil : context.encoded), context)
        }
    }

    func testOrphanJoinWithoutAListIsAPlainBlock() {
        let document = RichDocument(blocks: [Block(kind: .paragraph, context: BlockContext(joinsItem: true))])
        XCTAssertEqual(document.html(), "<p></p>")
    }

    func testSanitisedOutputStillPassesTheSanitiser() {
        let html = "<blockquote><ul><li><p>a</p><pre><code>c</code></pre></li></ul></blockquote>"
        XCTAssertEqual(HTMLSanitizer.sanitize(RichDocument(html: html).html()), html)
    }
}
