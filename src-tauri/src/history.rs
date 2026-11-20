use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_store::StoreExt;
use crate::state::AppState;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct HistoryItem {
    pub id: String,
    pub text: String,
    pub timestamp: u64,
    pub model_id: String,
}

pub fn add_history_entry(
    app: &AppHandle,
    state: &AppState,
    text: String,
    model_id: String,
) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let id = format!("{}_{}", timestamp, rand_suffix());

    let item = HistoryItem {
        id,
        text,
        timestamp,
        model_id,
    };

    let limit = {
        let guard = state.history_limit.lock().unwrap();
        *guard
    };

    let updated_history = {
        let mut guard = state.history.lock().unwrap();
        guard.insert(0, item);
        if guard.len() > limit {
            guard.truncate(limit);
        }
        guard.clone()
    };

    if let Ok(store) = app.store("settings.json") {
        if let Ok(val) = serde_json::to_value(&updated_history) {
            store.set("history", val);
            let _ = store.save();
        }
    }

    let _ = app.emit("history-updated", &updated_history);
}

fn rand_suffix() -> u32 {
    use std::cell::Cell;
    thread_local! {
        static COUNTER: Cell<u32> = const { Cell::new(0) };
    }
    COUNTER.with(|c| {
        let val = c.get().wrapping_add(1);
        c.set(val);
        val
    })
}

#[tauri::command]
pub fn get_history(state: State<'_, AppState>) -> Result<Vec<HistoryItem>, String> {
    let guard = state.history.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
pub fn delete_history_item(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<HistoryItem>, String> {
    let updated = {
        let mut guard = state.history.lock().map_err(|e| e.to_string())?;
        guard.retain(|item| item.id != id);
        guard.clone()
    };

    if let Ok(store) = app.store("settings.json") {
        if let Ok(val) = serde_json::to_value(&updated) {
            store.set("history", val);
            let _ = store.save();
        }
    }

    let _ = app.emit("history-updated", &updated);
    Ok(updated)
}

#[tauri::command]
pub fn clear_history(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut guard = state.history.lock().map_err(|e| e.to_string())?;
        guard.clear();
    }

    if let Ok(store) = app.store("settings.json") {
        store.set("history", serde_json::json!([]));
        let _ = store.save();
    }

    let _ = app.emit("history-updated", Vec::<HistoryItem>::new());
    Ok(())
}

#[tauri::command]
pub fn get_history_limit(state: State<'_, AppState>) -> Result<usize, String> {
    let guard = state.history_limit.lock().map_err(|e| e.to_string())?;
    Ok(*guard)
}

#[tauri::command]
pub fn set_history_limit(
    app: AppHandle,
    state: State<'_, AppState>,
    limit: usize,
) -> Result<usize, String> {
    let clamped_limit = limit.clamp(1, 30);

    let updated_history = {
        let mut limit_guard = state.history_limit.lock().map_err(|e| e.to_string())?;
        *limit_guard = clamped_limit;

        let mut hist_guard = state.history.lock().map_err(|e| e.to_string())?;
        if hist_guard.len() > clamped_limit {
            hist_guard.truncate(clamped_limit);
        }
        hist_guard.clone()
    };

    if let Ok(store) = app.store("settings.json") {
        store.set("history_limit", serde_json::json!(clamped_limit));
        if let Ok(val) = serde_json::to_value(&updated_history) {
            store.set("history", val);
        }
        let _ = store.save();
    }

    let _ = app.emit("history-updated", &updated_history);
    Ok(clamped_limit)
}
