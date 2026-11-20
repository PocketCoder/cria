import CriaKit
import SwiftUI

/// How a project shows on the Mac: its server colour muted into one lightness band, and an optional custom icon in
/// place of the default ring. The server's colour is never changed; only its display is.
extension MacTheme {
    /// A project or label colour from Vikunja, with its hue kept, its lightness set to 70% (78% for yellows, which
    /// read darker) and its chroma capped at 0.13 in OKLCH, so the sidebar's colours sit together. Near-greys and
    /// missing colours give the tertiary text shade.
    static func projectColour(hex: String?) -> Color {
        guard let raw = hex?.trimmingCharacters(in: CharacterSet(charactersIn: "# ")),
              raw.count == 6, let value = UInt32(raw, radix: 16),
              let muted = MutedColour(rgb: value) else { return label3 }
        return Color(.sRGB, red: muted.red, green: muted.green, blue: muted.blue, opacity: 1)
    }
}

/// The OKLab round trip behind `MacTheme.projectColour`.
private struct MutedColour {
    let red: Double
    let green: Double
    let blue: Double

    init?(rgb: UInt32) {
        let lin = [(rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF].map { Self.linear(Double($0) / 255) }
        let lms = [
            0.4122214708 * lin[0] + 0.5363325363 * lin[1] + 0.0514459929 * lin[2],
            0.2119034982 * lin[0] + 0.6806995451 * lin[1] + 0.1073969566 * lin[2],
            0.0883024619 * lin[0] + 0.2817188376 * lin[1] + 0.6299787005 * lin[2]
        ].map { cbrt($0) }
        let labA = 1.9779984951 * lms[0] - 2.4285922050 * lms[1] + 0.4505937099 * lms[2]
        let labB = 0.0259040371 * lms[0] + 0.7827717662 * lms[1] - 0.8086757660 * lms[2]
        let chroma = (labA * labA + labB * labB).squareRoot()
        // Greys and near-greys have no hue worth keeping.
        guard chroma >= 0.03 else { return nil }
        var hue = atan2(labB, labA) * 180 / .pi
        if hue < 0 { hue += 360 }
        let lightness = (70...115).contains(hue) ? 0.78 : 0.70
        let capped = min(chroma, 0.13)
        let newA = capped * cos(hue * .pi / 180)
        let newB = capped * sin(hue * .pi / 180)
        let lPrime = lightness + 0.3963377774 * newA + 0.2158037573 * newB
        let mPrime = lightness - 0.1055613458 * newA - 0.0638541728 * newB
        let sPrime = lightness - 0.0894841775 * newA - 1.2914855480 * newB
        let cubes = [lPrime, mPrime, sPrime].map { $0 * $0 * $0 }
        red = Self.encoded(4.0767416621 * cubes[0] - 3.3077115913 * cubes[1] + 0.2309699292 * cubes[2])
        green = Self.encoded(-1.2684380046 * cubes[0] + 2.6097574011 * cubes[1] - 0.3413193965 * cubes[2])
        blue = Self.encoded(-0.0041960863 * cubes[0] - 0.7034186147 * cubes[1] + 1.7076147010 * cubes[2])
    }

    private static func linear(_ channel: Double) -> Double {
        channel <= 0.04045 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
    }

    private static func encoded(_ channel: Double) -> Double {
        let clamped = min(max(channel, 0), 1)
        return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * pow(clamped, 1 / 2.4) - 0.055
    }
}

/// Custom project icons, kept in `Customisation.projectIcons` (synced through `frontend_settings.cria`) by project.
enum MacProjectIcons {
    /// Where the first Mac build kept icons, on this Mac only, by local id. Moved into the account once at launch.
    private static let legacyKey = "mac.projectIcons"

    /// The icons offered under a project's Icon menu and in its picker, with their names.
    static let choices: [MacProjectIconChoice] = [
        .init("house", "House"), .init("server.rack", "Server"), .init("heart", "Heart"), .init("bag", "Shopping bag"),
        .init("briefcase", "Briefcase"), .init("book", "Book"), .init("airplane", "Travel"), .init("dumbbell", "Fitness"),
        .init("music.note", "Music"), .init("gift", "Gift"), .init("chevron.left.forwardslash.chevron.right", "Code"),
        .init("wrench.adjustable", "Tools"), .init("leaf", "Garden"), .init("car", "Car"), .init("graduationcap", "Study"),
        .init("figure.and.child.holdhands", "Family"), .init("pawprint", "Pets"), .init("camera", "Photos"),
        .init("cup.and.saucer", "Coffee"), .init("fork.knife", "Food"), .init("creditcard", "Money"),
        .init("paintpalette", "Art"), .init("gamecontroller", "Games"), .init("sparkles", "Ideas"),
        .init("cart", "Shopping"), .init("calendar", "Events"), .init("person.2", "People"), .init("building.2", "Work"),
        .init("stethoscope", "Health"), .init("tent", "Outdoors"), .init("film", "Films"), .init("globe", "World"),
        .init("hammer", "DIY"), .init("bolt", "Energy"), .init("flag", "Goals"), .init("star", "Favourites")
    ]

