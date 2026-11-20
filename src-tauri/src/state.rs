use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use crate::audio::AudioController;
use whisper_rs::WhisperContext;
use parakeet_rs::ParakeetTDT;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShortcutMode {
    Hold,
    Toggle,
}

impl Default for ShortcutMode {
    fn default() -> Self {
        ShortcutMode::Hold
    }
}

#[derive(Clone)]
pub enum LoadedModel {
    Whisper(Arc<WhisperContext>),
    Parakeet(Arc<Mutex<ParakeetTDT>>),
}

pub struct AppState {
    pub active_model_id: Mutex<String>,
    pub audio_controller: AudioController,
    pub cached_context: Mutex<Option<(String, LoadedModel)>>,
    pub is_recording: AtomicBool,
    pub current_shortcut: Mutex<String>,
    pub shortcut_mode: Mutex<ShortcutMode>,
    pub last_toggle_at: Mutex<Option<Instant>>,
    pub history: Mutex<Vec<crate::history::HistoryItem>>,
    pub history_limit: Mutex<usize>,
    pub postprocess_config: Mutex<crate::postprocess::PostProcessConfig>,
    pub active_recording_uses_postprocess: AtomicBool,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            active_model_id: Mutex::new("parakeet-tdt-0.6b-v3".to_string()),
            audio_controller: AudioController::new(),
            cached_context: Mutex::new(None),
            is_recording: AtomicBool::new(false),
            current_shortcut: Mutex::new("Alt+Space".to_string()),
            shortcut_mode: Mutex::new(ShortcutMode::Hold),
            last_toggle_at: Mutex::new(None),
            history: Mutex::new(Vec::new()),
            history_limit: Mutex::new(10),
            postprocess_config: Mutex::new(crate::postprocess::PostProcessConfig::default()),
            active_recording_uses_postprocess: AtomicBool::new(false),
        }
    }
}
