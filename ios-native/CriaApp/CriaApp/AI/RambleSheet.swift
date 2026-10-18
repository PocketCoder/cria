import CriaKit
import SwiftUI

/// Turn a spoken or typed ramble into tasks. Listening starts as the sheet opens. The model writes quick-add lines in
/// the user's Quick Add Magic mode; each is parsed into a proposal the user can tick, edit or swipe away before
/// anything is created.
struct RambleSheet: View {
    let services: AppServices
    #if os(macOS)
    /// Set when hosted in the Mac quick-add panel, which has no sheet to dismiss: goes back to quick add.
    var onClose: (() -> Void)?
    #endif
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State var text = ""
    @State var proposals: [RambleProposal] = []
    @State var projects: [ProjectRecord] = []
    @State var working = false
    @State var speech = SpeechCapture()
    @State var typedBefore = ""
    @State var errorMessage: String?
    @State private var autoStarted = false
    @State private var editing: RambleProposal?
    @State private var detent = PresentationDetent.medium
    /// The model run. It keeps going if the app is switched away (see `BackgroundRun`) and stops with the sheet.
    @State var generation: Task<Void, Never>?
    @State var confirmingDiscard = false
    @FocusState private var typing: Bool

    private var mode: QuickAddMagicMode {
        QuickAddMagicMode(rawValue: UserDefaults.standard.string(forKey: QuickAddStorage.key) ?? "") ?? .default
    }

    var chosen: [RambleProposal] { Ramble.chosen(proposals) }

    /// Rows that would be lost by closing. Switching to another app never loses them; closing the sheet does.
    private var hasUnsavedRows: Bool { !chosen.isEmpty }

    @ViewBuilder var body: some View {
        #if os(macOS)
        if onClose != nil { macPanel } else { sheetContent.macSheetFrame() }
        #else
        sheetContent.macSheetFrame()
        #endif
    }

    @ViewBuilder private var sheetContent: some View {
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
                // A finished-in-the-background notice has done its job once the user is back.
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { RambleNotice.clear() }
                }
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
        // With rows to lose, a swipe down asks first (the hook turns the blocked swipe into the dialog below).
        .interactiveDismissDisabled(hasUnsavedRows)
        // On the stack, not on `content` (which swaps views when rows arrive): closing the sheet ends the model run.
        .onDisappear { generation?.cancel() }
        .confirmationDialog(
            "Discard \(Ramble.taskCount(chosen.count))?", isPresented: $confirmingDiscard, titleVisibility: .visible
        ) {
            Button("Discard", role: .destructive) { discardAndClose() }
            Button("Keep reviewing", role: .cancel) {}
        } message: {
            Text("They have not been added yet.")
        }
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
        ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { close() } }
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
                generation = Task { await generate() }
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

    var isBlank: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

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
    func startOnOpen() async {
        guard !autoStarted else { return }
        autoStarted = true
        await listen()
    }

    /// New words are appended after whatever is already in the box.
    func listen() async {
        typedBefore = text.isEmpty || text.hasSuffix(" ") || text.hasSuffix("\n") ? text : text + " "
        await speech.start()
    }

    func generate() async {
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
            let features = AIStatus.shared.features
            let spoken = text
            // Keeps running if the user switches apps; a Live Activity shows progress on iOS 26.
            let drafts = try await BackgroundRun.run(title: "Organising your ramble") {
                try await features.ramble(spoken, context: context)
            }
            if Task.isCancelled { return }
            projects = visible
            proposals = Ramble.proposals(from: drafts, projects: visible, mode: mode, knownLabels: autoTag ? labels : nil)
            errorMessage = proposals.isEmpty ? "The model found no tasks in that." : nil
            if !proposals.isEmpty {
                detent = .large
                await RambleNotice.postIfBackgrounded(count: proposals.count)
            }
        } catch {
            if Task.isCancelled { return }
            errorMessage = AIPrompts.errorMessage(String(describing: error))
        }
    }

    /// Cancel: closes straight away unless there are rows to lose.
    func close() {
        if hasUnsavedRows {
            confirmingDiscard = true
        } else {
            generation?.cancel()
            finish()
        }
    }

    func discardAndClose() {
        generation?.cancel()
        proposals = []
        finish()
    }

    func save() {
        do {
            let store = services.store
            guard let fallback = try store.captureProjectId() else {
                errorMessage = "Create a project first."
                return
            }
            for proposal in chosen {
                try store.createTask(from: proposal, fallbackProjectId: fallback)
            }
            finish()
        } catch {
            errorMessage = String(describing: error)
        }
    }

    /// Back to quick add in the Mac panel, else dismisses the sheet.
    func finish() {
        #if os(macOS)
        if let onClose {
            onClose()
            return
        }
        #endif
        dismiss()
    }
}
