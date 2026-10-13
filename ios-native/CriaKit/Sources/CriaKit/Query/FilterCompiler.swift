import Foundation
import GRDB

/// A bound SQL parameter. Whole numbers bind as integers so `server_id = ?` compares exactly.
public enum FilterParam: Equatable, Sendable {
    case integer(Int)
    case real(Double)
    case text(String)

    var databaseValue: DatabaseValue {
        switch self {
        case .integer(let value): value.databaseValue
        case .real(let value): value.databaseValue
        case .text(let value): value.databaseValue
        }
    }
}

/// A WHERE fragment (aliases `t` for tasks, no leading `WHERE`) and its positional parameters.
public struct CompiledFilter: Equatable, Sendable {
    public let whereClause: String
    public let params: [FilterParam]

    var arguments: StatementArguments {
        let values: [(any DatabaseValueConvertible)?] = params.map { $0.databaseValue }
        return StatementArguments(values)
    }
}

public enum FilterCompileError: Error, Equatable, Sendable {
    case unknownField(String)
}

private let fieldColumns: [String: String] = [
    "done": "t.done",
    "priority": "t.priority",
    "percentDone": "t.percent_done",
    "dueDate": "t.due_date",
    "startDate": "t.start_date",
    "endDate": "t.end_date",
    "doneAt": "t.done_at",
    "created": "t.created_at",
    "updated": "t.updated_at"
]

private struct FilterSQL {
    var clauses: [String] = []
    var params: [FilterParam] = []
}

/// Compiles a parsed filter to SQL over `tasks t`. A nil AST gives an empty fragment.
public func compileFilter(_ ast: FilterNode?, includeNulls: Bool) throws -> CompiledFilter {
    guard let ast else { return CompiledFilter(whereClause: "", params: []) }
    var sql = FilterSQL()
    try compileNode(ast, includeNulls: includeNulls, into: &sql)
    return CompiledFilter(whereClause: sql.clauses.joined(separator: " AND "), params: sql.params)
}

private func compileNode(_ node: FilterNode, includeNulls: Bool, into sql: inout FilterSQL) throws {
    switch node {
    case .clause(let clause):
        try compileClause(clause, includeNulls: includeNulls, into: &sql)
    case .group(let group):
        var parts: [String] = []
        var groupParams: [FilterParam] = []
        for child in group.children {
            var childSQL = FilterSQL()
            try compileNode(child, includeNulls: includeNulls, into: &childSQL)
            parts.append(childSQL.clauses.joined(separator: " AND "))
            groupParams += childSQL.params
        }
        let joined = parts.filter { !$0.isEmpty }
        guard !joined.isEmpty else { return }
        let keyword = group.logic == .disjunction ? "OR" : "AND"
        sql.clauses.append(joined.count == 1 ? joined[0] : "(" + joined.joined(separator: " \(keyword) ") + ")")
        sql.params += groupParams
    }
}

private func compileClause(_ clause: FilterClause, includeNulls: Bool, into sql: inout FilterSQL) throws {
    if let column = fieldColumns[clause.field] {
        compileScalar(clause, column: column, includeNulls: includeNulls, into: &sql)
        return
    }
    switch clause.field {
    case "reminders":
        compileReminders(clause, into: &sql)
    case "assignees":
        compileMembership(clause, subquery: assigneesSubquery, into: &sql)
    case "labels":
        compileMembership(clause, subquery: labelsSubquery, into: &sql)
    case "project":
        compileProject(clause, into: &sql)
    default:
        throw FilterCompileError.unknownField(clause.field)
    }
}

// MARK: - Values

private extension FilterOperator {
    var sqlOperator: String {
        switch self {
        case .like: "LIKE"
        case .inList: "IN"
        case .notInList: "NOT IN"
        default: rawValue
        }
    }

    var isList: Bool {
        self == .inList || self == .notInList
    }
}

private func sqlParams(_ value: FilterValue) -> [FilterParam] {
    switch value {
    case .number(let number):
        if number == number.rounded(), abs(number) < 9e15 {
            return [.integer(Int(number))]
        }
        return [.real(number)]
    case .boolean(let flag):
        return [.integer(flag ? 1 : 0)]
    case .string(let text):
        return [.text(text)]
    case .dateMath(_, let resolved):
        return [.text(resolved)]
    case .array(let values):
        return values.flatMap(sqlParams)
    }
}

