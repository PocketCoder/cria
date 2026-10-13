import XCTest
@testable import CriaKit

final class RichDocumentTextTests: XCTestCase {
    private let sample = "<h2>Title</h2><p>a <strong>b</strong> <em><u>c</u></em> "
        + "<a href=\"https://x.test\" target=\"_blank\" rel=\"noopener noreferrer\">link</a> "
        + "<mention-user data-id=\"sam\">@sam</mention-user><br>next line</p>"
        + "<ul><li><p>one</p><ul><li><p>nested</p></li></ul></li></ul><ol><li><p>first</p></li></ol>"
        + "<ul data-type=\"taskList\"><li data-checked=\"true\" data-type=\"taskItem\"><label>"
        + "<input type=\"checkbox\" checked=\"checked\"><span></span></label><div><p>done</p></div></li></ul>"
        + "<blockquote><p>q</p></blockquote><pre><code>let x = 1\nlet y = 2</code></pre><hr>"
        + "<img src=\"cria://pending/abc\" alt=\"pic\"><p></p><p>end</p>"

    func testFullDocumentSurvivesAttributedRoundTrip() {
        let document = RichDocument(html: sample)
        let text = RichDocumentText.attributedString(from: document)
        XCTAssertEqual(RichDocumentText.document(from: text), document)
        XCTAssertEqual(RichDocumentText.document(from: text).html(), document.html())
    }

    func testTextLayoutUsesTerminatorsAndLineSeparators() {
        let document = RichDocument(html: "<h1>Hi</h1><p>one<br>two</p><hr>")
        let string = RichDocumentText.attributedString(from: document).string
        XCTAssertEqual(string, "Hi\none\u{2028}two\n\u{FFFC}\n")
    }

    func testBlockAndInlineAttributesAreSet() {
        let document = RichDocument(html: "<ul><li><p>x</p><ul><li><p><strong>y</strong></p></li></ul></li></ul>")
        let text = RichDocumentText.attributedString(from: document)
        XCTAssertEqual(text.attribute(.criaBlock, at: 0, effectiveRange: nil) as? String, "ul")
        XCTAssertEqual(text.attribute(.criaDepth, at: 0, effectiveRange: nil) as? Int, 0)
        XCTAssertEqual(text.attribute(.criaDepth, at: 2, effectiveRange: nil) as? Int, 1)
        XCTAssertEqual(text.attribute(.criaStyles, at: 2, effectiveRange: nil) as? String, "bold")
    }

    func testEmptyDocumentAndEmptyParagraphKeepTheirKind() {
        XCTAssertEqual(RichDocumentText.attributedString(from: RichDocument()).length, 0)
        let document = RichDocument(blocks: [Block(kind: .bullet), Block(kind: .paragraph, runs: [InlineRun(text: "x")])])
        let text = RichDocumentText.attributedString(from: document)
        XCTAssertEqual(RichDocumentText.document(from: text), document)
    }

    func testPlainTextWithoutAttributesBecomesParagraphs() {
        let document = RichDocumentText.document(from: NSAttributedString(string: "one\ntwo"))
        XCTAssertEqual(document.blocks.map(\.kind), [.paragraph, .paragraph])
        XCTAssertEqual(document.blocks.map(\.plainText), ["one", "two"])
    }

    func testTypedTextInheritingAttributesMergesIntoOneRun() {
        let text = NSMutableAttributedString(string: "ab", attributes: [.criaBlock: "p", .criaStyles: "italic"])
        text.append(NSAttributedString(string: "cd", attributes: [.criaBlock: "p", .criaStyles: "italic"]))
        let document = RichDocumentText.document(from: text)
        XCTAssertEqual(document.blocks.count, 1)
        XCTAssertEqual(document.blocks.first?.runs, [InlineRun(text: "abcd", styles: [.italic])])
    }

    func testCodeBlockDropsInlineStyles() {
        let text = NSAttributedString(string: "x", attributes: [.criaBlock: "code", .criaStyles: "bold"])
        XCTAssertEqual(RichDocumentText.document(from: text).blocks.first?.runs, [InlineRun(text: "x")])
    }

    func testLinkAttributeRoundTrips() {
        let text = NSAttributedString(string: "go", attributes: [.criaLink: "https://x.test/a"])
        XCTAssertEqual(RichDocumentText.document(from: text).blocks.first?.runs.first?.link, "https://x.test/a")
    }

    func testBlockInfoReadsAttributesBackForEveryKind() {
        let image = RichImage(src: "cria://pending/a", alt: "pic")
        let kinds: [BlockKind] = [.paragraph, .heading(2), .bullet, .ordered, .task(checked: true), .quote, .code, .rule, .image(image)]
        for kind in kinds {
            let attributes = RichDocumentText.blockAttributes(kind: kind, depth: kind.isListItem ? 2 : 0)
            let info = RichDocumentText.blockInfo(from: attributes)
            XCTAssertEqual(info.kind, kind)
            XCTAssertEqual(info.depth, kind.isListItem ? 2 : 0)
        }
        XCTAssertEqual(RichDocumentText.blockInfo(from: [:]), BlockInfo(kind: .paragraph, depth: 0))
    }
}
