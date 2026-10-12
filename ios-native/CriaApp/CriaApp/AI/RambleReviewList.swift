import CriaKit
import SwiftUI

/// The review step after a ramble: one row per proposed task with its date, project, labels and priority as chips.
/// The circle ticks a task in or out, a tap on the row edits it, and a swipe removes it.
struct RambleReviewList: View {
    @Binding var proposals: [RambleProposal]
    let projects: [ProjectRecord]
    let errorMessage: String?
    let onEdit: (RambleProposal) -> Void
    let onStartOver: () -> Void

    var body: some View {
        List {
            Section {
                ForEach($proposals) { $proposal in
                    RambleProposalRow(
                        proposal: $proposal,
                        projectTitle: projects.first { $0.localId == proposal.projectLocalId }?.title,
                        onEdit: { onEdit(proposal) }
                    )
                }
                .onDelete { proposals.remove(atOffsets: $0) }
            } header: {
                Text("\(Ramble.taskCount(Ramble.chosen(proposals).count)) to add · tap one to edit")
            } footer: {
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(Color(.destructive))
                }
            }
            Section {
                Button("Start over", role: .destructive, action: onStartOver)
            }
        }
        .criaSurface()
    }
}

/// One proposal: include toggle, then the title and its chips. Only the trailing part opens the editor, so the
/// toggle stays a separate target.
struct RambleProposalRow: View {
    @Binding var proposal: RambleProposal
    let projectTitle: String?
    let onEdit: () -> Void
    @Environment(\.dateDisplay) private var dateDisplay

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button {
                proposal.include.toggle()
            } label: {
                Image(systemName: proposal.include ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(proposal.include ? Color(.primary) : Color(.mutedForeground))
                    .frame(minWidth: 28, minHeight: 28)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(proposal.include ? "Included" : "Excluded")
            Button(action: onEdit) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(proposal.title)
                        .font(.system(size: 16))
                        .foregroundStyle(proposal.include ? Color(.foreground) : Color(.mutedForeground))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    chips
                    if let notes = proposal.notes {
                        Text(notes).font(Theme.caption).foregroundStyle(Color(.mutedForeground)).lineLimit(2)
                    }
                    if let suggestion = proposal.suggestion {
                        Text("Suggested: \(suggestion)").font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Edit before adding")
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder private var chips: some View {
        let repeats = proposal.repeatAfter > 0 || proposal.repeatMode > 0
        if proposal.dueDate != nil || projectTitle != nil || !proposal.labelTitles.isEmpty || proposal.priority > 0 {
            HStack(spacing: 6) {
                if let due = proposal.dueDate {
                    CriaChip(text: DueDates.label(due, now: Date(), display: dateDisplay),
                             systemImage: repeats ? "repeat" : "calendar", tint: Color(.primary))
                }
                if let projectTitle {
                    CriaChip(text: projectTitle, systemImage: "folder", tint: Color(.mutedForeground))
                }
                ForEach(proposal.labelTitles.prefix(3), id: \.self) { title in
                    CriaChip(text: title, systemImage: "tag", tint: Color(.info))
                }
                if proposal.priority > 0 {
                    CriaChip(text: "P\(proposal.priority)", systemImage: "flag", tint: Color(.marigold700))
                }
            }
        }
    }
}
