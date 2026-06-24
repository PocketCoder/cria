mod ocr;
mod secure;
mod tx;

use tauri_plugin_sql::{Migration, MigrationKind};

// Tray, menus, window-close-to-tray and the launch-at-login dock dance are all
// desktop-only. iOS/Android never compile these imports (or the code that uses
// them — see the `#[cfg(desktop)]` gates below).
#[cfg(desktop)]
use std::sync::Mutex;
#[cfg(desktop)]
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconId},
    Emitter, Manager, WindowEvent,
};

const INITIAL_MIGRATION_SQL: &str = include_str!("../../src/db/migrations/001_initial.sql");
const MIGRATION_2_SQL: &str = include_str!("../../src/db/migrations/002_task_fields.sql");
const MIGRATION_3_SQL: &str = include_str!("../../src/db/migrations/003_fts.sql");
const MIGRATION_4_SQL: &str = include_str!("../../src/db/migrations/004_project_favorite.sql");
const MIGRATION_5_SQL: &str = include_str!("../../src/db/migrations/005_task_attachments.sql");
const MIGRATION_6_SQL: &str = include_str!("../../src/db/migrations/006_task_reminders.sql");
const MIGRATION_7_SQL: &str = include_str!("../../src/db/migrations/007_task_relations.sql");
const MIGRATION_8_SQL: &str = include_str!("../../src/db/migrations/008_task_reminders_relative.sql");
const MIGRATION_9_SQL: &str = include_str!("../../src/db/migrations/009_task_identifier.sql");
const MIGRATION_10_SQL: &str = include_str!("../../src/db/migrations/010_views.sql");
const MIGRATION_11_SQL: &str = include_str!("../../src/db/migrations/011_kanban.sql");
const MIGRATION_12_SQL: &str = include_str!("../../src/db/migrations/012_task_bucket_position.sql");
const MIGRATION_13_SQL: &str = include_str!("../../src/db/migrations/013_task_comments.sql");
const MIGRATION_14_SQL: &str = include_str!("../../src/db/migrations/014_comment_reactions.sql");
const MIGRATION_15_SQL: &str = include_str!("../../src/db/migrations/015_perf_indexes.sql");

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
            description: "task fields (favorite, subscription, repeat)",
            sql: MIGRATION_2_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "full-text search FTS5",
            sql: MIGRATION_3_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "project favorite",
            sql: MIGRATION_4_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "task attachments",
            sql: MIGRATION_5_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "task reminders",
            sql: MIGRATION_6_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "task relations",
            sql: MIGRATION_7_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "task reminders relative form",
            sql: MIGRATION_8_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "task identifier",
            sql: MIGRATION_9_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "project views (list/gantt/table/kanban)",
            sql: MIGRATION_10_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "kanban buckets and task-bucket assignments",
            sql: MIGRATION_11_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "task-bucket position for intra-bucket reorder",
            sql: MIGRATION_12_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "task comments",
            sql: MIGRATION_13_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "comment reactions",
            sql: MIGRATION_14_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "performance indexes (active due-date scan)",
            sql: MIGRATION_15_SQL,
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg(desktop)]
#[tauri::command]
fn set_tray_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(&TrayIconId::new("main")) {
        tray.set_visible(visible).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(desktop)]
struct AppState {
    close_to_tray: Mutex<bool>,
    hide_dock_on_tray: Mutex<bool>,
}

#[cfg(desktop)]
#[tauri::command]
fn set_close_to_tray(state: tauri::State<'_, AppState>, enabled: bool) -> Result<(), String> {
    *state.close_to_tray.lock().map_err(|e| e.to_string())? = enabled;
    Ok(())
}

#[cfg(desktop)]
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

/// Builds the system tray + its menu and manages the close-to-tray state.
/// Desktop-only: iOS/Android have no system tray.
#[cfg(desktop)]
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // Desktop-only plugins + window behaviours. None of these crates are even
    // compiled for iOS/Android (see Cargo.toml's target-gated dependency
    // table), so the whole block is excluded on mobile.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
                #[cfg(target_os = "macos")]
                restore_dock();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                    let _ = window.show();
                    let _ = window.unminimize();
                }
            }))
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))
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
            });
    }

    // Native Liquid Glass — macOS only (NSGlassEffectView on macOS 26+, with a
    // NSVisualEffectView fallback). The crate is target-gated in Cargo.toml, so
    // this block only compiles on macOS; the frontend (src/tauri/liquidGlass.ts)
    // still gates the actual effect call behind isGlassSupported().
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_plugin_liquid_glass::init());
    }

    // Cross-platform plugins (work on desktop + iOS + Android).
    let builder = builder
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:cria.db", migrations())
                .build(),
        )
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_haptics::init())
        .setup(|_app| {
            #[cfg(desktop)]
            setup_tray(_app)?;
            Ok(())
        });

    // The tray/dock commands only exist on desktop; mobile gets just the
    // shared transaction command.
    #[cfg(desktop)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        tx::execute_tx,
        ocr::recognize_text,
        secure::secure_get_token,
        secure::secure_set_token,
        secure::secure_delete_token,
        set_tray_visible,
        set_close_to_tray,
        set_hide_dock_on_tray,
    ]);
    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        tx::execute_tx,
        ocr::recognize_text,
        secure::secure_get_token,
        secure::secure_set_token,
        secure::secure_delete_token,
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
