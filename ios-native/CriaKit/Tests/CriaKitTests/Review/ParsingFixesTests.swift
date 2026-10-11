import XCTest
@testable import CriaKit

/// Regressions found in review: sanitiser bypass, entity decoding, parser overflow, date validation.
final class ParsingFixesTests: XCTestCase {
    // MARK: Sanitiser

    func testPrependCharacterCannotHideMarkup() {
        let out = HTMLSanitizer.sanitize("\u{0600}<img src=x onerror=alert(1)>")
        XCTAssertFalse(out.contains("onerror"))
        XCTAssertTrue(out.contains("<img"))
    }

    func testPrependCharacterCannotHideAnIframe() {
        XCTAssertFalse(HTMLSanitizer.sanitize("a\u{0600}<iframe src=x></iframe>b").contains("iframe"))
        XCTAssertFalse(HTMLSanitizer.sanitize("\u{0600}<meta http-equiv=refresh content=0>").contains("meta"))
    }

    func testKeepsPlainTextAttributesWithColons() {
        let out = HTMLSanitizer.sanitize(#"<img src="https://x.test/a.png" alt="Diagram:flow" title="Note:x">"#)
        XCTAssertTrue(out.contains(#"alt="Diagram:flow""#))
        XCTAssertTrue(out.contains(#"title="Note:x""#))
    }

    func testEntityEncodedJavascriptUrlsAreDropped() {
        XCTAssertFalse(HTMLSanitizer.sanitize(#"<img data-src="javascript&#58;alert(1)" src="https://x.test/a.png">"#).contains("data-src"))
        XCTAssertFalse(HTMLSanitizer.sanitize(#"<a href="javascript&#x3a;alert(1)">x</a>"#).contains("href=\"javascript"))
        XCTAssertFalse(HTMLSanitizer.sanitize(#"<a href="jav&#97;script:alert(1)">x</a>"#).contains("href=\"jav"))
    }

    // MARK: Entities

    func testEntitiesAreDecodedOnce() {
        XCTAssertEqual(HTMLEntities.decode("&#38;lt;"), "&lt;")
        XCTAssertEqual(HTMLEntities.decode("&#38;amp;"), "&amp;")
        XCTAssertEqual(HTMLEntities.decode("&amp;lt;"), "&lt;")
    }

    func testCommonNamedAndNumericEntities() {
        XCTAssertEqual(HTMLEntities.decode("a&mdash;b&hellip;"), "a\u{2014}b\u{2026}")
        XCTAssertEqual(HTMLEntities.decode("&#x41;&#66;&lt;&gt;&quot;&apos;"), "AB<>\"'")
    }

    func testUnknownOrBrokenReferencesStayLiteral() {
        XCTAssertEqual(HTMLEntities.decode("fish & chips"), "fish & chips")
        XCTAssertEqual(HTMLEntities.decode("&bogus; &#0; &#xD800; &#;"), "&bogus; &#0; &#xD800; &#;")
        XCTAssertEqual(HTMLEntities.decode("AT&T;"), "AT&T;")
    }

    // MARK: Editor parser

    func testSourceNewlinesAreSpacesNotBreaks() {
        let document = RichDocumentParser.parse("<p>Hello\nworld</p>")
        XCTAssertEqual(document.blocks.first?.plainText, "Hello world")
    }

    func testBreakTagStillMakesAHardBreak() {
        XCTAssertEqual(RichDocumentParser.parse("<p>a<br>b</p>").blocks.first?.plainText, "a\nb")
    }

    func testAdjacentMentionsStayApart() {
        let html = #"<p><mention-user data-id="sam">@sam</mention-user><mention-user data-id="sam">@sam</mention-user></p>"#
        XCTAssertEqual(RichDocumentParser.parse(html).blocks.first?.runs.count, 2)
    }

    // MARK: Overflow

    func testHugeRecurrenceNumbersDoNotTrap() {
        XCTAssertNil(parseQuickAdd("Water plants every 999999999999999 days").repeatAfter)
        XCTAssertNil(parseQuickAdd("Water plants every 9223372036854775807 weeks").repeatAfter)
        XCTAssertEqual(parseQuickAdd("Water plants every 2 days").repeatAfter, 172_800)
    }

    func testHugeFilterOffsetsDoNotTrap() throws {
        XCTAssertNoThrow(try parseFilterQuery("dueDate < now+2000000000000000000w"))
        XCTAssertNoThrow(try parseFilterQuery("dueDate < now+99999999999999999999d"))
    }

    // MARK: Date validation

    func testImpossibleDatesDoNotRollOver() {
        XCTAssertNil(parseQuickAdd("Pay 2026-13-01").dueDate)
        XCTAssertNil(parseQuickAdd("Pay 2026-02-30").dueDate)
        XCTAssertNotNil(parseQuickAdd("Pay 2026-02-28").dueDate)
    }

    // MARK: Due dates

    func testTimedValueJustAfterMidnightStaysTimed() throws {
        let midnight = try XCTUnwrap(DueDates.parse("2026-05-28T00:00:00Z"))
        let written = DueDates.timedISO(midnight.addingTimeInterval(0.4))
        XCTAssertTrue(DueDates.hasTimeOfDay(written), written)
    }
}
