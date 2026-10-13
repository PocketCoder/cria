import SwiftUI

extension View {
    /// Shows `text` in a small capsule at the bottom for a moment, then clears it ("Link copied").
    func transientNotice(_ text: Binding<String?>) -> some View {
        modifier(TransientNotice(text: text))
    }
}

private struct TransientNotice: ViewModifier {
    @Binding var text: String?

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                if let text {
                    Label(text, systemImage: "checkmark.circle.fill")
                        .font(.subheadline)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(.regularMaterial, in: Capsule())
                        .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
                        .padding(.bottom, 24)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        .allowsHitTesting(false)
                }
            }
            .animation(.snappy, value: text)
            .task(id: text) {
                guard text != nil else { return }
                try? await Task.sleep(for: .seconds(1.6))
                if !Task.isCancelled { text = nil }
            }
    }
}