    /// The icon a project shows, nil for the ring.
    static func symbol(for project: ProjectRecord, custom: Customisation) -> String? {
        custom.projectIcon(serverId: project.serverId, localId: project.localId)
    }

    /// Saves a project's icon to the account (nil: back to the ring). Entries for projects that no longer exist are
    /// dropped on the way, so the synced list does not keep growing.
    @MainActor
    static func set(_ symbol: String?, for project: ProjectRecord, services: AppServices) {
        save(services: services) { icons in
            icons["local:" + project.localId] = nil
            icons[Customisation.iconKey(serverId: project.serverId, localId: project.localId)] = symbol
        }
    }

    /// Moves the first build's local icons into the account, once, then forgets them.
    @MainActor
    static func migrateLegacy(services: AppServices) {
        let defaults = UserDefaults.standard
        guard let raw = defaults.string(forKey: legacyKey) else { return }
        defaults.removeObject(forKey: legacyKey)
        guard let data = raw.data(using: .utf8),
              let old = try? JSONDecoder().decode([String: String].self, from: data), !old.isEmpty else { return }
        let records = (try? services.store.projects()) ?? []
        let projects = Dictionary(records.map { ($0.localId, $0) }, uniquingKeysWith: { first, _ in first })
        save(services: services) { icons in
            for (localId, symbol) in old {
                guard let project = projects[localId] else { continue }
                let key = Customisation.iconKey(serverId: project.serverId, localId: localId)
                if icons[key] == nil { icons[key] = symbol }
            }
        }
    }

    @MainActor
    private static func save(services: AppServices, _ change: (inout [String: String]) -> Void) {
        let model = PreferencesModel(services: services)
        var custom = model.value.custom
        change(&custom.projectIcons)
        let projects = (try? services.store.projects()) ?? []
        let live = Set(projects.flatMap { [Customisation.iconKey(serverId: $0.serverId, localId: $0.localId), "local:" + $0.localId] })
        // Only once the store has projects: an empty read must not wipe the list.
        if !projects.isEmpty { custom.projectIcons = custom.projectIcons.filter { live.contains($0.key) } }
        guard custom != model.value.custom else { return }
        model.value.custom = custom
    }
}

/// One entry in a project's Icon menu: an SF Symbol and the name the menu shows.
struct MacProjectIconChoice: Identifiable, Sendable {
    let symbol: String
    let name: String
    var id: String { symbol }

    init(_ symbol: String, _ name: String) {
        self.symbol = symbol
        self.name = name
    }
}

/// A project's mark: its custom icon, else a ring, both in the muted project colour.
struct MacProjectGlyph: View {
    let project: ProjectRecord
    var size: CGFloat = 10
    @Environment(\.preferences) private var preferences

    var body: some View {
        let colour = MacTheme.projectColour(hex: project.hexColor)
        if let symbol = MacProjectIcons.symbol(for: project, custom: preferences.custom) {
            Image(systemName: symbol)
                .font(.system(size: size + 2, weight: .medium))
                .foregroundStyle(colour)
                .accessibilityHidden(true)
        } else {
            Circle()
                .strokeBorder(colour, lineWidth: size >= 14 ? 2 : 1.5)
                .frame(width: size, height: size)
                .accessibilityHidden(true)
        }
    }
}

/// The Icon submenu in a project's menus: Choose Icon… (the picker), Progress ring (the default), then the icon
/// choices. The current choice has a tick.
struct MacProjectIconMenu: View {
    let project: ProjectRecord
    let services: AppServices
    let onChoose: () -> Void
    @Environment(\.preferences) private var preferences

    var body: some View {
        let current = MacProjectIcons.symbol(for: project, custom: preferences.custom)
        Menu("Icon", systemImage: "face.smiling") {
            Button("Choose Icon…", systemImage: "square.grid.3x3") { onChoose() }
            Divider()
            Button {
                MacProjectIcons.set(nil, for: project, services: services)
            } label: {
                Label("Progress ring", systemImage: current == nil ? "checkmark" : "circle")
            }
            Divider()
            ForEach(MacProjectIcons.choices.prefix(12)) { choice in
                Button {
                    MacProjectIcons.set(choice.symbol, for: project, services: services)
                } label: {
                    Label(choice.name, systemImage: current == choice.symbol ? "checkmark" : choice.symbol)
                }
            }
        }
    }
}
