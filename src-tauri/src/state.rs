use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use crate::audio::AudioController;
use whisper_rs::WhisperContext;
use parakeet_rs::{ParakeetTDT, Nemotron};
use canary_rs::Canary;

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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AdvancedConfig {
    // App
    pub start_hidden: bool,
    pub overlay_mode: String,        // "live" | "minimal" | "off"
    pub overlay_position: String,    // "bottom" | "top"
    pub unload_model_minutes: u64,   // 0 = Never, 2, 5, 15, 30

    // Output
    pub paste_method: String,        // "ctrl_v" | "ctrl_shift_v" | "direct_type"
    pub clipboard_handling: String,  // "restore" | "keep"
    pub auto_submit: String,         // "off" | "enter" | "ctrl_enter"
    pub append_trailing_space: bool,

    // Transcription
    pub vad_enabled: bool,
    pub remove_filler_words: bool,
    pub custom_words: Vec<String>,

    // Performance
    pub acceleration: String,        // "auto" | "gpu" | "cpu"
    pub keep_mic_open: bool,
}

impl Default for AdvancedConfig {
    fn default() -> Self {
        Self {
            start_hidden: false,
            overlay_mode: "live".to_string(),
            overlay_position: "bottom".to_string(),
            unload_model_minutes: 5,

            paste_method: "ctrl_v".to_string(),
            clipboard_handling: "restore".to_string(),
            auto_submit: "off".to_string(),
            append_trailing_space: false,

            vad_enabled: true,
            remove_filler_words: true,
            custom_words: Vec::new(),

            acceleration: "auto".to_string(),
            keep_mic_open: false,
        }
    }
}

#[derive(Clone)]
pub enum LoadedModel {
    Whisper(Arc<WhisperContext>),
    Parakeet(Arc<Mutex<ParakeetTDT>>),
    Canary(Arc<Mutex<Canary>>),
    Nemotron(Arc<Mutex<Nemotron>>),
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
    pub canary_source_lang: Mutex<String>,
    pub canary_target_lang: Mutex<String>,
    pub streaming_transcript: Mutex<String>,
    pub download_cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub advanced_config: Mutex<AdvancedConfig>,
    pub last_transcription_at: Mutex<Instant>,
    pub overlay_text_style: Mutex<String>,
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
            canary_source_lang: Mutex::new("en".to_string()),
            canary_target_lang: Mutex::new("en".to_string()),
            streaming_transcript: Mutex::new(String::new()),
            download_cancellations: Mutex::new(HashMap::new()),
            advanced_config: Mutex::new(AdvancedConfig::default()),
            last_transcription_at: Mutex::new(Instant::now()),
            overlay_text_style: Mutex::new("normal".to_string()),
        }
    }
}
