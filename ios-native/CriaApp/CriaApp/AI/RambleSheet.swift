import CriaKit
import SwiftUI

/// Turn a spoken or typed ramble into tasks. The model writes quick-add lines in the user's Quick Add Magic mode;
/// the user reviews them, then each becomes a task through the usual quick-add parser.
struct RambleSheet: View {
    let services: AppServices
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var drafts: [RambleDraft] = []
    @State private var working = false
    @State private var speech = SpeechCapture()
    @State private var typedBefore = ""
    @State private var errorMessage: String?

    private var mode: QuickAddMagicMode {
        QuickAddMagicMode(rawValue: UserDefaults.standard.string(forKey: QuickAddStorage.key) ?? "") ?? .default
    }

    private var chosen: [RambleDraft] { Ramble.chosen(drafts, mode: mode) }

    var body: some View {
        NavigationStack {
            Form {
                if drafts.isEmpty {
                    inputSection
                } else {
                    reviewSection
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(Color(.destructive)) }
                }
            }
            .criaSurface()
            .onChange(of: speech.transcript) { _, spoken in
                guard speech.isCapturing else { return }
                text = typedBefore + spoken
            }
            .onDisappear { speech.stop() }
            .navigationTitle("Ramble")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }
                if !drafts.isEmpty {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Add \(Ramble.taskCount(chosen.count))", systemImage: "checkmark") { save() }
                            .disabled(chosen.isEmpty)
                            .modifier(CriaProminentToolbarButton())
                    }
                }
            }
        }
    }

    private var inputSection: some View {
        Section {
            TextEditor(text: $text).frame(minHeight: 160)
            micButton
            if let problem = speech.problem {
                Text(problem).font(Theme.caption).foregroundStyle(Color(.destructive))
            }
            Button(working ? "Organising…" : "Make a task list") {
                speech.stop()
                Task { await generate() }
            }
            .disabled(working || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        } footer: {
            Text("Talk or type everything on your mind. Dates stay in words and are resolved when the tasks are added.")
        }
    }

    private var micButton: some View {
        Button {
            Task {
                if !speech.isListening {
                    let spaced = text.isEmpty || text.hasSuffix(" ") || text.hasSuffix("\n") ? text : text + " "
                    typedBefore = spaced
                }
                await speech.toggle()
            }
        } label: {
            Label(speech.isListening ? "Stop listening" : "Speak", systemImage: speech.isListening ? "stop.circle.fill" : "mic.circle.fill")
                .symbolEffect(.pulse, isActive: speech.isListening)
        }
        .tint(speech.isListening ? Color(.destructive) : Color(.primary))
    }

    private var reviewSection: some View {
        Section("Review") {
            ForEach($drafts) { $draft in
                VStack(alignment: .leading, spacing: 4) {
                    Toggle(isOn: $draft.include) {
                        TextField("Task", text: $draft.line)
                    }
                    if let notes = draft.notes {
                        Text(notes).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                    }
                    if let suggestion = draft.suggestion {
                        Text("Suggested: \(suggestion)").font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                    }
                }
            }
            Button("Start over", role: .destructive) { drafts = [] }
        }
    }

    private func generate() async {
        working = true
        defer { working = false }
        do {
            let store = services.store
            let projects = try store.projects().map(\.title)
            let labels = try store.labels().map(\.title)
            let context = AIPrompts.RambleContext(projects: projects, labels: labels, mode: mode)
            drafts = try await AIStatus.shared.features.ramble(text, context: context)
            errorMessage = drafts.isEmpty ? "The model found no tasks in that." : nil
        } catch {
            errorMessage = AIPrompts.errorMessage(String(describing: error))
        }
    }

    private func save() {
        do {
            let store = services.store
            let projects = ProjectTree.visible(try store.projects())
            guard let fallback = try store.captureProjectId() else {
                errorMessage = "Create a project first."
                return
            }
            for draft in chosen {
                try store.createFromQuickAdd(
                    line: draft.line, projects: projects, fallbackProjectId: fallback, mode: mode, notes: draft.notes
                )
            }
            dismiss()
        } catch {
            errorMessage = String(describing: error)
        }
    }
}
