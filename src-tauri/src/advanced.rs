use tauri::{AppHandle, Emitter, State};
use tauri_plugin_store::StoreExt;
use crate::state::{AppState, AdvancedConfig};

#[tauri::command]
pub async fn get_advanced_config(state: State<'_, AppState>) -> Result<AdvancedConfig, String> {
    let guard = state.advanced_config.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
pub async fn save_advanced_config(
    app: AppHandle,
    state: State<'_, AppState>,
    config: AdvancedConfig,
) -> Result<(), String> {
    {
        let mut guard = state.advanced_config.lock().map_err(|e| e.to_string())?;
        *guard = config.clone();
    }

    state.audio_controller.set_keep_mic_open(config.keep_mic_open);

    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    let val = serde_json::to_value(&config).map_err(|e| e.to_string())?;
    store.set("advanced", val);
    let _ = store.save();

    Ok(())
}

#[tauri::command]
pub fn get_overlay_text_style(state: State<'_, AppState>) -> Result<String, String> {
    let guard = state.overlay_text_style.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
pub fn set_overlay_text_style(
    app: AppHandle,
    state: State<'_, AppState>,
    style: String,
) -> Result<String, String> {
    let normalized = match style.to_lowercase().as_str() {
        "italic" => "italic".to_string(),
        _ => "normal".to_string(),
    };

    {
        let mut guard = state.overlay_text_style.lock().map_err(|e| e.to_string())?;
        *guard = normalized.clone();
    }

    if let Ok(store) = app.store("settings.json") {
        store.set("overlay_text_style", serde_json::Value::String(normalized.clone()));
        let _ = store.save();
    }

    let _ = app.emit("overlay-style-updated", serde_json::json!({ "style": &normalized }));

    Ok(normalized)
}
