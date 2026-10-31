import CriaKit
import SwiftUI

/// Ramble inside the Mac quick-add panel: a header with back, the title and an "On device" chip; a 64pt mic with a
/// pulsing halo, the live transcript in SF 15/22 and "Done talking"; then a review list ending in "Add N Tasks".
extension RambleSheet {
    var macPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            MacPanelHeader(title: "Ramble", onBack: close) {
                CriaChip(text: "On device", systemImage: "lock.fill", tint: MacTheme.label2)
            }
            Divider()
            if proposals.isEmpty {
                listening
            } else {
                review
            }
        }
        .frame(height: 460)
        .onChange(of: speech.transcript) { _, spoken in
            guard speech.isCapturing else { return }
            text = typedBefore + spoken
        }
        .task { await startOnOpen() }
        .onDisappear {
            speech.stop()
            generation?.cancel()
        }
        .onExitCommand { close() }
        .confirmationDialog(
            "Discard \(Ramble.taskCount(chosen.count))?", isPresented: $confirmingDiscard, titleVisibility: .visible
        ) {
            Button("Discard", role: .destructive) { discardAndClose() }
            Button("Keep reviewing", role: .cancel) {}
        }
    }

    private var listening: some View {
        VStack(spacing: 16) {
            RambleMicButton(isListening: speech.isListening) {
                Task {
                    if speech.isListening { speech.stop() } else { await listen() }
                }
            }
            .padding(.top, 20)
            ScrollView {
                TextField("Say everything on your mind…", text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.system(size: 15))
                    .lineSpacing(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 24)
            if let problem = speech.problem {
                Text(problem).font(.system(size: 12)).foregroundStyle(Color(.destructive))
            }
            if let errorMessage {
                Text(errorMessage).font(.system(size: 12)).foregroundStyle(Color(.destructive))
            }
            Button {
                generation = Task { await generate() }
            } label: {
                Text(working ? "Organising…" : "Done talking").frame(minWidth: 120).frame(height: 30)
            }
            .buttonStyle(.borderedProminent)
            .disabled(working || isBlank)
            .padding(.bottom, 16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var review: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 0) {
                    ForEach($proposals) { $proposal in
                        MacReviewRow(include: $proposal.include, title: proposal.title, dueDate: proposal.dueDate)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 8)
            }
            if let errorMessage {
                Text(errorMessage).font(.system(size: 12)).foregroundStyle(Color(.destructive))
            }
            Divider()
            HStack {
                Button("Start over") { proposals = []; errorMessage = nil }
                Spacer()
                Button(action: save) {
                    Text(MacReviewRow.addLabel(chosen.count)).padding(.horizontal, 4).frame(height: 30)
                }
                .buttonStyle(.borderedProminent)
                .disabled(chosen.isEmpty)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
        }
    }
}

/// Back, a title and trailing accessories, for the panel's Ramble and From photo screens.
struct MacPanelHeader<Accessory: View>: View {
    let title: String
    let onBack: () -> Void
    @ViewBuilder var accessory: Accessory

    var body: some View {
        HStack(spacing: 10) {
            Button(action: onBack) { Image(systemName: "chevron.left") }
                .buttonStyle(.borderless)
                .accessibilityLabel("Back")
            Text(title).font(.system(size: 15, weight: .semibold))
            Spacer()
            accessory
        }
        .padding(EdgeInsets(top: 14, leading: 18, bottom: 12, trailing: 18))
    }
}

/// The 64pt mic with a halo that pulses every 1.6s while listening. Reduce Motion keeps the halo still.
struct RambleMicButton: View {
    let isListening: Bool
    let action: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: action) {
            ZStack {
                if isListening {
                    Circle()
                        .fill(Color(.primary).opacity(0.18))
                        .frame(width: 64, height: 64)
                        .phaseAnimator([1.0, 1.45]) { view, scale in
                            view.scaleEffect(reduceMotion ? 1.2 : scale).opacity(reduceMotion ? 1 : 1.6 - scale)
                        } animation: { _ in .easeInOut(duration: 0.8) }
                }
                Image(systemName: isListening ? "pause.fill" : "mic.fill")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(Color(.primaryForeground))
                    .frame(width: 64, height: 64)
                    .background(Color(.primary), in: Circle())
            }
            .frame(width: 96, height: 96)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isListening ? "Pause listening" : "Start listening")
    }
}

/// One reviewed task: a checkbox, the title and, when it has one, a date chip.
struct MacReviewRow: View {
    @Binding var include: Bool
    let title: String
    var dueDate: String?
    @Environment(\.dateDisplay) private var dateDisplay

    static func addLabel(_ count: Int) -> String { "Add \(count) Task\(count == 1 ? "" : "s")" }

    var body: some View {
        HStack(spacing: 10) {
            Toggle(isOn: $include) { EmptyView() }
                .toggleStyle(.checkbox)
                .labelsHidden()
            Text(title)
                .font(.system(size: 13))
                .foregroundStyle(include ? Color(.foreground) : MacTheme.label3)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let dueDate {
                CriaChip(text: DueDates.label(dueDate, now: Date(), display: dateDisplay), systemImage: "calendar",
                         tint: Color(.sky700))
            }
        }
        .frame(minHeight: 32)
    }
}
