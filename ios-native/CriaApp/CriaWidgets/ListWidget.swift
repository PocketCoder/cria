import AppIntents
import CriaKit
import SwiftUI
import WidgetKit

/// A list the widget can show, as the widget's settings list it: Today, Upcoming, Inbox, then every project, saved
/// filter and label. The id is `WidgetListSource.id`.
struct ListWidgetEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "List"
    static let defaultQuery = ListWidgetQuery()

    let id: String
    let title: String

    init(id: String, title: String) {
        self.id = id
        self.title = title
    }

    init(_ choice: WidgetListChoice) {
        self.init(id: choice.source.id, title: choice.title)
    }

    var source: WidgetListSource? { WidgetListSource(id: id) }

    var displayRepresentation: DisplayRepresentation {
        let kind = source?.kind ?? .view
        let subtitle: LocalizedStringResource? = kind == .view ? nil : LocalizedStringResource(stringLiteral: kind.rawValue)
        return DisplayRepresentation(
            title: LocalizedStringResource(stringLiteral: title),
            subtitle: subtitle,
            image: DisplayRepresentation.Image(systemName: symbol)
        )
    }

    private var symbol: String {
        switch source {
        case .today?: return "star"
        case .upcoming?: return "calendar"
        case .inbox?: return "tray"
        case .project?: return "folder"
        case .savedFilter?: return "line.3.horizontal.decrease.circle"
        case .label?: return "tag"
        case nil: return "list.bullet"
        }
    }
}

/// Reads the choices from the shared database. Before the app has synced (or after sign-out) only the three views
/// are offered.
struct ListWidgetQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [ListWidgetEntity] {
        let all = choices(matching: "")
        // One that has gone keeps its place, so the widget can say so instead of silently switching lists.
        return identifiers.compactMap { id in
            all.first { $0.id == id } ?? WidgetListSource(id: id).map { _ in ListWidgetEntity(id: id, title: "Removed") }
        }
    }

    func entities(matching string: String) async throws -> [ListWidgetEntity] {
        choices(matching: string)
    }

    func suggestedEntities() async throws -> [ListWidgetEntity] {
        choices(matching: "")
    }

    /// Upcoming: Today has a widget of its own.
    func defaultResult() async -> ListWidgetEntity? {
        choices(matching: "").first { $0.id == WidgetListSource.upcoming.id }
    }

    private func choices(matching text: String) -> [ListWidgetEntity] {
        let views = [
            ListWidgetEntity(id: WidgetListSource.today.id, title: "Today"),
            ListWidgetEntity(id: WidgetListSource.upcoming.id, title: "Upcoming"),
            ListWidgetEntity(id: WidgetListSource.inbox.id, title: "Inbox")
        ]
        guard SignedInFlag.isSignedIn(),
              let database = try? CriaPaths.openDatabase(readOnly: true),
              let choices = try? CriaStore(database: database).widgetListChoices(matching: text) else {
            let needle = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return needle.isEmpty ? views : views.filter { $0.title.localizedCaseInsensitiveContains(needle) }
        }
        return choices.map(ListWidgetEntity.init)
    }
}

struct ListWidgetIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Choose a list"
    static let description = IntentDescription("Shows a project, saved filter, label, Upcoming or Inbox.")

    @Parameter(title: "List")
    var list: ListWidgetEntity?

    init() {}

    /// Upcoming until a list is chosen.
    var source: WidgetListSource { list?.source ?? .upcoming }
}

struct ListProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> TaskListEntry {
        .placeholder(.upcoming)
    }

    func snapshot(for configuration: ListWidgetIntent, in context: Context) async -> TaskListEntry {
        .load(configuration.source)
    }

    func timeline(for configuration: ListWidgetIntent, in context: Context) async -> Timeline<TaskListEntry> {
        let entry = TaskListEntry.load(configuration.source)
        return Timeline(entries: [entry], policy: .after(entry.nextRefresh))
    }
}

/// Any list from Cria: a project, saved filter, label, Upcoming or Inbox, chosen in the widget's settings.
struct ListWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: WidgetKinds.list, intent: ListWidgetIntent.self, provider: ListProvider()) { entry in
            TaskListWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("List")
        .description("A project, saved filter, label, Upcoming or Inbox. Tick tasks off, or add a new one.")
        .supportedFamilies(WidgetFamilies.all)
    }
}
