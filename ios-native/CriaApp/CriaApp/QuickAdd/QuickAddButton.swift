import CriaKit
import SwiftUI

/// Colours the typed line by what each part became. A token whose field was then set with a picker is struck
/// through: the picker's value is the one that is saved.
enum QuickAddPreview {
    static func highlighted(_ result: QuickAddResult, overridden: Set<QuickAddField> = []) -> AttributedString {
        var output = AttributedString()
        for token in result.tokens {
            var piece = AttributedString(token.text)
            if let field = field(for: token.kind), overridden.contains(field) {
                piece.foregroundColor = Color(.mutedForeground)
                piece.strikethroughStyle = Text.LineStyle(pattern: .solid)
            } else if let tint = tint(for: token.kind) {
                piece.foregroundColor = tint
                piece.font = Theme.rowTitle.weight(.semibold)
            }
            output += piece
        }
        return output
    }

    private static func field(for kind: QuickAddTokenKind) -> QuickAddField? {
        switch kind {
        case .date, .duration: return .due
        case .priority: return .priority
        case .project: return .project
        default: return nil
        }
    }

    private static func tint(for kind: QuickAddTokenKind) -> Color? {
        switch kind {
        case .text: return nil
        case .date, .deadline, .duration: return Color(.sky700)
        case .priority: return Color(.marigold700)
        case .label: return Color(.meadow700)
        case .assignee: return Color(.primary)
        case .project: return Color(.primary)
        case .recurrence: return Color(.mutedForeground)
        case .reminder: return Color(.coral500)
        }
    }
}

/// Quick add shows the Ramble or photo sheet in its place, so the parent holds all three.
private enum AddSheet: Identifiable {
    case quickAdd, ramble, photo
    var id: Int { hashValue }
}

/// Adds the floating + button that opens quick add, for the screens that list tasks.
struct QuickAddButton: ViewModifier {
    let services: AppServices
    var contextProjectId: String?
    @State private var sheet: AddSheet?
    private var aiStatus: AIStatus { AIStatus.shared }

    func body(content: Content) -> some View {
        addControl(content)
            .task { await aiStatus.refresh() }
            .sheet(item: $sheet) { which in
                switch which {
                case .quickAdd:
                    QuickAddSheet(
                        services: services, contextProjectId: contextProjectId,
                        onRamble: { handOff(.ramble) }, onPhoto: { handOff(.photo) }
                    )
                case .ramble:
                    RambleSheet(services: services)
                case .photo:
                    ShoppingPhotoSheet(services: services)
                }
            }
    }

    /// A floating + on iOS; a New Task button in the window toolbar on the Mac, which has no place for a floating one.
    @ViewBuilder private func addControl(_ content: Content) -> some View {
        #if os(macOS)
        content.toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("New Task", systemImage: "plus") { sheet = .quickAdd }.help("New Task (\u{2318}N)")
            }
        }
        #else
        content.criaFab(menu: fabMenu) { sheet = .quickAdd }
        #endif
    }

    /// Press and hold on +: the same Ramble and photo sheets as Browse's Add menu, with Ramble only where the on-device
    /// model is offered.
    private var fabMenu: [FabMenuItem] {
        var items: [FabMenuItem] = []
        if aiStatus.isOfferable {
            items.append(FabMenuItem(title: "Ramble", systemImage: "waveform", isDisabled: aiStatus.notReadyMessage != nil) {
                sheet = .ramble
            })
        }
        items.append(FabMenuItem(title: "List from photo", systemImage: "camera") { sheet = .photo })
        return items
    }

    /// Present the next sheet after the current one has gone, or SwiftUI drops the request.
    private func handOff(_ next: AddSheet) {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(400))
            sheet = next
        }
    }
}

extension View {
    func quickAdd(services: AppServices, contextProjectId: String? = nil) -> some View {
        modifier(QuickAddButton(services: services, contextProjectId: contextProjectId))
    }
}
