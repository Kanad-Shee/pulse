pub mod audio;
pub mod history;
pub mod injector;
pub mod models;
pub mod postprocess;
pub mod shortcuts;
pub mod state;
pub mod transcriber;

use state::AppState;
use std::sync::atomic::Ordering;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};
use tauri_plugin_store::StoreExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let app_state = app.state::<AppState>();
                    let mode = {
                        let guard = app_state.shortcut_mode.lock().unwrap();
                        *guard
                    };

                    let is_postprocess_trigger = {
                        let post_sc_str =
                            app_state.postprocess_config.lock().unwrap().hotkey.clone();
                        if let Ok(post_sc) = post_sc_str.parse::<Shortcut>() {
                            shortcut == &post_sc
                        } else {
                            false
                        }
                    };

                    match mode {
                        crate::state::ShortcutMode::Hold => {
                            if event.state() == ShortcutState::Pressed {
                                if !app_state.is_recording.swap(true, Ordering::SeqCst) {
                                    app_state
                                        .active_recording_uses_postprocess
                                        .store(is_postprocess_trigger, Ordering::SeqCst);

                                    // Pre-warm local Ollama model in background if post-processing hotkey is triggered
                                    if is_postprocess_trigger {
                                        let config = app_state
                                            .postprocess_config
                                            .lock()
                                            .unwrap()
                                            .clone();
                                        tauri::async_runtime::spawn(async move {
                                            postprocess::prewarm_ollama(&config).await;
                                        });
                                    }

                                    if let Some(tray) = app.tray_by_id("main") {
                                        let _ = tray.set_tooltip(Some("Pulse: Listening..."));
                                    }

                                    // Position overlay near bottom-center of primary monitor
                                    if let Some(overlay) = app.get_webview_window("overlay") {
                                        if let Ok(Some(monitor)) = app.primary_monitor() {
                                            let size = monitor.size();
                                            let scale = monitor.scale_factor();
                                            let overlay_width = (380.0 * scale) as i32;
                                            let overlay_height = (180.0 * scale) as i32;
                                            let x = (size.width as i32 - overlay_width) / 2;
                                            let y = size.height as i32
                                                - overlay_height
                                                - (70.0 * scale) as i32;
                                            let _ = overlay.set_position(
                                                tauri::Position::Physical(
                                                    tauri::PhysicalPosition { x, y },
                                                ),
                                            );
                                        }
                                        let _ = app.emit(
                                            "overlay-state",
                                            serde_json::json!({ "status": "listening" }),
                                        );
                                        let _ = app.emit(
                                            "overlay-preview",
                                            serde_json::json!({ "text": "" }),
                                        );
                                        let _ = overlay.show(); // do NOT call set_focus()
                                    }

                                    let _ = app_state
                                        .audio_controller
                                        .start_recording(Some(app.clone()));
                                }
                            } else if event.state() == ShortcutState::Released {
                                if app_state.is_recording.swap(false, Ordering::SeqCst) {
                                    if let Some(tray) = app.tray_by_id("main") {
                                        let _ = tray.set_tooltip(Some("Pulse: Transcribing..."));
                                    }
                                    let _ = app.emit(
                                        "overlay-state",
                                        serde_json::json!({ "status": "transcribing" }),
                                    );

                                    let audio_res = app_state.audio_controller.stop_recording();
                                    let app_clone = app.clone();

                                    tauri::async_runtime::spawn(async move {
                                        match audio_res {
                                            Ok(samples) => {
                                                if !samples.is_empty() {
                                                    let state = app_clone.state::<AppState>();
                                                    match transcriber::get_or_load_model(
                                                        &app_clone, &state,
                                                    ) {
                                                        Ok((model_id, model)) => {
                                                            match transcriber::run_transcription(
                                                                model, model_id.clone(), samples,
                                                            )
                                                            .await
                                                            {
                                                                Ok(text) => {
                                                                    if !text.trim().is_empty() {
                                                                        let trimmed =
                                                                            text.trim().to_string();
                                                                        let uses_post = state
                                                                            .active_recording_uses_postprocess
                                                                            .load(Ordering::SeqCst);

                                                                        let final_text = if uses_post
                                                                        {
                                                                            if let Some(tray) =
                                                                                app_clone
                                                                                    .tray_by_id(
                                                                                        "main",
                                                                                    )
                                                                            {
                                                                                let _ = tray.set_tooltip(Some("Pulse: Polishing..."));
                                                                            }
                                                                            let _ = app_clone.emit(
                                                                                "overlay-state",
                                                                                serde_json::json!({ "status": "polishing" }),
                                                                            );

                                                                            let config = state
                                                                                .postprocess_config
                                                                                .lock()
                                                                                .unwrap()
                                                                                .clone();
                                                                            let polished = postprocess::run_postprocess(&trimmed, &config).await;
                                                                            if polished
                                                                                .trim()
                                                                                .is_empty()
                                                                            {
                                                                                trimmed
                                                                            } else {
                                                                                polished
                                                                            }
                                                                        } else {
                                                                            trimmed
                                                                        };

                                                                        history::add_history_entry(
                                                                            &app_clone,
                                                                            &state,
                                                                            final_text.clone(),
                                                                            model_id,
                                                                        );
                                                                        if let Err(e) =
                                                                            injector::inject_text(
                                                                                &final_text,
                                                                            )
                                                                        {
                                                                            eprintln!(
                                                                                "Text injection failed: {e}"
                                                                            );
                                                                        }
                                                                    }
                                                                }
                                                                Err(e) => {
                                                                    eprintln!(
                                                                        "Transcription failed: {e}"
                                                                    );
                                                                }
                                                            }
                                                        }
                                                        Err(e) => {
                                                            eprintln!("Model load failed: {e}");
                                                        }
                                                    }
                                                }
                                            }
                                            Err(e) => {
                                                eprintln!("Audio stop failed: {e}");
                                            }
                                        }

                                        if let Some(tray) = app_clone.tray_by_id("main") {
                                            let _ = tray.set_tooltip(Some("Pulse: Ready"));
                                        }
                                        if let Some(overlay) =
                                            app_clone.get_webview_window("overlay")
                                        {
                                            let _ = overlay.hide();
                                        }
                                        let _ = app_clone.emit(
                                            "overlay-state",
                                            serde_json::json!({ "status": "idle" }),
                                        );
                                    });
                                }
                            }
                        }
                        crate::state::ShortcutMode::Toggle => {
                            // Ignore Released events in Toggle mode
                            if event.state() != ShortcutState::Pressed {
                                return;
                            }

                            // Enforce 350ms cooldown on OS key-repeat
                            let now = std::time::Instant::now();
                            {
                                let mut last_toggle = app_state.last_toggle_at.lock().unwrap();
                                if let Some(prev) = *last_toggle {
                                    if now.duration_since(prev)
                                        < std::time::Duration::from_millis(350)
                                    {
                                        return;
                                    }
                                }
                                *last_toggle = Some(now);
                            }

                            let was_recording = app_state.is_recording.load(Ordering::SeqCst);
                            if !was_recording {
                                // 1st click - Start recording & live preview loop
                                app_state.is_recording.store(true, Ordering::SeqCst);
                                app_state
                                    .active_recording_uses_postprocess
                                    .store(is_postprocess_trigger, Ordering::SeqCst);

                                // Pre-warm local Ollama model in background if post-processing hotkey is triggered
                                if is_postprocess_trigger {
                                    let config = app_state
                                        .postprocess_config
                                        .lock()
                                        .unwrap()
                                        .clone();
                                    tauri::async_runtime::spawn(async move {
                                        postprocess::prewarm_ollama(&config).await;
                                    });
                                }

                                if let Some(tray) = app.tray_by_id("main") {
                                    let _ = tray.set_tooltip(Some("Pulse: Listening..."));
                                }

                                if let Some(overlay) = app.get_webview_window("overlay") {
                                    if let Ok(Some(monitor)) = app.primary_monitor() {
                                        let size = monitor.size();
                                        let scale = monitor.scale_factor();
                                        let overlay_width = (380.0 * scale) as i32;
                                        let overlay_height = (180.0 * scale) as i32;
                                        let x = (size.width as i32 - overlay_width) / 2;
                                        let y = size.height as i32
                                            - overlay_height
                                            - (70.0 * scale) as i32;
                                        let _ = overlay.set_position(
                                            tauri::Position::Physical(
                                                tauri::PhysicalPosition { x, y },
                                            ),
                                        );
                                    }
                                    let _ = app.emit(
                                        "overlay-state",
                                        serde_json::json!({ "status": "listening" }),
                                    );
                                    let _ = app.emit(
                                        "overlay-preview",
                                        serde_json::json!({ "text": "" }),
                                    );
                                    let _ = overlay.show(); // do NOT call set_focus()
                                }

                                let _ = app_state
                                    .audio_controller
                                    .start_recording(Some(app.clone()));

                                // Spawn live preview background task
                                let app_clone = app.clone();
                                tauri::async_runtime::spawn(async move {
                                    let mut last_len: usize = 0;
                                    loop {
                                        tokio::time::sleep(std::time::Duration::from_millis(900))
                                            .await;
                                        let state = app_clone.state::<AppState>();
                                        if !state.is_recording.load(Ordering::SeqCst) {
                                            break;
                                        }

                                        let snapshot = state.audio_controller.snapshot_samples();
                                        if snapshot.len() >= last_len + 8000 {
                                            last_len = snapshot.len();
                                            if let Ok((model_id, model)) =
                                                transcriber::get_or_load_model(&app_clone, &state)
                                            {
                                                if let Ok(preview_text) =
                                                    transcriber::run_transcription(
                                                        model, model_id, snapshot,
                                                    )
                                                    .await
                                                {
                                                    if state.is_recording.load(Ordering::SeqCst)
                                                        && !preview_text.trim().is_empty()
                                                    {
                                                        let _ = app_clone.emit(
                                                            "overlay-preview",
                                                            serde_json::json!({
                                                                "text": preview_text
                                                            }),
                                                        );
                                                    }
                                                }
                                            }
                                        }
                                    }
                                });
                            } else {
                                // 2nd click - Stop recording & Inject final text
                                app_state.is_recording.store(false, Ordering::SeqCst);

                                // Hide overlay immediately for instant UI feedback
                                if let Some(overlay) = app.get_webview_window("overlay") {
                                    let _ = overlay.hide();
                                }

                                if let Some(tray) = app.tray_by_id("main") {
                                    let _ = tray.set_tooltip(Some("Pulse: Transcribing..."));
                                }
                                let _ = app.emit(
                                    "overlay-state",
                                    serde_json::json!({ "status": "transcribing" }),
                                );

                                let audio_res = app_state.audio_controller.stop_recording();
                                let app_clone = app.clone();

                                tauri::async_runtime::spawn(async move {
                                    match audio_res {
                                        Ok(samples) => {
                                            if !samples.is_empty() {
                                                let state = app_clone.state::<AppState>();
                                                match transcriber::get_or_load_model(
                                                    &app_clone, &state,
                                                ) {
                                                    Ok((model_id, model)) => {
                                                        match transcriber::run_transcription(
                                                            model, model_id.clone(), samples,
                                                        )
                                                        .await
                                                        {
                                                            Ok(text) => {
                                                                if !text.trim().is_empty() {
                                                                    let trimmed =
                                                                        text.trim().to_string();
                                                                    let uses_post = state
                                                                        .active_recording_uses_postprocess
                                                                        .load(Ordering::SeqCst);

                                                                    let final_text = if uses_post {
                                                                        if let Some(tray) =
                                                                            app_clone
                                                                                .tray_by_id("main")
                                                                        {
                                                                            let _ = tray.set_tooltip(Some("Pulse: Polishing..."));
                                                                        }
                                                                        let _ = app_clone.emit(
                                                                            "overlay-state",
                                                                            serde_json::json!({ "status": "polishing" }),
                                                                        );

                                                                        let config = state
                                                                            .postprocess_config
                                                                            .lock()
                                                                            .unwrap()
                                                                            .clone();
                                                                        let polished = postprocess::run_postprocess(&trimmed, &config).await;
                                                                        if polished
                                                                            .trim()
                                                                            .is_empty()
                                                                        {
                                                                            trimmed
                                                                        } else {
                                                                            polished
                                                                        }
                                                                    } else {
                                                                        trimmed
                                                                    };

                                                                    history::add_history_entry(
                                                                        &app_clone,
                                                                        &state,
                                                                        final_text.clone(),
                                                                        model_id,
                                                                    );
                                                                    if let Err(e) =
                                                                        injector::inject_text(
                                                                            &final_text,
                                                                        )
                                                                    {
                                                                        eprintln!(
                                                                            "Text injection failed: {e}"
                                                                        );
                                                                    }
                                                                }
                                                            }
                                                            Err(e) => {
                                                                eprintln!(
                                                                    "Transcription failed: {e}"
                                                                );
                                                            }
                                                        }
                                                    }
                                                    Err(e) => {
                                                        eprintln!("Model load failed: {e}");
                                                    }
                                                }
                                            }
                                        }
                                        Err(e) => {
                                            eprintln!("Audio stop failed: {e}");
                                        }
                                    }

                                    if let Some(tray) = app_clone.tray_by_id("main") {
                                        let _ = tray.set_tooltip(Some("Pulse: Ready"));
                                    }
                                    let _ = app_clone.emit(
                                        "overlay-state",
                                        serde_json::json!({ "status": "idle" }),
                                    );
                                });
                            }
                        }
                    }
                })
                .build(),
        )
        .manage(AppState::default())
        .setup(|app| {
            // Restore persisted active_model from settings.json if available
            if let Ok(store) = app.store("settings.json") {
                if let Some(val) = store.get("active_model") {
                    if let Some(model_str) = val.as_str() {
                        let state = app.state::<AppState>();
                        if let Ok(mut guard) = state.active_model_id.lock() {
                            *guard = model_str.to_string();
                        }
                    }
                }
            }

            // Restore shortcut from settings.json or default to Alt+Space
            let shortcut_str = if let Ok(store) = app.store("settings.json") {
                if let Some(val) = store.get("shortcut") {
                    val.as_str().unwrap_or("Alt+Space").to_string()
                } else {
                    "Alt+Space".to_string()
                }
            } else {
                "Alt+Space".to_string()
            };

            {
                let state = app.state::<AppState>();
                if let Ok(mut guard) = state.current_shortcut.lock() {
                    *guard = shortcut_str.clone();
                }
            }

            // Restore shortcut mode from settings.json or default to "hold"
            let mode_str = if let Ok(store) = app.store("settings.json") {
                if let Some(val) = store.get("shortcut_mode") {
                    val.as_str().unwrap_or("hold").to_string()
                } else {
                    "hold".to_string()
                }
            } else {
                "hold".to_string()
            };

            let shortcut_mode = match mode_str.to_lowercase().as_str() {
                "toggle" => crate::state::ShortcutMode::Toggle,
                _ => crate::state::ShortcutMode::Hold,
            };

            {
                let state = app.state::<AppState>();
                if let Ok(mut guard) = state.shortcut_mode.lock() {
                    *guard = shortcut_mode;
                }
            }

            // Restore postprocess config from settings.json
            if let Ok(store) = app.store("settings.json") {
                if let Some(val) = store.get("postprocess") {
                    if let Ok(mut cfg) =
                        serde_json::from_value::<crate::postprocess::PostProcessConfig>(val)
                    {
                        // Ensure coding_tasks preset exists and is set as default
                        if !cfg.prompts.iter().any(|p| p.id == "coding_tasks") {
                            cfg.prompts.insert(
                                0,
                                crate::postprocess::PromptPreset {
                                    id: "coding_tasks".to_string(),
                                    label: "Coding Tasks & Changes".to_string(),
                                    instructions:
                                        crate::postprocess::default_coding_tasks_instructions(),
                                },
                            );
                            cfg.selected_prompt_id = "coding_tasks".to_string();
                        } else {
                            if let Some(p) = cfg.prompts.iter_mut().find(|p| p.id == "coding_tasks") {
                                p.instructions =
                                    crate::postprocess::default_coding_tasks_instructions();
                            }
                            if cfg.selected_prompt_id == "smart_clean" {
                                cfg.selected_prompt_id = "coding_tasks".to_string();
                            }
                        }

                        // Ensure smart_clean preset has the updated strict few-shot instructions if using legacy prompt
                        if let Some(preset) = cfg.prompts.iter_mut().find(|p| p.id == "smart_clean") {
                            if preset.instructions.contains("You are a dictation post-processor")
                                || !preset.instructions.contains("Example 1:")
                            {
                                preset.instructions =
                                    crate::postprocess::default_smart_clean_instructions();
                            }
                        }

                        // Persist updated config back to settings.json
                        if let Ok(new_val) = serde_json::to_value(&cfg) {
                            store.set("postprocess", new_val);
                            let _ = store.save();
                        }

                        let state = app.state::<AppState>();
                        if let Ok(mut guard) = state.postprocess_config.lock() {
                            *guard = cfg;
                        }
                    }
                }
            }

            // Register initial global shortcuts (both raw dictation & postprocess)
            {
                let state = app.state::<AppState>();
                let _ = shortcuts::reregister_all_shortcuts(app.handle(), &state);
            }

            // Restore history and history_limit from settings.json
            if let Ok(store) = app.store("settings.json") {
                if let Some(val) = store.get("history_limit") {
                    if let Some(num) = val.as_u64() {
                        let state = app.state::<AppState>();
                        if let Ok(mut guard) = state.history_limit.lock() {
                            *guard = (num as usize).clamp(1, 30);
                        }
                    }
                }
                if let Some(val) = store.get("history") {
                    if let Ok(items) =
                        serde_json::from_value::<Vec<crate::history::HistoryItem>>(val)
                    {
                        let state = app.state::<AppState>();
                        if let Ok(mut guard) = state.history.lock() {
                            *guard = items;
                        }
                    }
                }
            }

            let copy_last_item = MenuItem::with_id(
                app,
                "copy_last",
                "Copy Last Conversation",
                true,
                None::<&str>,
            )?;
            let settings_item =
                MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu =
                Menu::with_items(app, &[&copy_last_item, &settings_item, &quit_item])?;

            let app_icon = app
                .default_window_icon()
                .expect("Pulse window icon must be defined in bundle")
                .clone();

            let builder = TrayIconBuilder::with_id("main")
                .icon(app_icon)
                .tooltip("Pulse: Ready")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "copy_last" => {
                        let state = app.state::<AppState>();
                        let last_text = {
                            if let Ok(guard) = state.history.lock() {
                                guard.first().map(|item| item.text.clone())
                            } else {
                                None
                            }
                        };
                        if let Some(text) = last_text {
                            if let Ok(mut clipboard) = arboard::Clipboard::new() {
                                let _ = clipboard.set_text(text);
                            }
                        }
                    }
                    "settings" => {
                        if let Some(window) = app.get_webview_window("settings") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("settings") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });

            builder.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            models::list_models,
            models::download_model,
            models::delete_model,
            models::set_active_model,
            audio::start_recording,
            audio::stop_recording,
            audio::test_microphone,
            transcriber::transcribe_audio,
            transcriber::test_transcribe,
            shortcuts::get_shortcut,
            shortcuts::set_shortcut,
            shortcuts::get_shortcut_mode,
            shortcuts::set_shortcut_mode,
            shortcuts::cancel_recording,
            history::get_history,
            history::delete_history_item,
            history::clear_history,
            history::get_history_limit,
            history::set_history_limit,
            postprocess::get_postprocess_config,
            postprocess::save_postprocess_config,
            postprocess::fetch_postprocess_models,
            postprocess::set_postprocess_hotkey,
            postprocess::test_postprocess,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
