# Native description editor (S-51 options)

Goal: replace the TipTap `WKWebView` plan with a native editor, if it can do the same job. Nothing here is tested on a device; claims about Apple APIs marked (unverified) need a check in Xcode before relying on them.

## What the editor must do

Vikunja stores TipTap HTML. The web editor offers: headings 1 to 3, bold, italic, underline, strikethrough, bullet and numbered lists, task lists (`ul[data-type=taskList]`, `data-checked`), quote, code block, horizontal rule, links, inline images (`cria://pending/{id}` until uploaded), and `@mention` (`<mention-user data-id>`). Output must round-trip so Vikunja-web renders it and vice versa.

## Options

| Option | iOS 17 | Block formats (lists, tasks, headings, quote, code) | Verdict |
|---|---|---|---|
| A. SwiftUI `TextEditor` with `AttributedString` | No, iOS 26 only (unverified) | Inline styles only; no task lists or images (unverified) | Rejected: breaks the iOS 17 floor and lacks blocks |
| B. `NSAttributedString` HTML import/export | Yes | Lossy: drops `data-type`, `data-checked`, `mention-user`; import is main-thread and slow | Rejected: cannot round-trip TipTap HTML |
| C. Own block model plus `UITextView` | Yes | Full control | **Recommended** |
| D. TipTap in `WKWebView` | Yes | Exact | Fallback only: needs a JS bundle step, bridge code, keyboard quirks |

## Recommendation: C, in four testable steps

The risky part (HTML round-trip) lives in `CriaKit`, so CI can verify it without a device. Only the last step needs a device.

1. **S-51a Document model and HTML codec (CriaKit, Linux-testable).** `RichDocument` = `[Block]`; block kinds: paragraph, heading(1...3), bullet, ordered, task(checked), quote, code, rule, image(src). Inline runs: text with bold, italic, underline, strike, code, link(href), mention(id). Parse with the existing `HTMLTokenizer`, serialise to the TipTap shape (`<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>..</p></div></li></ul>`; check exact output against `editorConfig.ts` and real Vikunja data). Tests: golden pairs captured from the Tauri editor, plus parse then serialise idempotence, plus the sanitiser still accepting the output. Done when: golden tests pass on CI.
2. **S-51b Model to `NSAttributedString` mapper (CriaKit).** Each block maps to one paragraph carrying a custom attribute (`criaBlock`) plus paragraph style (indent, bullet or number prefix, checkbox glyph via `NSTextAttachment`); inline runs map to fonts, underline, strikethrough, link. The reverse reads attributes back into blocks. Tests: model to attributed to model equals the original, for every block and run kind.
3. **S-51c `UITextView` wrapper and toolbar (app).** `UIViewRepresentable`; Return continues or exits a list, Backspace at line start downgrades the block, tap on a checkbox attachment toggles it; keyboard accessory toolbar for bold, italic, underline, strike, link, list kinds, task, heading, quote, code. Done when: edit a description on device, open it in Vikunja-web, and it renders.
4. **S-51d Images and mentions.** Images: pick a photo (reuse S-54 `queueAttachment`), insert an `NSTextAttachment` that stores `cria://pending/{id}` and shows a thumbnail. Mentions: typing `@` opens a user search sheet, inserts a mention run (read-only chip in the text view). Comments reuse the same editor, which closes the S-53 @mentions gap.

## Cost and risk

- Largest risk: Return and Backspace behaviour in lists on `UITextView` (S-51c). Mitigate by keeping that logic as pure functions in CriaKit (`(document, selection, key) -> (document, selection)`) with unit tests.
- Estimate: S-51a and S-51b are one nightly run each. S-51c is one run plus device fixes. S-51d is one run.
- Until S-51c lands, the current plain `TextField` plus read-only render stays.

## Decision needed

Approve option C. The plan below replaces S-50's provisional TipTap decision if you do.
