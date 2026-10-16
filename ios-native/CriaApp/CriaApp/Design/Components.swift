import CriaKit
import SwiftUI

/// Small tinted capsule for due date, project and labels: at least 22pt high (growing with Dynamic Type), 12pt
/// medium, 13% fill. The icon and dot are decorative; VoiceOver reads the text.
struct CriaChip: View {
    let text: String
    var systemImage: String?
    var dot: Color?
    var tint: Color = Color(.mutedForeground)
    var filled = false
    @ScaledMetric(relativeTo: .caption) private var minHeight = Theme.chipHeight
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        HStack(spacing: 4) {
            if let dot { Circle().fill(dot).frame(width: 7, height: 7).accessibilityHidden(true) }
            if let systemImage { Image(systemName: systemImage).imageScale(.small).accessibilityHidden(true) }
            // Empty text is an icon-only chip (quick add with action labels off).
            if !text.isEmpty { Text(text).lineLimit(1).foregroundStyle(textColour) }
        }
        .font(Theme.chip)
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .frame(minHeight: minHeight)
        .foregroundStyle(filled ? Color(.primaryForeground) : tint)
        .background(filled ? tint : tint.opacity(0.13), in: Capsule())
        .accessibilityElement(children: .combine)
    }

    /// The tint, unless it is too faint to read on its own 13% fill (a pale label colour, or a mid tone in light
    /// mode): then the text falls back to the foreground and only the icon, dot and fill carry the colour.
    private var textColour: Color {
        guard !filled else { return Color(.primaryForeground) }
        let needed = contrast == .increased ? 7.0 : 4.5
        return ChipContrast.readable(tint, scheme: colorScheme, needed: needed) ? tint : Color(.foreground)
    }
}

/// WCAG contrast for chip text drawn in a colour over a 13% wash of that colour on a cell.
enum ChipContrast {
    private struct ReadableKey: Hashable {
        let tint: Color
        let isDark: Bool
        let needed: Double
    }

    /// Answers per tint and appearance, so chips do not resolve two dynamic colours and redo the luminance maths on
    /// every row pass. The set of tints is small (tokens and label colours); the bound only guards against a leak.
    @MainActor private static var readableCache: [ReadableKey: Bool] = [:]

    /// Whether text in `tint` reaches `needed` contrast over its own wash on a cell.
    @MainActor
    static func readable(_ tint: Color, scheme: ColorScheme, needed: Double) -> Bool {
        let key = ReadableKey(tint: tint, isDark: scheme == .dark, needed: needed)
        if let known = readableCache[key] { return known }
        var environment = EnvironmentValues()
        environment.colorScheme = scheme
        let result = ratio(tint.resolve(in: environment), over: Color(.cell).resolve(in: environment)) >= needed
        if readableCache.count > 512 { readableCache.removeAll() }
        readableCache[key] = result
        return result
    }

    static func ratio(_ tint: Color.Resolved, over base: Color.Resolved) -> Double {
        let wash = 0.13
        let background = [
            Double(base.red) * (1 - wash) + Double(tint.red) * wash,
            Double(base.green) * (1 - wash) + Double(tint.green) * wash,
            Double(base.blue) * (1 - wash) + Double(tint.blue) * wash
        ]
        let first = luminance([Double(tint.red), Double(tint.green), Double(tint.blue)])
        let second = luminance(background)
        return (max(first, second) + 0.05) / (min(first, second) + 0.05)
    }

