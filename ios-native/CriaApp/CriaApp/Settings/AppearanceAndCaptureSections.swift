import CriaKit
import SwiftUI

/// Settings > Appearance: colour scheme (read by `RootView`) and the completion sound (read by `PriorityCheck`). Both
/// follow the account (`PreferencesModel` pushes them), as on desktop.
struct AppearanceSettingsSection: View {
    @ObservedObject var prefs: PreferencesModel

    var body: some View {
        Section {
            Picker(selection: $prefs.value.colorScheme) {
                ForEach(ColorSchemePreference.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
            } label: {
                SettingsLabel("Theme", symbol: "moon", token: .llama800)
            }
            Toggle(isOn: $prefs.value.playSoundWhenDone) {
                SettingsLabel("Sound when completing a task", symbol: "speaker.wave.2", token: .plum500)
            }
        } header: {
            Text("Appearance")
        } footer: {
            Text("Theme and sound follow your account to your other devices.")
        }
    }
}

/// Settings > Photo capture: the project and label `ShoppingPhotoSheet` starts with. Blank project means ask each time.
struct PhotoCaptureSettingsSection: View {
    @ObservedObject var prefs: PreferencesModel
    let projects: [ProjectRecord]

    var body: some View {
        Section {
            Picker(selection: Binding(
                get: { prefs.value.photoProjectId ?? "" },
                set: { id in prefs.value.photoProjectId = id.isEmpty ? nil : id }
            )) {
                Text("Ask each time").tag("")
                ForEach(projects, id: \.localId) { Text($0.title).tag($0.localId) }
            } label: {
                SettingsLabel("Default project", symbol: "camera", token: .sky500)
            }
            LabeledContent {
                TextField("None", text: $prefs.value.photoLabel)
                    .multilineTextAlignment(.trailing)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } label: {
                SettingsLabel("Default label", symbol: "tag", token: .meadow500)
            }
        } header: {
            Text("Photo capture")
        } footer: {
            Text("Defaults for creating tasks from a photo of a list. You can change them each time you import.")
        }
    }
}