private func placeholders(_ count: Int) -> String {
    Array(repeating: "?", count: count).joined(separator: ", ")
}

// MARK: - Clause kinds

private func compileScalar(_ clause: FilterClause, column: String, includeNulls: Bool, into sql: inout FilterSQL) {
    let params = sqlParams(clause.value)
    let sqlOp = clause.comparison.sqlOperator
    if clause.comparison.isList {
        let expression = "\(column) \(sqlOp) (\(placeholders(params.count)))"
        sql.clauses.append(includeNulls ? "(\(column) IS NULL OR \(expression))" : expression)
        sql.params += params
        return
    }
    guard params.count == 1 else { return }
    let expression = "\(column) \(sqlOp) ?"
    let isEquality = clause.comparison == .equal || clause.comparison == .notEqual
    sql.clauses.append(includeNulls && !isEquality ? "(\(column) IS NULL OR \(expression))" : expression)
    sql.params += params
}

private func compileReminders(_ clause: FilterClause, into sql: inout FilterSQL) {
    let params = sqlParams(clause.value)
    let base = "EXISTS (SELECT 1 FROM task_reminders tr WHERE tr.task_local_id = t.local_id AND tr.reminder"
    let sqlOp = clause.comparison.sqlOperator
    if clause.comparison.isList {
        sql.clauses.append("\(base) \(sqlOp) (\(placeholders(params.count))))")
        sql.params += params
        return
    }
    guard let first = params.first else { return }
    sql.clauses.append("\(base) \(sqlOp) ?)")
    sql.params.append(first)
}

private let assigneesSubquery = "SELECT 1 FROM task_assignees ta WHERE ta.task_local_id = t.local_id AND ta.username"
private let labelsSubquery = "SELECT 1 FROM task_labels tl JOIN labels l ON l.local_id = tl.label_local_id "
    + "WHERE tl.task_local_id = t.local_id AND l.title"

/// `in`, `not in`, `=` and `!=` against a (NOT) EXISTS subquery that ends in a column to compare.
private func compileMembership(_ clause: FilterClause, subquery: String, into sql: inout FilterSQL) {
    let params = sqlParams(clause.value)
    switch clause.comparison {
    case .inList:
        sql.clauses.append("EXISTS (\(subquery) IN (\(placeholders(params.count))))")
        sql.params += params
    case .notInList:
        sql.clauses.append("NOT EXISTS (\(subquery) IN (\(placeholders(params.count))))")
        sql.params += params
    case .equal:
        guard let first = params.first else { return }
        sql.clauses.append("EXISTS (\(subquery) = ?)")
        sql.params.append(first)
    case .notEqual:
        guard let first = params.first else { return }
        sql.clauses.append("NOT EXISTS (\(subquery) = ?)")
        sql.params.append(first)
    default:
        return
    }
}

/// Vikunja-web saved filters store numeric project ids; hand-typed queries use titles.
/// Numbers match `server_id`, strings match `title`.
private func projectMatch(_ param: FilterParam) -> String {
    if case .text = param {
        return "p2.title = ?"
    }
    return "p2.server_id = ?"
}

private func compileProject(_ clause: FilterClause, into sql: inout FilterSQL) {
    let params = sqlParams(clause.value)
    let base = "SELECT 1 FROM projects p2 WHERE p2.local_id = t.project_local_id AND"
    switch clause.comparison {
    case .inList:
        sql.clauses.append("EXISTS (\(base) (\(params.map(projectMatch).joined(separator: " OR "))))")
        sql.params += params
    case .notInList:
        sql.clauses.append("NOT EXISTS (\(base) (\(params.map(projectMatch).joined(separator: " OR "))))")
        sql.params += params
    case .equal:
        guard let first = params.first else { return }
        sql.clauses.append("EXISTS (\(base) \(projectMatch(first)))")
        sql.params.append(first)
    case .notEqual:
        guard let first = params.first else { return }
        sql.clauses.append("NOT EXISTS (\(base) \(projectMatch(first)))")
        sql.params.append(first)
    default:
        return
    }
}
