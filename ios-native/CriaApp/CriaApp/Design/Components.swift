import CriaKit
import SwiftUI

/// Small tinted capsule for due date, project and labels: at least 22pt high (growing with Dynamic Type), 12pt
/// medium, 13% fill.
struct CriaChip: View {
    let text: String
    var systemImage: String?
    var dot: Color?
    var tint: Color = Color(.mutedForeground)
    var filled = false
    @ScaledMetric(relativeTo: .caption) private var minHeight = Theme.chipHeight

    var body: some View {
        HStack(spacing: 4) {
            if let dot { Circle().fill(dot).frame(width: 7, height: 7) }
            if let systemImage { Image(systemName: systemImage).imageScale(.small) }
            // Empty text is an icon-only chip (quick add with action labels off).
            if !text.isEmpty { Text(text).lineLimit(1) }
        }
        .font(Theme.chip)
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .frame(minHeight: minHeight)
        .foregroundStyle(filled ? Color(.primaryForeground) : tint)
        .background(filled ? tint : tint.opacity(0.13), in: Capsule())
    }
}

/// Todoist-style completion ring: priority-coloured stroke and soft fill. Completing pops the circle, draws
/// the tick, bursts a ring and six sparks, and plays a success haptic. Reduce Motion skips the burst.
struct PriorityCheck: View {
    let priority: Int
    let isDone: Bool
    var size: CGFloat = Theme.checkSize
    let action: () -> Void
    @State private var burst = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.playsCompletionSound) private var playsSound
    @Environment(\.preferences) private var preferences

    private var color: Color { ThemeToken.priority(priority).map { Color($0) } ?? Color(.mutedForeground) }

    var body: some View {
        Button {
            if !isDone && !reduceMotion { burst += 1 }
            if !isDone && playsSound { CompletionSound.play(preferences.custom.completionTone) }
            action()
        } label: {
            ZStack {
                Circle().fill(isDone ? color : color.opacity(priority > 0 ? 0.16 : 0))
                Circle().strokeBorder(color, lineWidth: 2)
                if isDone {
                    Image(systemName: "checkmark")
                        .font(.system(size: size * 0.5, weight: .heavy))
                        .foregroundStyle(.white)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .frame(width: size, height: size)
            .keyframeAnimator(initialValue: 1.0, trigger: burst) { view, scale in
                view.scaleEffect(scale)
            } keyframes: { _ in
                SpringKeyframe(1.28, duration: 0.13)
                SpringKeyframe(0.92, duration: 0.11)
                SpringKeyframe(1.0, duration: 0.12)
            }
            .background { BurstView(trigger: burst, color: color, size: size) }
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.success, trigger: burst)
        .animation(.spring(duration: 0.28), value: isDone)
        .accessibilityLabel(isDone ? "Mark not done" : "Mark done")
    }
}

private struct BurstState {
    var scale: CGFloat = 1
    var opacity: Double = 0
    var distance: CGFloat = 0
}

private struct BurstView: View {
    let trigger: Int
    let color: Color
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle().strokeBorder(color, lineWidth: 2)
                .keyframeAnimator(initialValue: BurstState(), trigger: trigger) { view, state in
                    view.scaleEffect(state.scale).opacity(state.opacity)
                } keyframes: { _ in
                    KeyframeTrack(\.scale) { MoveKeyframe(0.7); CubicKeyframe(2.1, duration: 0.56) }
                    KeyframeTrack(\.opacity) { MoveKeyframe(trigger == 0 ? 0 : 0.55); CubicKeyframe(0, duration: 0.56) }
                }
            ForEach(0..<6, id: \.self) { index in
                Circle().fill(index.isMultiple(of: 2) ? color : Color(.primary))
                    .frame(width: 4, height: 4)
                    .keyframeAnimator(initialValue: BurstState(scale: 0.4), trigger: trigger) { view, state in
                        view.scaleEffect(state.scale).offset(y: -state.distance).opacity(state.opacity)
                    } keyframes: { _ in
                        KeyframeTrack(\.distance) { MoveKeyframe(0); CubicKeyframe(size * 0.62, duration: 0.56) }
                        KeyframeTrack(\.scale) { MoveKeyframe(0.4); CubicKeyframe(1, duration: 0.56) }
                        KeyframeTrack(\.opacity) {
                            MoveKeyframe(0)
                            LinearKeyframe(trigger == 0 ? 0 : 1, duration: 0.17)
                            LinearKeyframe(0, duration: 0.39)
                        }
                    }
                    .rotationEffect(.degrees(Double(index) * 60))
            }
        }
        .frame(width: size, height: size)
        .allowsHitTesting(false)
    }
}

