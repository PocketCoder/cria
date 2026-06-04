mod tx;

use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconId},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_sql::{Migration, MigrationKind};

const INITIAL_MIGRATION_SQL: &str = include_str!("../../src/db/migrations/001_initial.sql");
const MIGRATION_2_SQL: &str = include_str!("../../src/db/migrations/002_task_fields.sql");
const MIGRATION_3_SQL: &str = include_str!("../../src/db/migrations/003_fts.sql");
const MIGRATION_4_SQL: &str = include_str!("../../src/db/migrations/004_project_favorite.sql");
const MIGRATION_5_SQL: &str = include_str!("../../src/db/migrations/005_task_attachments.sql");
const MIGRATION_6_SQL: &str = include_str!("../../src/db/migrations/006_task_reminders.sql");
const MIGRATION_7_SQL: &str = include_str!("../../src/db/migrations/007_task_relations.sql");
const MIGRATION_8_SQL: &str = include_str!("../../src/db/migrations/008_task_reminders_relative.sql");
const MIGRATION_9_SQL: &str = include_str!("../../src/db/migrations/009_task_identifier.sql");

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
        Migration {
            version: 3,
            description: "FTS5 full-text search",
            sql: MIGRATION_3_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "project is_favorite column",
            sql: MIGRATION_4_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "task attachments mirror",
            sql: MIGRATION_5_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "task reminders mirror",
            sql: MIGRATION_6_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "task relations mirror",
            sql: MIGRATION_7_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "task reminders: relative form",
            sql: MIGRATION_8_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "task identifier column",
            sql: MIGRATION_9_SQL,
            kind: MigrationKind::Up,
        },
    ]
}

#[tauri::command]
fn set_tray_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(&TrayIconId::new("main")) {
        tray.set_visible(visible).map_err(|e| e.to_string())?;
    }
    Ok(())
}

struct AppState {
    close_to_tray: Mutex<bool>,
    hide_dock_on_tray: Mutex<bool>,
}

#[tauri::command]
fn set_close_to_tray(state: tauri::State<'_, AppState>, enabled: bool) -> Result<(), String> {
    *state.close_to_tray.lock().map_err(|e| e.to_string())? = enabled;
    Ok(())
}

#[tauri::command]
fn set_hide_dock_on_tray(state: tauri::State<'_, AppState>, enabled: bool) -> Result<(), String> {
    *state.hide_dock_on_tray.lock().map_err(|e| e.to_string())? = enabled;
    Ok(())
}

#[cfg(target_os = "macos")]
fn restore_dock() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
    let mtm = MainThreadMarker::new()
        .expect("restore_dock must be called on the main thread");
    NSApplication::sharedApplication(mtm)
        .setActivationPolicy(NSApplicationActivationPolicy::Regular);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            #[cfg(target_os = "macos")]
            restore_dock();
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
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                if *state.close_to_tray.lock().unwrap() {
                    #[cfg(target_os = "macos")]
                    if *state.hide_dock_on_tray.lock().unwrap() {
                        let mtm = objc2::MainThreadMarker::new()
                            .expect("on_window_event runs on the main thread");
                        objc2_app_kit::NSApplication::sharedApplication(mtm)
                            .setActivationPolicy(
                                objc2_app_kit::NSApplicationActivationPolicy::Accessory,
                            );
                    }
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .setup(|app| {
            app.manage(AppState {
                close_to_tray: Mutex::new(true),
                hide_dock_on_tray: Mutex::new(false),
            });

            let show = MenuItemBuilder::with_id("show", "Show Cria").build(app)?;
            let quick_add = MenuItemBuilder::with_id("quick_add", "Quick Add...").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit Cria").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show)
                .item(&quick_add)
                .separator()
                .item(&quit)
                .build()?;

            TrayIconBuilder::with_id(TrayIconId::new("main"))
                .icon(app.default_window_icon().cloned().expect("default window icon"))
                .menu(&menu)
                .tooltip("Cria")
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            #[cfg(target_os = "macos")]
                            restore_dock();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.unminimize();
                            }
                        }
                        "quick_add" => {
                            #[cfg(target_os = "macos")]
                            restore_dock();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.emit("tray-quick-add", ());
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        #[cfg(target_os = "macos")]
                        restore_dock();
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.unminimize();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tx::execute_tx,
            set_tray_visible,
            set_close_to_tray,
            set_hide_dock_on_tray,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
