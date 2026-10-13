import CriaKit
import SwiftUI
import UIKit

/// An inline image to show full screen. `source` is the address as the HTML holds it.
struct ImageViewerItem: Identifiable, Equatable {
    let source: String
    var id: String { source }
}

/// Finds the pixels behind an inline image: queued bytes for `cria://pending/{localId}`, the Vikunja server (with the
/// session token) for its own images, and the open web for the rest.
@MainActor
enum ImageViewerLoader {
    private static let pendingPrefix = "cria://pending/"

    static func image(source: String, services: AppServices?) async -> UIImage? {
        if source.hasPrefix(pendingPrefix) {
            return services?.pendingBlobData(String(source.dropFirst(pendingPrefix.count))).flatMap { UIImage(data: $0) }
        }
        guard let url = URL(string: source), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return nil }
        if let services, let data = await services.serverImageData(url), let image = UIImage(data: data) { return image }
        guard let (data, _) = try? await URLSession.shared.data(from: url) else { return nil }
        return UIImage(data: data)
    }
}

/// Full-screen image: pinch to zoom, double tap to zoom in and out, drag to pan when zoomed, swipe down to close, and
/// the share sheet (which also saves to Photos).
struct ImageViewer: View {
    let item: ImageViewerItem
    let services: AppServices?
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var failed = false
    @State private var scale: CGFloat = 1
    @State private var settledScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var settledOffset: CGSize = .zero

    private static let maxScale: CGFloat = 5
    private static let dismissDistance: CGFloat = 120

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Color.black.ignoresSafeArea()
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .scaleEffect(scale)
                        .offset(offset)
                        .gesture(pan(in: proxy.size))
                        .simultaneousGesture(magnify(in: proxy.size))
                        .onTapGesture(count: 2) { toggleZoom() }
                        .accessibilityLabel("Image")
                        .accessibilityHint("Pinch to zoom, double tap to zoom in or out")
                } else if failed {
                    Label("The image could not be loaded", systemImage: "photo")
                        .foregroundStyle(.white.opacity(0.8))
                } else {
                    ProgressView().tint(.white)
                }
            }
            .overlay(alignment: .topLeading) { circleButton("xmark", label: "Close") { dismiss() }.padding() }
            .overlay(alignment: .topTrailing) { shareButton.padding() }
        }
        .task {
            image = await ImageViewerLoader.image(source: item.source, services: services)
            failed = image == nil
        }
    }

    @ViewBuilder private var shareButton: some View {
        if let image {
            ShareLink(item: Image(uiImage: image), preview: SharePreview("Image", image: Image(uiImage: image))) {
                chrome(Image(systemName: "square.and.arrow.up"))
            }
            .accessibilityLabel("Share or save image")
        }
    }

    private func circleButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { chrome(Image(systemName: symbol)) }
            .accessibilityLabel(label)
    }

    private func chrome(_ icon: Image) -> some View {
        icon
            .font(.body.weight(.semibold))
            .foregroundStyle(.white)
            .frame(width: 44, height: 44)
            .background(.black.opacity(0.45), in: Circle())
    }

    // MARK: Gestures

    private func magnify(in size: CGSize) -> some Gesture {
        MagnifyGesture()
            .onChanged { value in
                scale = min(max(settledScale * value.magnification, 1), Self.maxScale)
                offset = clamped(offset, in: size)
            }
            .onEnded { _ in
                settledScale = scale
                if scale <= 1.01 { reset() } else { settledOffset = clamped(offset, in: size) }
            }
    }

    private func pan(in size: CGSize) -> some Gesture {
        DragGesture()
            .onChanged { value in
                if scale > 1 {
                    offset = clamped(
                        CGSize(width: settledOffset.width + value.translation.width,
                               height: settledOffset.height + value.translation.height),
                        in: size
                    )
                } else {
                    // Not zoomed: the picture follows the finger down, to be swiped away.
                    offset = CGSize(width: 0, height: max(value.translation.height, 0))
                }
            }
            .onEnded { value in
                if scale > 1 {
                    settledOffset = offset
                } else if max(value.translation.height, value.predictedEndTranslation.height / 3) > Self.dismissDistance {
                    dismiss()
                } else {
                    withAnimation(.snappy) { offset = .zero }
                }
            }
    }

    /// Keeps a zoomed picture's edge from leaving the screen.
    private func clamped(_ value: CGSize, in size: CGSize) -> CGSize {
        let limitX = size.width * (scale - 1) / 2
        let limitY = size.height * (scale - 1) / 2
        return CGSize(width: min(max(value.width, -limitX), limitX), height: min(max(value.height, -limitY), limitY))
    }

    private func toggleZoom() {
        withAnimation(.snappy) {
            if scale > 1 {
                reset()
            } else {
                scale = 2.5
                settledScale = 2.5
            }
        }
    }

    private func reset() {
        scale = 1
        settledScale = 1
        offset = .zero
        settledOffset = .zero
    }
}