/// A shortcut offered when the floating add button is pressed and held.
struct FabMenuItem {
    let title: String
    let systemImage: String
    var isDisabled = false
    let action: () -> Void
}

/// Floating add button: solid primary circle (glass is reserved for bars and toolbar buttons). With menu items, a tap
/// still adds a task and a press and hold offers the items.
struct CriaFab: View {
    /// Height the button covers above the bottom safe area: 60pt circle plus 16pt padding, and a little air.
    static let clearance: CGFloat = 84

    let action: () -> Void
    var menuItems: [FabMenuItem] = []

    var body: some View {
        Group {
            if menuItems.isEmpty {
                Button(action: action) { face }
                    .buttonStyle(.plain)
            } else {
                Menu {
                    ForEach(menuItems.indices, id: \.self) { index in
                        let item = menuItems[index]
                        Button(item.title, systemImage: item.systemImage, action: item.action)
                            .disabled(item.isDisabled)
                    }
                } label: {
                    face
                } primaryAction: {
                    action()
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .accessibilityHint("Touch and hold for more ways to add")
            }
        }
        .accessibilityLabel("Add task")
        .accessibilityIdentifier("fab.add")
        .padding(.trailing, 21)
        .padding(.bottom, 16)
    }

    private var face: some View {
        Image(systemName: "plus")
            .font(.system(size: 24, weight: .semibold))
            .frame(width: 60, height: 60)
            .foregroundStyle(Color(.primaryForeground))
            .background(Color(.primary), in: Circle())
            .shadow(color: Color(.primary).opacity(0.4), radius: 12, y: 6)
    }
}

/// Prominent capsule: filled primary with a bouncy press.
struct CriaPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.headline)
            .padding(.horizontal, 20)
            .frame(minHeight: 50)
            .foregroundStyle(Color(.primaryForeground))
            .background(Color(.primary), in: Capsule())
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.spring(duration: 0.25, bounce: 0.4), value: configuration.isPressed)
    }
}

struct CriaSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.headline)
            .padding(.horizontal, 20)
            .frame(minHeight: 50)
            .foregroundStyle(Color(.primary))
            .background(Color(.primarySoft), in: Capsule())
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.spring(duration: 0.25, bounce: 0.4), value: configuration.isPressed)
    }
}

extension View {
    /// Warm grouped background behind a `List` or `Form`, rows on the cell colour. Corner radius, separators,
    /// swipe, edit mode and the scroll-edge effect stay system-drawn.
    func criaSurface() -> some View {
        scrollContentBackground(.hidden)
            .background(Color(.grouped))
            .listRowBackground(Color(.cell))
    }

    /// FAB pinned bottom-trailing, above the tab bar. For list screens only (not Search or task detail). The extra
    /// bottom margin lets the last row scroll clear of the button.
    func criaFab(menu: [FabMenuItem] = [], _ action: @escaping () -> Void) -> some View {
        contentMargins(.bottom, CriaFab.clearance, for: .scrollContent)
            .overlay(alignment: .bottomTrailing) { CriaFab(action: action, menuItems: menu) }
    }

    /// Prominent button: Liquid Glass on iOS 26, filled primary capsule before.
    @ViewBuilder
    func criaProminent() -> some View {
        if #available(iOS 26, *) {
            buttonStyle(.glassProminent).controlSize(.large)
        } else {
            buttonStyle(CriaPrimaryButtonStyle())
        }
    }
}

/// Confirm button in a sheet toolbar: glass prominent on iOS 26, bordered prominent before.
struct CriaProminentToolbarButton: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content.buttonStyle(.glassProminent)
        } else {
            content.buttonStyle(.borderedProminent)
        }
    }
}
