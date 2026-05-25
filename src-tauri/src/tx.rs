//! Atomic multi-statement transaction command.
//!
//! `@tauri-apps/plugin-sql` v2 wraps `sqlx::Pool<Sqlite>` with the default
//! 10-connection pool. Each `db.execute()` call from JS acquires a *fresh*
//! connection, so JS-issued `BEGIN`/`COMMIT` lands on different connections
//! and tears the connection state apart (see CLAUDE.md). This command
//! provides a single Tauri call that runs all supplied statements on one
//! pinned connection inside `sqlx::Transaction`, restoring the
//! all-or-nothing semantics the spec relies on.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::Executor;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(Debug, Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<JsonValue>,
}

#[derive(Debug, Serialize)]
pub struct StatementResult {
    pub rows_affected: u64,
    pub last_insert_id: i64,
}

#[tauri::command]
pub async fn execute_tx(
    db: String,
    stmts: Vec<Statement>,
    instances: State<'_, DbInstances>,
) -> Result<Vec<StatementResult>, String> {
    let instances = instances.0.read().await;
    let pool = instances
        .get(&db)
        .ok_or_else(|| format!("db {db:?} not loaded"))?;

    let pool = match pool {
        DbPool::Sqlite(p) => p,
        _ => return Err("only sqlite is supported".into()),
    };

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut results = Vec::with_capacity(stmts.len());

    for stmt in stmts {
        let mut q = sqlx::query(&stmt.sql);
        for v in stmt.params {
            q = bind(q, v);
        }
        // Execute returns a `SqliteQueryResult` — capture row + insert id.
        match tx.execute(q).await {
            Ok(r) => results.push(StatementResult {
                rows_affected: r.rows_affected(),
                last_insert_id: r.last_insert_rowid(),
            }),
            Err(e) => {
                // sqlx's Transaction rolls back on drop, but be explicit.
                let _ = tx.rollback().await;
                return Err(format!("{}: {}", stmt.sql, e));
            }
        }
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(results)
}

fn bind<'q>(
    q: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    v: JsonValue,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    match v {
        JsonValue::Null => q.bind(None::<String>),
        JsonValue::Bool(b) => q.bind(b),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                q.bind(i)
            } else {
                q.bind(n.as_f64().unwrap_or_default())
            }
        }
        JsonValue::String(s) => q.bind(s),
        // Arrays / objects: serialise back to JSON text so the column gets a
        // string value rather than something sqlx can't bind.
        other => q.bind(other.to_string()),
    }
}

