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

/// Custom project icons, kept on this Mac in UserDefaults as a JSON map of project local id to SF Symbol name. A
/// project with no entry shows the ring.
enum MacProjectIcons {
    static let key = "mac.projectIcons"

    /// The icons offered under a project's Icon menu, with their menu names.
    static let choices: [MacProjectIconChoice] = [
        .init("house", "House"), .init("server.rack", "Server"), .init("heart", "Heart"), .init("bag", "Shopping bag"),
        .init("briefcase", "Briefcase"), .init("book", "Book"), .init("airplane", "Travel"), .init("dumbbell", "Fitness"),
        .init("music.note", "Music"), .init("gift", "Gift"), .init("chevron.left.forwardslash.chevron.right", "Code"),
        .init("wrench.adjustable", "Tools"), .init("leaf", "Garden"), .init("car", "Car"), .init("graduationcap", "Study"),
        .init("figure.and.child.holdhands", "Family"), .init("pawprint", "Pets"), .init("camera", "Photos"),
        .init("cup.and.saucer", "Coffee"), .init("fork.knife", "Food"), .init("creditcard", "Money"),
        .init("paintpalette", "Art"), .init("gamecontroller", "Games"), .init("sparkles", "Ideas")
    ]

    static func decode(_ raw: String) -> [String: String] {
        guard let data = raw.data(using: .utf8),
              let map = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
        return map
    }

    static func encode(_ map: [String: String]) -> String {
        guard let data = try? JSONEncoder().encode(map), let raw = String(data: data, encoding: .utf8) else { return "{}" }
        return raw
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
    let projectLocalId: String
    let hexColor: String?
    var size: CGFloat = 10
    @AppStorage(MacProjectIcons.key) private var iconsRaw = "{}"

    var body: some View {
        let colour = MacTheme.projectColour(hex: hexColor)
        if let symbol = MacProjectIcons.decode(iconsRaw)[projectLocalId] {
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

/// The Icon submenu in a project's menus: Progress ring (the default), then the icon choices. The current choice has
/// a tick.
struct MacProjectIconMenu: View {
    let projectLocalId: String
    @AppStorage(MacProjectIcons.key) private var iconsRaw = "{}"

    var body: some View {
        let current = MacProjectIcons.decode(iconsRaw)[projectLocalId]
        Menu("Icon", systemImage: "face.smiling") {
            Button {
                set(nil)
            } label: {
                Label("Progress ring", systemImage: current == nil ? "checkmark" : "circle")
            }
            Divider()
            ForEach(MacProjectIcons.choices) { choice in
                Button {
                    set(choice.symbol)
                } label: {
                    Label(choice.name, systemImage: current == choice.symbol ? "checkmark" : choice.symbol)
                }
            }
        }
    }

    private func set(_ symbol: String?) {
        var map = MacProjectIcons.decode(iconsRaw)
        map[projectLocalId] = symbol
        iconsRaw = MacProjectIcons.encode(map)
    }
}
