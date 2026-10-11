import CriaKit
import SwiftUI

struct GanttScreen: View {
    let services: AppServices
    let projectLocalId: String

    var body: some View {
        ContentUnavailableView("Gantt", systemImage: "chart.bar.xaxis", description: Text("Coming in S-62."))
    }
}