    /// Relative luminance from gamma-encoded sRGB components.
    private static func luminance(_ rgb: [Double]) -> Double {
        let linear = rgb.map { value in
            let clamped = min(max(value, 0), 1)
            return clamped <= 0.04045 ? clamped / 12.92 : pow((clamped + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }
}

/// Todoist-style completion ring: priority-coloured stroke and soft fill. Completing pops the circle, draws
/// the tick, bursts a ring and six sparks, and plays a success haptic. Reduce Motion skips the pop and burst and
/// fades the tick in; the haptic stays. The ring grows a little with Dynamic Type.
struct PriorityCheck: View {
    let priority: Int
    let isDone: Bool
    var size: CGFloat = Theme.checkSize
    let action: () -> Void
    @State private var burst = 0
    /// Every completion, burst or not, so the haptic plays under Reduce Motion too.
    @State private var completions = 0
    @ScaledMetric(relativeTo: .body) private var typeScale: CGFloat = 1
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.playsCompletionSound) private var playsSound
    @Environment(\.preferences) private var preferences

    private var color: Color { ThemeToken.priority(priority).map { Color($0) } ?? Color(.mutedForeground) }
    private var ring: CGFloat { size * min(max(typeScale, 1), 1.6) }

    var body: some View {
        Button {
            if !isDone {
                completions += 1
                if !reduceMotion { burst += 1 }
                if playsSound { CompletionSound.play(preferences.custom.completionTone) }
            }
            action()
        } label: {
            ZStack {
                Circle().fill(isDone ? color : color.opacity(priority > 0 ? 0.16 : 0))
                Circle().strokeBorder(color, lineWidth: 2)
                if isDone {
                    Image(systemName: "checkmark")
                        .font(.system(size: ring * 0.5, weight: .heavy))
                        .foregroundStyle(.white)
                        .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.scale.combined(with: .opacity))
                }
            }
            .frame(width: ring, height: ring)
            .keyframeAnimator(initialValue: 1.0, trigger: burst) { view, scale in
                view.scaleEffect(scale)
            } keyframes: { _ in
                SpringKeyframe(1.28, duration: 0.13)
                SpringKeyframe(0.92, duration: 0.11)
                SpringKeyframe(1.0, duration: 0.12)
            }
            .background { BurstView(trigger: burst, color: color, size: ring) }
            .frame(width: max(Theme.checkTarget, ring), height: max(Theme.checkTarget, ring))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.success, trigger: completions)
        .animation(reduceMotion ? .easeInOut(duration: 0.15) : .spring(duration: 0.28), value: isDone)
        .accessibilityLabel(isDone ? "Mark not done" : "Complete")
        .accessibilityValue(priorityName)
    }

    /// "High priority", read after the action so VoiceOver users hear what the ring colour shows.
    private var priorityName: String {
        guard priority > 0, TableCells.priorityNames.indices.contains(priority) else { return "" }
        return "\(TableCells.priorityNames[priority]) priority"
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
            ForEach(0..<8, id: \.self) { index in
                Circle().fill(index.isMultiple(of: 2) ? color : Color(.primary))
                    .frame(width: 5, height: 5)
                    .keyframeAnimator(initialValue: BurstState(scale: 0.4), trigger: trigger) { view, state in
                        view.scaleEffect(state.scale).offset(y: -state.distance).opacity(state.opacity)
                    } keyframes: { _ in
                        KeyframeTrack(\.distance) { MoveKeyframe(0); CubicKeyframe(size * 0.78, duration: 0.56) }
                        KeyframeTrack(\.scale) { MoveKeyframe(0.4); CubicKeyframe(1, duration: 0.56) }
                        KeyframeTrack(\.opacity) {
                            MoveKeyframe(0)
                            LinearKeyframe(trigger == 0 ? 0 : 1, duration: 0.17)
                            LinearKeyframe(0, duration: 0.39)
                        }
                    }
                    .rotationEffect(.degrees(Double(index) * 45))
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
                .accessibilityActions {
                    // The press-and-hold shortcuts, reachable from the VoiceOver actions rotor.
                    ForEach(menuItems.indices.filter { !menuItems[$0].isDisabled }, id: \.self) { index in
                        Button(menuItems[index].title, action: menuItems[index].action)
                    }
                }
            }
        }
        .accessibilityLabel("Add task")
        .accessibilityShowsLargeContentViewer {
            Label("Add task", systemImage: "plus")
        }
        .accessibilityIdentifier("fab.add")
        .padding(.trailing, 21)
        .padding(.bottom, 16)
    }

    /// Fixed size, like a tab bar button: the large content viewer stands in for Dynamic Type.
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.headline)
            .padding(.horizontal, 20)
            .frame(minHeight: 50)
            .foregroundStyle(Color(.primaryForeground))
            .background(Color(.primary), in: Capsule())
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .opacity(configuration.isPressed && reduceMotion ? 0.8 : 1)
            .animation(reduceMotion ? nil : .spring(duration: 0.25, bounce: 0.4), value: configuration.isPressed)
    }
}

struct CriaSecondaryButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.headline)
            .padding(.horizontal, 20)
            .frame(minHeight: 50)
            .foregroundStyle(Color(.primary))
            .background(Color(.primarySoft), in: Capsule())
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .opacity(configuration.isPressed && reduceMotion ? 0.8 : 1)
            .animation(reduceMotion ? nil : .spring(duration: 0.25, bounce: 0.4), value: configuration.isPressed)
    }
}

/// A button with no box of its own, for rows in lists and forms: the Mac draws a grey rounded box behind each one,
/// inside the row's own card. Text is primary (destructive for a destructive role) unless the label sets its own
/// colour, a pointer over it shows the web rows' 5% wash, and the whole row stays clickable.
struct FormRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        FormRowButtonBody(configuration: configuration)
    }
}

private struct FormRowButtonBody: View {
    let configuration: ButtonStyleConfiguration
    @Environment(\.isEnabled) private var isEnabled
    @State private var hovering = false

    var body: some View {
        configuration.label
            .foregroundStyle(configuration.role == .destructive ? Color(.destructive) : Color(.primary))
            .contentShape(Rectangle())
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color(.foreground).opacity(hovering && isEnabled ? 0.05 : 0))
                    .padding(.horizontal, -6)
                    .padding(.vertical, -3)
            )
            .opacity(isEnabled ? (configuration.isPressed ? 0.6 : 1) : 0.4)
            .onHover { hovering = $0 }
    }
}

extension View {
    /// Warm grouped background behind a `List` or `Form`, rows on the cell colour. Corner radius, separators,
    /// swipe, edit mode and the scroll-edge effect stay system-drawn.
    func criaSurface() -> some View {
        #if os(macOS)
        // The system's grouped look: a second background per row reads as a box inside a box. Row buttons lose the
        // grey bezel the Mac gives a default button in a list; applied inside a sheet's toolbar, so Cancel and Save
        // keep the system style.
        // Forms take the grouped cards rather than the Mac's default two-column layout.
        buttonStyle(FormRowButtonStyle())
            .formStyle(.grouped)
        #else
        scrollContentBackground(.hidden)
            .background(Color(.grouped))
            .listRowBackground(Color(.cell))
        #endif
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
        if #available(iOS 26, macOS 26, *) {
            buttonStyle(.glassProminent).controlSize(.large)
        } else {
            buttonStyle(CriaPrimaryButtonStyle())
        }
    }
}

/// Confirm button in a sheet toolbar: glass prominent on iOS 26, bordered prominent before.
struct CriaProminentToolbarButton: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26, macOS 26, *) {
            content.buttonStyle(.glassProminent)
        } else {
            content.buttonStyle(.borderedProminent)
        }
    }
}
