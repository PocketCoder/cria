import SwiftUI
import CriaKit

@main
struct CriaApp: App {
    var body: some Scene {
        WindowGroup {
            Text("Cria \(CriaKit.version)")
                .padding()
        }
    }
}
