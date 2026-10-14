import CriaKit
import os

/// Signposts for opening a task in the detail column, so a profile shows where the time goes between the click and
/// the editor being ready. Console: subsystem io.cria.app, category taskopen. Instruments: os_signpost.
enum TaskOpenSignposts {
    static let signposter = OSSignposter(subsystem: "io.cria.app", category: "taskopen")
    static let log = Logger(subsystem: "io.cria.app", category: "taskopen")

    static func event(_ name: StaticString, _ taskLocalId: String) {
        signposter.emitEvent(name, "\(taskLocalId, privacy: .public)")
        log.debug("\(String(describing: name), privacy: .public) \(taskLocalId, privacy: .public)")
    }

    /// The detail data read once, synchronously, so the first frame already shows the task: no "Task not found"
    /// flash, no title jumping from "Task" to the project name, no form popping in a moment later.
    static func seed(_ store: CriaStore, taskLocalId: String) -> TaskDetailData {
        let state = signposter.beginInterval("seed read")
        defer { signposter.endInterval("seed read", state) }
        guard let task = try? store.task(localId: taskLocalId), let all = try? store.projects() else {
            return TaskDetailData()
        }
        return TaskDetailData(
            task: task,
            labels: (try? store.labels(forTask: taskLocalId)) ?? [],
            allLabels: (try? store.labels()) ?? [],
            projects: ProjectTree.visible(all),
            currentProject: all.first { $0.localId == task.projectLocalId }
        )
    }
}
