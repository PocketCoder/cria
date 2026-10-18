#if os(macOS)
import CriaKit
import SwiftUI

/// The macOS design's completion ring (`MCheck` in the handoff): a circle with a 1.5pt priority stroke and a soft
/// fill. Ticking it pops the ring (360ms), draws the tick (280ms, 80ms in) and bursts a ring and six sparks (560ms,
/// the sparks 60ms in), every curve spring-smooth. `PriorityCheck` draws this on the Mac.
struct MacPriorityRing: View {
    let priority: Int
    let isDone: Bool
    var size: CGFloat = Theme.checkSize
    let action: () -> Void
    @State private var burst = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.playsCompletionSound) private var playsSound
    @Environment(\.preferences) private var preferences

    private var color: Color { ThemeToken.priority(priority).map { Color($0) } ?? MacTheme.label3 }

    var body: some View {
        Button {
            if !isDone {
                if !reduceMotion { burst += 1 }
                if playsSound { CompletionSound.play(preferences.custom.completionTone) }
            }
            action()
        } label: {
            ZStack {
                MacRingBurst(trigger: burst, color: color, size: size)
                face
            }
            .frame(width: max(Theme.checkTarget, size), height: max(Theme.checkTarget, size))
            .contentShape(Rectangle())
        }
        .buttonStyle(MacPressStyle())
        .animation(.easeOut(duration: 0.16), value: isDone)
        .accessibilityLabel(isDone ? "Mark not done" : "Complete")
        .accessibilityValue(priorityName)
    }

    /// The ring itself, which pops; the tick draws in once it is done.
    private var face: some View {
        ZStack {
            Circle().fill(isDone ? color : (priority > 0 ? color.opacity(0.16) : .clear))
            Circle().strokeBorder(color, lineWidth: 1.5)
            // Always there, so the keyframes see the tap's trigger and draw the tick in.
            Color.clear
                .keyframeAnimator(initialValue: 1.0, trigger: burst) { [tick = size * 0.62] _, progress in
                    Self.tickPath(tick)
                        .trim(from: 0, to: SpringSmooth.value(progress))
                        .stroke(.white, style: StrokeStyle(lineWidth: tick * 3.6 / 24, lineCap: .round, lineJoin: .round))
                } keyframes: { _ in
                    MoveKeyframe(0)
                    LinearKeyframe(0, duration: 0.08)
                    LinearKeyframe(1, duration: 0.28)
                }
                .frame(width: size * 0.62, height: size * 0.62)
                .opacity(isDone ? 1 : 0)
        }
        .frame(width: size, height: size)
        .keyframeAnimator(initialValue: 1.0, trigger: burst) { view, progress in
            view.scaleEffect(Self.popScale(progress))
        } keyframes: { _ in
            MoveKeyframe(0)
            LinearKeyframe(1, duration: 0.36)
        }
    }

    /// The tick from the design (`M5 13l4 4L19 7` on a 24-unit grid), drawn from its short arm.
    nonisolated private static func tickPath(_ side: CGFloat) -> Path {
        let unit = side / 24
        var path = Path()
        path.move(to: CGPoint(x: 5 * unit, y: 13 * unit))
        path.addLine(to: CGPoint(x: 9 * unit, y: 17 * unit))
        path.addLine(to: CGPoint(x: 19 * unit, y: 7 * unit))
        return path
    }

    /// `cria-check-pop`: 1, 1.28 at 35%, 0.92 at 65%, then 1, each step on the spring-smooth curve.
    nonisolated private static func popScale(_ progress: Double) -> CGFloat {
        let stops: [(stop: Double, scale: Double)] = [(0, 1), (0.35, 1.28), (0.65, 0.92), (1, 1)]
        for index in 1..<stops.count where progress <= stops[index].stop {
            let from = stops[index - 1]
            let upTo = stops[index]
            let local = SpringSmooth.value((progress - from.stop) / (upTo.stop - from.stop))
            return CGFloat(from.scale + (upTo.scale - from.scale) * local)
        }
        return 1
    }

    private var priorityName: String {
        guard priority > 0, TableCells.priorityNames.indices.contains(priority) else { return "" }
        return "\(TableCells.priorityNames[priority]) priority"
    }
}

/// The burst behind the ring: a 1.5pt ring growing from 0.7 to 2.1 times as it fades from 55%, and six sparks
/// (`cria-spark`) flying 15pt out at 60° steps, alternately the priority colour and the accent.
private struct MacRingBurst: View {
    let trigger: Int
    let color: Color
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle().strokeBorder(color, lineWidth: 1.5)
                .frame(width: size, height: size)
                .keyframeAnimator(initialValue: 1.0, trigger: trigger) { view, progress in
                    view.scaleEffect(0.7 + 1.4 * SpringSmooth.value(progress))
                        .opacity(0.55 * (1 - SpringSmooth.value(progress)))
                } keyframes: { _ in
                    MoveKeyframe(0)
                    LinearKeyframe(1, duration: 0.56)
                }
            ForEach(0..<6, id: \.self) { index in
                Circle().fill(index.isMultiple(of: 2) ? color : Color(.primary))
                    .frame(width: 3, height: 3)
                    .keyframeAnimator(initialValue: 1.0, trigger: trigger) { view, progress in
                        view.scaleEffect(0.4 + 0.6 * SpringSmooth.value(progress))
                            .offset(y: -size * 15 / 18 * SpringSmooth.value(progress))
                            .opacity(Self.sparkOpacity(progress))
                    } keyframes: { _ in
                        MoveKeyframe(0)
                        LinearKeyframe(0, duration: 0.06)
                        LinearKeyframe(1, duration: 0.56)
                    }
                    .rotationEffect(.degrees(Double(index) * 60))
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// Fades in over the first 30%, then out, each step eased.
    nonisolated private static func sparkOpacity(_ progress: Double) -> Double {
        if progress >= 1 { return 0 }
        if progress < 0.3 { return SpringSmooth.value(progress / 0.3) }
        return 1 - SpringSmooth.value((progress - 0.3) / 0.7)
    }
}

/// The design's spring-smooth curve, `cubic-bezier(0.22, 1, 0.36, 1)`, evaluated at a linear progress so keyframe
/// timelines can follow it exactly.
enum SpringSmooth {
    static func value(_ progress: Double) -> Double {
        let time = min(max(progress, 0), 1)
        guard time > 0, time < 1 else { return time }
        // Solve x(t) = time for the curve parameter by Newton steps, then read y at it.
        var param = time
        for _ in 0..<6 {
            let error = bezier(param, 0.22, 0.36) - time
            let slope = bezierSlope(param, 0.22, 0.36)
            if abs(error) < 1e-4 || abs(slope) < 1e-6 { break }
            param = min(max(param - error / slope, 0), 1)
        }
        return bezier(param, 1, 1)
    }

    private static func bezier(_ param: Double, _ first: Double, _ second: Double) -> Double {
        let inverse = 1 - param
        return 3 * inverse * inverse * param * first + 3 * inverse * param * param * second + param * param * param
    }

    private static func bezierSlope(_ param: Double, _ first: Double, _ second: Double) -> Double {
        let inverse = 1 - param
        return 3 * inverse * inverse * first + 6 * inverse * param * (second - first) + 3 * param * param * (1 - second)
    }
}

/// The design's press feedback: scale 0.94 on the spring-bouncy curve over 180ms.
struct MacPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.timingCurve(0.34, 1.56, 0.64, 1, duration: 0.18), value: configuration.isPressed)
    }
}
#endif
