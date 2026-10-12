import CriaKit
import SwiftUI

/// Turn a spoken or typed ramble into tasks. Listening starts as the sheet opens. The model writes quick-add lines in
/// the user's Quick Add Magic mode; each is parsed into a proposal the user can tick, edit or swipe away before
/// anything is created.
struct RambleSheet: View {
    let services: AppServices
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var text = ""
    @State private var proposals: [RambleProposal] = []
    @State private var projects: [ProjectRecord] = []
    @State private var working = false
    @State private var speech = SpeechCapture()
    @State private var typedBefore = ""
    @State private var errorMessage: String?
    @State private var autoStarted = false
    @State private var editing: RambleProposal?
    @State private var detent = PresentationDetent.medium
    @FocusState private var typing: Bool

    private var mode: QuickAddMagicMode {
        QuickAddMagicMode(rawValue: UserDefaults.standard.string(forKey: QuickAddStorage.key) ?? "") ?? .default
    }

    private var chosen: [RambleProposal] { Ramble.chosen(proposals) }

    var body: some View {
        NavigationStack {
            content
                .background(Color(.grouped))
                .onChange(of: speech.transcript) { _, spoken in
                    guard speech.isCapturing else { return }
                    text = typedBefore + spoken
                }
                // Typing pauses the mic, so dictation and the keyboard do not fight over the text.
                .onChange(of: typing) { _, focused in
                    if focused { speech.stop() }
                }
                .task { await startOnOpen() }
                .onDisappear { speech.stop() }
                .navigationTitle("Ramble")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { toolbar }
                .sheet(item: $editing) { proposal in
                    RambleProposalEditor(proposal: proposal, projects: projects, mode: mode) { updated in
                        if let index = proposals.firstIndex(where: { $0.id == updated.id }) { proposals[index] = updated }
                    }
                }
        }
        .presentationDetents([.medium, .large], selection: $detent)
    }

    @ViewBuilder private var content: some View {
        if proposals.isEmpty {
            ScrollView {
                inputSection.padding(16)
            }
        } else {
            RambleReviewList(
                proposals: $proposals,
                projects: projects,
                errorMessage: errorMessage,
                onEdit: { editing = $0 },
                onStartOver: {
                    proposals = []
                    errorMessage = nil
                }
            )
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }
        if !proposals.isEmpty {
            ToolbarItem(placement: .confirmationAction) {
                Button("Add \(Ramble.taskCount(chosen.count))", systemImage: "checkmark") { save() }
                    .disabled(chosen.isEmpty)
                    .modifier(CriaProminentToolbarButton())
            }
        }
    }

    private var inputSection: some View {
        VStack(spacing: 16) {
            transcript
            micButton
            Text(statusLine).font(Theme.caption).foregroundStyle(Color(.mutedForeground)).multilineTextAlignment(.center)
            if let problem = speech.problem {
                Text(problem).font(Theme.caption).foregroundStyle(Color(.destructive))
            }
            Button {
                Task { await generate() }
            } label: {
                Text(working ? "Organising…" : "Make a task list")
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(CriaPrimaryButtonStyle())
            .disabled(working || isBlank)
            .opacity(isBlank ? 0.4 : 1)
            if let errorMessage {
                Text(errorMessage).font(Theme.caption).foregroundStyle(Color(.destructive))
            }
        }
    }

    private var isBlank: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private var statusLine: String {
        if speech.isListening { return "Listening… say everything on your mind. Tap pause to stop, or tap the text to type." }
        return "Tap the mic to talk, or type. Dates stay in words."
    }

    /// The live transcript, quoted. Editable so a mis-heard word can be fixed before the model reads it.
    private var transcript: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: $text)
                .font(.system(size: 17))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 120)
                .focused($typing)
            if text.isEmpty {
                Text("“…”").font(.system(size: 17)).foregroundStyle(Color(.mutedForeground))
                    .padding(.horizontal, 5).padding(.vertical, 8).allowsHitTesting(false)
            }
        }
        .padding(12)
        .background(Color(.cell), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    /// 64pt prominent circle with a caption. Listening shows pause and pulses (scale 1, 1.08, 1 over 1.4s); Reduce
    /// Motion turns the pulse off.
    private var micButton: some View {
        Button {
            Task {
                if speech.isListening {
                    speech.stop()
                } else {
                    typing = false
                    await listen()
                }
            }
        } label: {
            VStack(spacing: 6) {
                Image(systemName: speech.isListening ? "pause.fill" : "mic.fill")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(Color(.primaryForeground))
                    .frame(width: 64, height: 64)
                    .background(Color(.primary), in: Circle())
                    .phaseAnimator([1.0, 1.08]) { view, scale in
                        view.scaleEffect(speech.isListening && !reduceMotion ? scale : 1)
                    } animation: { _ in .easeInOut(duration: 0.7) }
                Text(speech.isListening ? "Pause" : "Talk").font(Theme.chip).foregroundStyle(Color(.primary))
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(speech.isListening ? "Pause listening" : "Start listening")
    }

    /// Listening starts as soon as the sheet opens (after the permission prompt the first time).
    private func startOnOpen() async {
        guard !autoStarted else { return }
        autoStarted = true
        await listen()
    }

    /// New words are appended after whatever is already in the box.
    private func listen() async {
        typedBefore = text.isEmpty || text.hasSuffix(" ") || text.hasSuffix("\n") ? text : text + " "
        await speech.start()
    }

    private func generate() async {
        working = true
        defer { working = false }
        typing = false
        await speech.finish()
        do {
            let store = services.store
            let visible = ProjectTree.visible(try store.projects())
            let labels = try store.labels().map(\.title)
            let autoTag = PreferencesStore().load().rambleChoosesTags
            let context = AIPrompts.RambleContext(projects: visible.map(\.title), labels: labels, mode: mode, autoTag: autoTag)
            let drafts = try await AIStatus.shared.features.ramble(text, context: context)
            projects = visible
            proposals = Ramble.proposals(from: drafts, projects: visible, mode: mode, knownLabels: autoTag ? labels : nil)
            errorMessage = proposals.isEmpty ? "The model found no tasks in that." : nil
            if !proposals.isEmpty { detent = .large }
        } catch {
            errorMessage = AIPrompts.errorMessage(String(describing: error))
        }
    }

    private func save() {
        do {
            let store = services.store
            guard let fallback = try store.captureProjectId() else {
                errorMessage = "Create a project first."
                return
            }
            for proposal in chosen {
                try store.createTask(from: proposal, fallbackProjectId: fallback)
            }
            dismiss()
        } catch {
            errorMessage = String(describing: error)
        }
    }
}
