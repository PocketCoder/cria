import CriaKit
import SwiftUI
import UIKit

struct OutboxData: Equatable, Sendable {
    var waiting: [OutboxRow] = []
    var failed: [DeadLetterRow] = []
}

/// The sync queue: changes waiting to go out, and changes that ran out of retries. Retry puts a failed change back in
/// the queue; discard drops it (the item on this device stays as it is). Mirrors `OutboxModal.tsx`.
struct OutboxView: View {
    let services: AppServices
    @State private var live: LiveValue<OutboxData>
    @State private var failure: String?
    @State private var pendingDiscard: OutboxRow?
    @State private var confirmRetryAll = false
    @State private var confirmDiscardAll = false

    init(services: AppServices) {
        self.services = services
        let store = services.store
        _live = State(initialValue: LiveValue(initial: OutboxData()) {
            observeStore(store, kinds: [.outbox]) { reading in
                OutboxData(waiting: try reading.outboxRows(), failed: try reading.deadLetters())
            }
        })
    }

    var body: some View {
        List {
            if !live.value.waiting.isEmpty { waitingSection }
            if !live.value.failed.isEmpty { failedSection }
        }
        .overlay {
            if live.value.waiting.isEmpty && live.value.failed.isEmpty {
                ContentUnavailableView("Everything's synced", systemImage: "checkmark.circle",
                                       description: Text("Nothing is waiting to sync."))
            }
        }
        .navigationTitle("Sync queue")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Sync now", systemImage: "arrow.triangle.2.circlepath") { syncNow() }
            }
        }
        .confirmationDialog(
            "Discard this change?",
            isPresented: Binding(get: { pendingDiscard != nil }, set: { if !$0 { pendingDiscard = nil } }),
            titleVisibility: .visible,
            presenting: pendingDiscard
        ) { row in
            Button("Discard", role: .destructive) { perform { try services.store.discardOutboxOp(id: row.id) } }
        } message: { _ in
            Text("It will not be sent to the server. The item on this device stays as it is. Use this when the first "
                 + "change is stuck and holds up the rest.")
        }
        .confirmationDialog("Retry all failed changes?", isPresented: $confirmRetryAll, titleVisibility: .visible) {
            Button("Retry all") { retryAll() }
        }
        .confirmationDialog("Discard all failed changes?", isPresented: $confirmDiscardAll, titleVisibility: .visible) {
            Button("Discard all", role: .destructive) { perform { try services.store.clearDeadLetters() } }
        } message: {
            Text("They will not be sent to the server. The items on this device stay as they are.")
        }
        .alert("Something went wrong", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
        .task { await live.run() }
    }

    private var waitingSection: some View {
        Section {
            ForEach(Array(live.value.waiting.enumerated()), id: \.element.id) { index, row in
                OutboxRowView(row: OutboxRowSummary(row), highlight: index == 0)
                    .swipeActions(edge: .trailing) {
                        Button("Discard", systemImage: "trash") { pendingDiscard = row }.tint(.red)
                    }
                    .contextMenu {
                        Button("Copy details", systemImage: "doc.on.doc") { UIPasteboard.general.string = OutboxRowSummary(row).text }
                        Button("Discard", systemImage: "trash", role: .destructive) { pendingDiscard = row }
                    }
            }
        } header: {
            Text("Waiting to sync (\(live.value.waiting.count))")
        } footer: {
            Text("Changes go out in order, so the first one holds up the rest. If it is stuck, its error says why; discard it "
                 + "to let the others through.")
        }
    }

    private var failedSection: some View {
        Section {
            ForEach(live.value.failed, id: \.id) { row in
                OutboxRowView(row: OutboxRowSummary(row), highlight: true)
                    .swipeActions(edge: .leading) {
                        Button("Retry", systemImage: "arrow.clockwise") { retry(row.id) }.tint(Color(.primary))
                    }
                    .swipeActions(edge: .trailing) {
                        Button("Discard", systemImage: "trash", role: .destructive) { discard(row.id) }
                    }
                    .contextMenu {
                        Button("Retry", systemImage: "arrow.clockwise") { retry(row.id) }
                        Button("Copy details", systemImage: "doc.on.doc") { UIPasteboard.general.string = OutboxRowSummary(row).text }
                        Button("Discard", systemImage: "trash", role: .destructive) { discard(row.id) }
                    }
            }
            Button("Retry all") { confirmRetryAll = true }
            Button("Discard all", role: .destructive) { confirmDiscardAll = true }
        } header: {
            Text("Failed (\(live.value.failed.count))")
        } footer: {
            Text("These ran out of automatic retries. Retry puts them back in the queue; discard drops them.")
        }
    }

    private func retry(_ id: Int) {
        perform { try services.store.retryDeadLetter(id: id) }
        syncNow()
    }

    private func retryAll() {
        perform {
            for row in live.value.failed { try services.store.retryDeadLetter(id: row.id) }
        }
        syncNow()
    }

    private func discard(_ id: Int) {
        perform { try services.store.discardDeadLetter(id: id) }
    }

    private func syncNow() {
        Task { await services.refresh() }
    }

    private func perform(_ action: () throws -> Void) {
        do {
            try action()
        } catch {
            failure = String(describing: error)
        }
    }
}
