use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tauri_plugin_store::StoreExt;
use crate::state::{AppState, ShortcutMode};

pub fn reregister_all_shortcuts(app: &AppHandle, state: &AppState) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("Failed to unregister shortcuts: {e}"))?;

    let main_sc_str = {
        let guard = state.current_shortcut.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    if let Ok(sc) = main_sc_str.parse::<Shortcut>() {
        if let Err(e) = app.global_shortcut().register(sc) {
            eprintln!("Failed to register main shortcut '{main_sc_str}': {e}");
        }
    }

    let post_sc_str = {
        let guard = state.postprocess_config.lock().map_err(|e| e.to_string())?;
        guard.hotkey.clone()
    };
    if !post_sc_str.trim().is_empty() && post_sc_str != main_sc_str {
        if let Ok(sc) = post_sc_str.parse::<Shortcut>() {
            if let Err(e) = app.global_shortcut().register(sc) {
                eprintln!("Failed to register post-processing shortcut '{post_sc_str}': {e}");
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn get_shortcut(state: State<'_, AppState>) -> Result<String, String> {
    let guard = state.current_shortcut.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
pub fn set_shortcut(
    app: AppHandle,
    state: State<'_, AppState>,
    shortcut_str: String,
) -> Result<String, String> {
    let _: Shortcut = shortcut_str
        .parse()
        .map_err(|e| format!("Invalid shortcut format '{shortcut_str}': {e}"))?;

    {
        let mut guard = state.current_shortcut.lock().map_err(|e| e.to_string())?;
        *guard = shortcut_str.clone();
    }

    if let Ok(store) = app.store("settings.json") {
        store.set("shortcut", serde_json::Value::String(shortcut_str.clone()));
        let _ = store.save();
    }

    reregister_all_shortcuts(&app, &state)?;
    Ok(shortcut_str)
}

#[tauri::command]
pub fn get_shortcut_mode(state: State<'_, AppState>) -> Result<String, String> {
    let guard = state.shortcut_mode.lock().map_err(|e| e.to_string())?;
    match *guard {
        ShortcutMode::Hold => Ok("hold".to_string()),
        ShortcutMode::Toggle => Ok("toggle".to_string()),
    }
}

#[tauri::command]
pub fn set_shortcut_mode(
    app: AppHandle,
    state: State<'_, AppState>,
    mode: String,
) -> Result<String, String> {
    let new_mode = match mode.to_lowercase().as_str() {
        "hold" => ShortcutMode::Hold,
        "toggle" => ShortcutMode::Toggle,
        _ => return Err(format!("Invalid shortcut mode: '{mode}'. Must be 'hold' or 'toggle'")),
    };

    {
        let mut guard = state.shortcut_mode.lock().map_err(|e| e.to_string())?;
        *guard = new_mode;
    }

    if let Ok(store) = app.store("settings.json") {
        store.set("shortcut_mode", serde_json::Value::String(mode.to_lowercase()));
        let _ = store.save();
    }

    Ok(mode.to_lowercase())
}

#[tauri::command]
pub async fn cancel_recording(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.is_recording.store(false, Ordering::SeqCst);
    let _ = state.audio_controller.stop_recording();

    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some("Pulse: Ready"));
    }

    let _ = app.emit("overlay-state", serde_json::json!({ "status": "idle" }));

    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }
    Ok(())
}
