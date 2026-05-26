mod tx;

use tauri_plugin_sql::{Migration, MigrationKind};

const INITIAL_MIGRATION_SQL: &str = include_str!("../../src/db/migrations/001_initial.sql");
const MIGRATION_2_SQL: &str = include_str!("../../src/db/migrations/002_task_fields.sql");

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial schema",
            sql: INITIAL_MIGRATION_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "task favorites and subscription",
            sql: MIGRATION_2_SQL,
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.show();
                let _ = window.unminimize();
            }
        }))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:cria.db", migrations())
                .build(),
        )
        .plugin(tauri_plugin_stronghold::Builder::new(|password| {
            use std::hash::{DefaultHasher, Hash, Hasher};
            let mut hasher = DefaultHasher::new();
            password.hash(&mut hasher);
            let hash = hasher.finish().to_be_bytes();
            let mut key = Vec::with_capacity(32);
            for _ in 0..4 {
                key.extend_from_slice(&hash);
            }
            key
        })
        .build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![tx::execute_tx])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
