import CriaKit
import SwiftUI

/// Thin status strip: shows the running sync step, or the first error from the last cycle.
struct SyncBanner: View {
    let services: AppServices
    @State private var status = SyncStatus()

    var body: some View {
        Group {
            if let step = status.step {
                Label(step, systemImage: "arrow.triangle.2.circlepath")
            } else if let error = status.errors.first {
                Label("\(error.step): \(error.message)", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(Color(.warningText))
            }
        }
        .font(Theme.caption)
        .lineLimit(2)
        .padding(.horizontal)
        .task {
            for await next in services.coordinator.status.subscribe() {
                status = next
            }
        }
    }
}
