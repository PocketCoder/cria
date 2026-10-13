import CriaKit
import SwiftUI

/// The bulk action bar shown while selecting: Complete, Schedule, Defer, Move, Priority and Delete.
struct SelectionBar: View {
    let count: Int
    let onComplete: () -> Void
    let onSchedule: () -> Void
    let onDefer: (DeferPreset) -> Void
    let onMove: () -> Void
    let onPriority: (Int) -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Text(count == 0 ? "Select tasks" : "\(count) selected")
                .font(Theme.footnote.weight(.medium))
                .foregroundStyle(Color(.mutedForeground))
                .padding(.top, 6)
            actions
        }
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
    }

    private var actions: some View {
        HStack(spacing: 0) {
            Button(action: onComplete) { barLabel("Complete", "checkmark.circle") }
            Button(action: onSchedule) { barLabel("Schedule", "calendar") }
            Menu {
                ForEach(DeferPreset.allCases, id: \.self) { preset in
                    Button(preset.title) { onDefer(preset) }
                }
            } label: {
                barLabel("Defer", "clock.arrow.circlepath")
            }
            Button(action: onMove) { barLabel("Move", "folder") }
            Menu {
                ForEach([5, 4, 3, 2, 1, 0], id: \.self) { priority in
                    Button(priority == 0 ? "No priority" : TableCells.priorityNames[priority]) { onPriority(priority) }
                }
            } label: {
                barLabel("Priority", "flag")
            }
            Button(role: .destructive, action: onDelete) { barLabel("Delete", "trash") }
                .tint(Color(.destructive))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color(.foreground))
        .disabled(count == 0)
        .padding(.bottom, 2)
    }

    private func barLabel(_ title: String, _ systemImage: String) -> some View {
        VStack(spacing: 2) {
            Image(systemName: systemImage).font(.title3)
            Text(title).font(Theme.footnote)
        }
        .frame(maxWidth: .infinity, minHeight: 48)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// A project to move the selected tasks to.
struct BulkMoveSheet: View {
    let services: AppServices
    let onPick: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var projects: [ProjectRecord] = []

    var body: some View { sheetContent.macSheetFrame() }

    @ViewBuilder private var sheetContent: some View {
        NavigationStack {
            List(projects, id: \.localId) { project in
                Button {
                    onPick(project.localId)
                    dismiss()
                } label: {
                    HStack(spacing: 10) {
                        Circle()
                            .fill(Color(hexString: project.hexColor) ?? Color(.mutedForeground))
                            .frame(width: 10, height: 10)
                            .accessibilityHidden(true)
                        Text(project.title).foregroundStyle(Color(.foreground))
                    }
                }
            }
            .criaSurface()
            .navigationTitle("Move to")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }
            }
            .task { projects = ProjectTree.visible((try? services.store.projects()) ?? []) }
        }
        .presentationDetents([.medium, .large])
    }
}
