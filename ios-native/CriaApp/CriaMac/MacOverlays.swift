import CriaKit
import SwiftUI

/// The window's floating overlays, in place of sheets: the command palette as a panel 600pt wide and 150pt from the
/// top with radius 20, and Keyboard Shortcuts as a 540pt sheet that drops from the top edge over 260ms. Ramble and
/// List from Photo open the quick-add panel on that screen.
struct MacOverlays: ViewModifier {
    let services: AppServices
    @Bindable var actions: MacActions

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) { palette }
            .overlay(alignment: .top) { shortcuts }
            .animation(.easeOut(duration: 0.26), value: actions.showingShortcuts)
            .animation(.easeOut(duration: 0.15), value: actions.showingPalette)
            .onChange(of: actions.showingRamble) { _, show in
                guard show else { return }
                actions.showingRamble = false
                QuickAddPanel.shared.show(services: services, contextProjectId: nil, initialLine: "", screen: .ramble)
            }
            .onChange(of: actions.showingPhoto) { _, show in
                guard show else { return }
                actions.showingPhoto = false
                QuickAddPanel.shared.show(services: services, contextProjectId: nil, initialLine: "", screen: .photo)
            }
    }

    @ViewBuilder private var palette: some View {
        if actions.showingPalette {
            ZStack(alignment: .top) {
                // A clear catcher: a click outside the panel closes it.
                Color.black.opacity(0.001)
                    .onTapGesture { actions.showingPalette = false }
                CommandPalette(services: services, actions: actions, onClose: { actions.showingPalette = false })
                    .background(.thickMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .strokeBorder(Color.primary.opacity(0.1), lineWidth: 0.5)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .shadow(color: .black.opacity(0.25), radius: 30, y: 12)
                    .padding(.top, 150)
            }
            .transition(.opacity)
        }
    }

    private var shortcuts: some View {
        let shape = UnevenRoundedRectangle(bottomLeadingRadius: 18, bottomTrailingRadius: 18, style: .continuous)
        return ZStack(alignment: .top) {
            if actions.showingShortcuts {
                Color.black.opacity(0.12)
                    .onTapGesture { actions.showingShortcuts = false }
                    .transition(.opacity)
            }
            if actions.showingShortcuts {
                ShortcutsHelp(onClose: { actions.showingShortcuts = false })
                    .background(Color(.background), in: shape)
                    .clipShape(shape)
                    .shadow(color: .black.opacity(0.2), radius: 20, y: 8)
                    .transition(.move(edge: .top))
            }
        }
    }
}
