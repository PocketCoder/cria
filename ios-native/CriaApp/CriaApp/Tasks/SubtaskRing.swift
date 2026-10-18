import CriaKit
import SwiftUI

/// A parent's subtask progress as a small ring and "2/5": the arc fills with the share done, and turns green once
/// every subtask is.
struct SubtaskRing: View {
    let progress: SubtaskProgress
    var size: CGFloat = 11

    private var fraction: Double {
        progress.total > 0 ? Double(progress.done) / Double(progress.total) : 0
    }

    private var isComplete: Bool { progress.total > 0 && progress.done == progress.total }

    var body: some View {
        HStack(spacing: 4) {
            ZStack {
                Circle().stroke(Color.primary.opacity(0.15), lineWidth: 2)
                Circle()
                    .trim(from: 0, to: fraction)
                    .stroke(isComplete ? Color(.success) : Color(.primary), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
            .frame(width: size, height: size)
            Text("\(progress.done)/\(progress.total)").monospacedDigit()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(progress.done) of \(progress.total) subtasks done")
    }
}
