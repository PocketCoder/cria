import CriaKit
import UIKit
import UniformTypeIdentifiers

/// Share sheet extension: a shared link or text becomes a task in the capture project of the shared database. The
/// app pushes it to the server the next time it syncs.
final class ShareViewController: UIViewController {
    private let label = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        label.text = "Adding to Cria…"
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        Task { await save() }
    }

    private func save() async {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        // Only a real title counts: for shared plain text `attributedContentText` is the whole text.
        let pageTitle = items.compactMap { $0.attributedTitle?.string }.first
        var url: URL?
        var text: String?
        for provider in providers {
            if url == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                url = await Self.load(provider, type: .url).url
            } else if text == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                text = await Self.load(provider, type: .plainText).text
            }
        }
        guard let content = ShareContent.make(title: pageTitle, text: text, url: url) else {
            return finish("Nothing to add.", success: false)
        }
        do {
            let store = CriaStore(database: try CriaPaths.openDatabase())
            if try store.captureTask(title: content.title, descriptionHtml: content.descriptionHtml) == nil {
                return finish("Open Cria and sign in first.", success: false)
            }
            CrossProcessSignal.post()
            finish("Added to Cria.", success: true)
        } catch {
            finish("Could not save: \(error.localizedDescription)", success: false)
        }
    }

    private func finish(_ message: String, success: Bool) {
        label.text = message
        DispatchQueue.main.asyncAfter(deadline: .now() + (success ? 0.6 : 1.8)) {
            if success {
                self.extensionContext?.completeRequest(returningItems: nil)
            } else {
                self.extensionContext?.cancelRequest(withError: NSError(domain: "io.cria.share", code: 1))
            }
        }
    }

    private struct Loaded: Sendable {
        var url: URL?
        var text: String?
    }

    private static func load(_ provider: NSItemProvider, type: UTType) async -> Loaded {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: type.identifier, options: nil) { item, _ in
                continuation.resume(returning: Loaded(url: item as? URL, text: item as? String))
            }
        }
    }
}
