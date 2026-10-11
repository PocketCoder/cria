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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var mode: QuickAddMagicMode {
        QuickAddMagicMode(rawValue: UserDefaults.standard.string(forKey: QuickAddStorage.key) ?? "") ?? .default
    }

    private var chosen: [RambleDraft] { Ramble.chosen(drafts, mode: mode) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    if drafts.isEmpty {
                        inputSection
                    } else {
                        reviewSection
                    }
                    if let errorMessage {
                        Text(errorMessage).font(Theme.caption).foregroundStyle(Color(.destructive))
                    }
                }
                .padding(16)
            }
            .background(Color(.grouped))
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
                            .disabled(chosen.isEmpty || speech.isListening)
                            .modifier(CriaProminentToolbarButton())
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var inputSection: some View {
        VStack(spacing: 16) {
            transcript
            micButton
            Text(statusLine).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
            if let problem = speech.problem {
                Text(problem).font(Theme.caption).foregroundStyle(Color(.destructive))
            }
            Button {
                speech.stop()
                Task { await generate() }
            } label: {
                Text(working ? "Organising…" : "Make a task list")
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(CriaPrimaryButtonStyle())
            .disabled(working || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .opacity(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.4 : 1)
        }
    }

    private var statusLine: String {
        speech.isListening ? "Listening… tap to finish" : "Talk or type everything on your mind. Dates stay in words."
    }

    /// The live transcript, quoted. Editable so a mis-heard word can be fixed before the model reads it.
    private var transcript: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: $text)
                .font(.system(size: 17))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 120)
            if text.isEmpty {
                Text("“…”").font(.system(size: 17)).foregroundStyle(Color(.mutedForeground))
                    .padding(.horizontal, 5).padding(.vertical, 8).allowsHitTesting(false)
            }
        }
        .padding(12)
        .background(Color(.cell), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    /// 64pt prominent circle. Listening shows a filled stop and pulses (scale 1, 1.08, 1 over 1.4s); Reduce Motion
    /// turns the pulse off.
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
            Image(systemName: speech.isListening ? "stop.fill" : "mic")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(Color(.primaryForeground))
                .frame(width: 64, height: 64)
                .background(Color(.primary), in: Circle())
                .phaseAnimator([1.0, 1.08]) { view, scale in
                    view.scaleEffect(speech.isListening && !reduceMotion ? scale : 1)
                } animation: { _ in .easeInOut(duration: 0.7) }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(speech.isListening ? "Stop listening" : "Speak")
    }

    private var reviewSection: some View {
        VStack(spacing: 12) {
            Text("\(Ramble.taskCount(chosen.count)) found on-device · tap ✓ to add")
                .font(Theme.caption).foregroundStyle(Color(.mutedForeground))
            VStack(spacing: 0) {
                ForEach($drafts) { $draft in
                    HStack(alignment: .top, spacing: 12) {
                        Button {
                            draft.include.toggle()
                        } label: {
                            Image(systemName: draft.include ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 22))
                                .foregroundStyle(draft.include ? Color(.primary) : Color(.mutedForeground))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(draft.include ? "Included" : "Excluded")
                        VStack(alignment: .leading, spacing: 4) {
                            TextField("Task", text: $draft.line, axis: .vertical).font(.system(size: 16))
                            if let notes = draft.notes {
                                Text(notes).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                            }
                            if let suggestion = draft.suggestion {
                                Text("Suggested: \(suggestion)").font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                            }
                        }
                    }
                    .padding(.vertical, 12)
                    .padding(.horizontal, 14)
                }
            }
            .background(Color(.cell), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            Button("Start over", role: .destructive) { drafts = [] }.font(Theme.rowSubtitle)
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
