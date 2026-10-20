import CriaKit
import SwiftUI

/// The options for a new share link: who can do what with it, an optional name and an optional password.
/// `onCreate` runs the request (the sharing sheet reloads its list afterwards).
struct NewLinkShareSheet: View {
    let onCreate: (SharePermission, String?, String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var permission = SharePermission.read
    @State private var name = ""
    @State private var password = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Permission", selection: $permission) {
                        ForEach(SharePermission.allCases, id: \.self) { level in
                            Text(level.label).tag(level)
                        }
                    }
                }
                Section {
                    TextField("Name (optional)", text: $name)
                    SecureField("Password (optional)", text: $password)
                } footer: {
                    Text("A password is asked for when someone opens the link.")
                }
            }
            .navigationTitle("New link")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
                        onCreate(permission, trimmed.isEmpty ? nil : trimmed, password.isEmpty ? nil : password)
                        dismiss()
                    }
                }
            }
        }
        .macSheetFrame(width: 420, height: 300)
    }
}
