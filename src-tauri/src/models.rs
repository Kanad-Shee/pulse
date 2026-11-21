use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_store::StoreExt;
use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;
use crate::state::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelEngine {
    Whisper,
    Parakeet,
    Canary,
    Nemotron,
    Unified,
    Multitalker,
    Moonshine,
}

#[derive(Debug, Clone)]
pub struct CatalogItem {
    pub id: &'static str,
    pub name: &'static str,
    pub filename: &'static str,
    pub subtitle: &'static str,
    pub description: &'static str,
    pub size_mb: u32,
    pub accuracy: u32,
    pub speed: u32,
    pub languages: &'static str,
    pub engine: ModelEngine,
    pub is_recommended: bool,
    pub is_streaming: bool,
    pub can_translate: bool,
    pub files: &'static [(&'static str, &'static str)],
}

pub const CATALOG: &[CatalogItem] = &[
    CatalogItem {
        id: "parakeet-unified-en-0.6b",
        name: "Parakeet Unified EN 0.6B",
        filename: "parakeet-unified-en-0.6b",
        subtitle: "Fast, accurate live English transcription",
        description: "Fast, accurate live English transcription",
        size_mb: 664,
        accuracy: 95,
        speed: 92,
        languages: "English only",
        engine: ModelEngine::Unified,
        is_recommended: false,
        is_streaming: true,
        can_translate: false,
        files: &[
            (
                "https://huggingface.co/eschmidbauer/parakeet-unified-en-0.6b-onnx/resolve/main/onnx_int8/encoder.int8.onnx",
                "encoder.int8.onnx",
            ),
            (
                "https://huggingface.co/eschmidbauer/parakeet-unified-en-0.6b-onnx/resolve/main/onnx_int8/decoder_joint.int8.onnx",
                "decoder_joint.int8.onnx",
            ),
            (
                "https://huggingface.co/eschmidbauer/parakeet-unified-en-0.6b-onnx/resolve/main/onnx_int8/tokenizer.model",
                "tokenizer.model",
            ),
        ],
    },
    CatalogItem {
        id: "nemotron-speech-streaming-en",
        name: "Nemotron Speech Streaming EN",
        filename: "nemotron-speech-streaming-en",
        subtitle: "English speech-to-text with streaming, token-level timestamps.",
        description: "English speech-to-text with streaming, token-level timestamps.",
        size_mb: 891,
        accuracy: 94,
        speed: 94,
        languages: "English only",
        engine: ModelEngine::Nemotron,
        is_recommended: false,
        is_streaming: true,
        can_translate: false,
        files: &[
            (
                "https://huggingface.co/lokkju/nemotron-speech-streaming-en-0.6b-int8/resolve/main/encoder.onnx",
                "encoder.onnx",
            ),
            (
                "https://huggingface.co/lokkju/nemotron-speech-streaming-en-0.6b-int8/resolve/main/decoder_joint.onnx",
                "decoder_joint.onnx",
            ),
            (
                "https://huggingface.co/lokkju/nemotron-speech-streaming-en-0.6b-int8/resolve/main/tokenizer.model",
                "tokenizer.model",
            ),
        ],
    },
    CatalogItem {
        id: "multitalker-parakeet-streaming-en",
        name: "Multitalker Parakeet Streaming EN",
        filename: "multitalker-parakeet-streaming-en",
        subtitle: "English speech-to-text with streaming, token-level timestamps.",
        description: "English speech-to-text with streaming, token-level timestamps.",
        size_mb: 700,
        accuracy: 93,
        speed: 93,
        languages: "English only",
        engine: ModelEngine::Multitalker,
        is_recommended: false,
        is_streaming: true,
        can_translate: false,
        files: &[
            (
                "https://huggingface.co/smcleod/multitalker-parakeet-streaming-0.6b-v1-onnx-int8/resolve/main/encoder.int8.onnx",
                "encoder.int8.onnx",
            ),
            (
                "https://huggingface.co/smcleod/multitalker-parakeet-streaming-0.6b-v1-onnx-int8/resolve/main/decoder_joint.int8.onnx",
                "decoder_joint.int8.onnx",
            ),
            (
                "https://huggingface.co/smcleod/multitalker-parakeet-streaming-0.6b-v1-onnx-int8/resolve/main/tokenizer.model",
                "tokenizer.model",
            ),
            (
                "https://huggingface.co/smcleod/multitalker-parakeet-streaming-0.6b-v1-onnx-int8/resolve/main/multitalker_config.json",
                "config.json",
            ),
        ],
    },
    CatalogItem {
        id: "moonshine-streaming-medium",
        name: "Moonshine Streaming Medium",
        filename: "moonshine-streaming-medium",
        subtitle: "English speech-to-text with streaming.",
        description: "English speech-to-text with streaming.",
        size_mb: 282,
        accuracy: 91,
        speed: 95,
        languages: "English only",
        engine: ModelEngine::Moonshine,
        is_recommended: false,
        is_streaming: true,
        can_translate: false,
        files: &[
            (
                "https://huggingface.co/Immortalizer/moonshine-streaming-medium-onnx/resolve/main/encoder_model_quantized.onnx",
                "encoder_model_int8.onnx",
            ),
            (
                "https://huggingface.co/Immortalizer/moonshine-streaming-medium-onnx/resolve/main/decoder_model_merged_quantized.onnx",
                "decoder_model_int8.onnx",
            ),
            (
                "https://huggingface.co/UsefulSensors/moonshine-streaming-medium/resolve/main/tokenizer.json",
                "tokenizer.json",
            ),
            (
                "https://huggingface.co/UsefulSensors/moonshine-streaming-medium/resolve/main/config.json",
                "config.json",
            ),
        ],
    },
    CatalogItem {
        id: "moonshine-streaming-small",
        name: "Moonshine Streaming Small",
        filename: "moonshine-streaming-small",
        subtitle: "English speech-to-text with streaming.",
        description: "English speech-to-text with streaming.",
        size_mb: 189,
        accuracy: 88,
        speed: 97,
        languages: "English only",
        engine: ModelEngine::Moonshine,
        is_recommended: false,
        is_streaming: true,
        can_translate: false,
        files: &[
            (
                "https://huggingface.co/Mazino0/moonshine-streaming-small-onnx/resolve/main/encoder_model_int8.onnx",
                "encoder_model_int8.onnx",
            ),
            (
                "https://huggingface.co/Mazino0/moonshine-streaming-small-onnx/resolve/main/decoder_model_int8.onnx",
                "decoder_model_int8.onnx",
            ),
            (
                "https://huggingface.co/Mazino0/moonshine-streaming-small-onnx/resolve/main/tokenizer.json",
                "tokenizer.json",
            ),
            (
                "https://huggingface.co/UsefulSensors/moonshine-streaming-small/resolve/main/config.json",
                "config.json",
            ),
        ],
    },
    CatalogItem {
        id: "moonshine-streaming-tiny",
        name: "Moonshine Streaming Tiny",
        filename: "moonshine-streaming-tiny",
        subtitle: "Ultra-light English speech-to-text with streaming.",
        description: "Ultra-light English speech-to-text with streaming.",
        size_mb: 48,
        accuracy: 82,
        speed: 99,
        languages: "English only",
        engine: ModelEngine::Moonshine,
        is_recommended: false,
        is_streaming: true,
        can_translate: false,
        files: &[
            (
                "https://huggingface.co/felixem/moonshine-streaming-tiny-optimized/resolve/main/onnx_int8/encoder_model_int8.onnx",
                "encoder_model_int8.onnx",
            ),
            (
                "https://huggingface.co/felixem/moonshine-streaming-tiny-optimized/resolve/main/onnx_int8/decoder_model_int8.onnx",
                "decoder_model_int8.onnx",
            ),
            (
                "https://huggingface.co/UsefulSensors/moonshine-streaming-tiny/resolve/main/tokenizer.json",
                "tokenizer.json",
            ),
            (
                "https://huggingface.co/UsefulSensors/moonshine-streaming-tiny/resolve/main/config.json",
                "config.json",
            ),
        ],
    },
    CatalogItem {
        id: "nemotron-streaming-3.5",
        name: "Nemotron Streaming 3.5",
        filename: "nemotron-streaming-3.5",
        subtitle: "Live multilingual transcription across 28 languages",
        description: "Live multilingual transcription across 28 languages",
        size_mb: 716,
        accuracy: 93,
        speed: 90,
        languages: "28 languages",
        engine: ModelEngine::Nemotron,
        is_recommended: true,
        is_streaming: true,
        can_translate: false,
        files: &[
            (
                "https://huggingface.co/Gimics/nemotron-3.5-asr-streaming-0.6b-onnx-int8/resolve/main/encoder.int8.onnx",
                "encoder.onnx",
            ),
            (
                "https://huggingface.co/Gimics/nemotron-3.5-asr-streaming-0.6b-onnx-int8/resolve/main/decoder_joint.int8.onnx",
                "decoder_joint.onnx",
            ),
            (
                "https://huggingface.co/Gimics/nemotron-3.5-asr-streaming-0.6b-onnx-int8/resolve/main/tokenizer.model",
                "tokenizer.model",
            ),
            (
                "https://huggingface.co/Gimics/nemotron-3.5-asr-streaming-0.6b-onnx-int8/resolve/main/config.json",
                "config.json",
            ),
        ],
    },
    CatalogItem {
        id: "parakeet-tdt-0.6b-v3",
        name: "Parakeet TDT 0.6B v3",
        filename: "parakeet-tdt-0.6b-v3",
        subtitle: "Fast and accurate. Supports 25 European languages",
        description: "Fast and accurate. Supports 25 European languages",
        size_mb: 705,
        accuracy: 92,
        speed: 85,
        languages: "25 languages",
        engine: ModelEngine::Parakeet,
        is_recommended: false,
        is_streaming: false,
        can_translate: false,
        files: &[
            (
                "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/encoder-model.int8.onnx",
                "encoder-model.int8.onnx",
            ),
            (
                "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/decoder_joint-model.int8.onnx",
                "decoder_joint-model.int8.onnx",
            ),
            (
                "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/nemo128.onnx",
                "nemo128.onnx",
            ),
            (
                "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/vocab.txt",
                "vocab.txt",
            ),
            (
                "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/config.json",
                "config.json",
            ),
        ],
    },
    CatalogItem {
        id: "canary-180m-flash",
        name: "Canary 180M Flash",
        filename: "canary-180m-flash",
        subtitle: "Tiny and instant, runs well on any hardware",
        description: "Tiny and instant, runs well on any hardware",
        size_mb: 208,
        accuracy: 85,
        speed: 96,
        languages: "4 languages",
        engine: ModelEngine::Canary,
        is_recommended: false,
        is_streaming: false,
        can_translate: true,
        files: &[
            (
                "https://huggingface.co/istupakov/canary-180m-flash-onnx/resolve/main/encoder-model.int8.onnx",
                "encoder-model.int8.onnx",
            ),
            (
                "https://huggingface.co/istupakov/canary-180m-flash-onnx/resolve/main/decoder-model.int8.onnx",
                "decoder-model.int8.onnx",
            ),
            (
                "https://huggingface.co/istupakov/canary-180m-flash-onnx/resolve/main/vocab.txt",
                "vocab.txt",
            ),
            (
                "https://huggingface.co/istupakov/canary-180m-flash-onnx/resolve/main/config.json",
                "config.json",
            ),
        ],
    },
    CatalogItem {
        id: "ggml-tiny.en.bin",
        name: "Whisper Tiny (English)",
        filename: "ggml-tiny.en.bin",
        subtitle: "Fastest (~75 MB), good for quick commands",
        description: "Fastest (~75 MB), good for quick commands",
        size_mb: 75,
        accuracy: 70,
        speed: 98,
        languages: "English",
        engine: ModelEngine::Whisper,
        is_recommended: false,
        is_streaming: false,
        can_translate: false,
        files: &[(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
            "ggml-tiny.en.bin",
        )],
    },
    CatalogItem {
        id: "ggml-base.en.bin",
        name: "Whisper Base (English)",
        filename: "ggml-base.en.bin",
        subtitle: "Balanced speed & accuracy (~142 MB)",
        description: "Balanced speed & accuracy (~142 MB)",
        size_mb: 142,
        accuracy: 78,
        speed: 92,
        languages: "English",
        engine: ModelEngine::Whisper,
        is_recommended: false,
        is_streaming: false,
        can_translate: false,
        files: &[(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
            "ggml-base.en.bin",
        )],
    },
    CatalogItem {
        id: "ggml-small.en.bin",
        name: "Whisper Small (English)",
        filename: "ggml-small.en.bin",
        subtitle: "High accuracy (~466 MB) for technical/coding terms",
        description: "High accuracy (~466 MB) for technical/coding terms",
        size_mb: 466,
        accuracy: 88,
        speed: 80,
        languages: "English",
        engine: ModelEngine::Whisper,
        is_recommended: false,
        is_streaming: false,
        can_translate: false,
        files: &[(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
            "ggml-small.en.bin",
        )],
    },
    CatalogItem {
        id: "ggml-large-v3-turbo-q5_0.bin",
        name: "Whisper Large v3 Turbo",
        filename: "ggml-large-v3-turbo-q5_0.bin",
        subtitle: "Slow on CPU — use Parakeet/Canary for fast local dictation",
        description: "Slow on CPU — use Parakeet/Canary for fast local dictation",
        size_mb: 574,
        accuracy: 94,
        speed: 35,
        languages: "100 languages",
        engine: ModelEngine::Whisper,
        is_recommended: false,
        is_streaming: false,
        can_translate: true,
        files: &[(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
            "ggml-large-v3-turbo-q5_0.bin",
        )],
    },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub subtitle: String,
    pub description: String,
    pub size_mb: u32,
    pub accuracy: u32,
    pub speed: u32,
    pub languages: String,
    pub is_downloaded: bool,
    pub is_active: bool,
    pub engine: ModelEngine,
    pub is_recommended: bool,
    pub is_streaming: bool,
    #[serde(default)]
    pub streaming: bool,
    pub can_translate: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgressPayload {
    pub model_id: String,
    pub percent: f64,
}

pub fn get_models_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let models_dir = app_data.join("models");
    if !models_dir.exists() {
        std::fs::create_dir_all(&models_dir).map_err(|e| e.to_string())?;
    }
    Ok(models_dir)
}

pub fn find_parakeet_dir(base_dir: &Path) -> Option<PathBuf> {
    if base_dir.join("vocab.txt").exists() {
        return Some(base_dir.to_path_buf());
    }
    if let Ok(entries) = std::fs::read_dir(base_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join("vocab.txt").exists() {
                return Some(path);
            }
        }
    }
    None
}

pub fn find_canary_dir(base_dir: &Path) -> Option<PathBuf> {
    if base_dir.join("vocab.txt").exists()
        && (base_dir.join("encoder-model.int8.onnx").exists()
            || base_dir.join("encoder-model.onnx").exists())
    {
        return Some(base_dir.to_path_buf());
    }
    None
}

pub fn find_nemotron_dir(base_dir: &Path) -> Option<PathBuf> {
    if base_dir.join("tokenizer.model").exists()
        && (base_dir.join("encoder.onnx").exists()
            || base_dir.join("encoder.int8.onnx").exists()
            || base_dir.join("encoder-model.int8.onnx").exists())
    {
        return Some(base_dir.to_path_buf());
    }
    None
}

pub fn find_unified_dir(base_dir: &Path) -> Option<PathBuf> {
    if base_dir.join("tokenizer.model").exists()
        && (base_dir.join("encoder.onnx").exists()
            || base_dir.join("encoder.int8.onnx").exists()
            || base_dir.join("encoder-model.int8.onnx").exists()
            || base_dir.join("encoder-model.onnx").exists())
    {
        return Some(base_dir.to_path_buf());
    }
    None
}

pub fn find_multitalker_dir(base_dir: &Path) -> Option<PathBuf> {
    if base_dir.join("tokenizer.model").exists()
        && (base_dir.join("encoder.int8.onnx").exists()
            || base_dir.join("encoder.onnx").exists())
    {
        return Some(base_dir.to_path_buf());
    }
    None
}

pub fn find_moonshine_dir(base_dir: &Path) -> Option<PathBuf> {
    if base_dir.join("tokenizer.json").exists()
        && (base_dir.join("encoder_model_int8.onnx").exists()
            || base_dir.join("encoder_model.onnx").exists()
            || base_dir.join("encoder.onnx").exists())
    {
        return Some(base_dir.to_path_buf());
    }
    None
}

pub fn is_streaming_model(model_id: &str) -> bool {
    CATALOG
        .iter()
        .find(|item| item.id == model_id)
        .map(|item| item.is_streaming)
        .unwrap_or(false)
}

pub fn is_model_downloaded(item: &CatalogItem, models_dir: &Path) -> bool {
    match item.engine {
        ModelEngine::Parakeet => {
            let target_dir = models_dir.join(item.filename);
            let legacy_dir = models_dir.join("parakeet-v3-int8");
            (target_dir.is_dir() && find_parakeet_dir(&target_dir).is_some())
                || (legacy_dir.is_dir() && find_parakeet_dir(&legacy_dir).is_some())
        }
        ModelEngine::Canary => {
            let target_dir = models_dir.join(item.filename);
            target_dir.is_dir() && find_canary_dir(&target_dir).is_some()
        }
        ModelEngine::Nemotron => {
            let target_dir = models_dir.join(item.filename);
            target_dir.is_dir() && find_nemotron_dir(&target_dir).is_some()
        }
        ModelEngine::Unified => {
            let target_dir = models_dir.join(item.filename);
            target_dir.is_dir() && find_unified_dir(&target_dir).is_some()
        }
        ModelEngine::Multitalker => {
            let target_dir = models_dir.join(item.filename);
            target_dir.is_dir() && find_multitalker_dir(&target_dir).is_some()
        }
        ModelEngine::Moonshine => {
            let target_dir = models_dir.join(item.filename);
            target_dir.is_dir() && find_moonshine_dir(&target_dir).is_some()
        }
        ModelEngine::Whisper => {
            let target_file = models_dir.join(item.filename);
            target_file.is_file()
                && target_file.metadata().map(|m| m.len() > 0).unwrap_or(false)
        }
    }
}

#[tauri::command]
pub async fn list_models<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<Vec<ModelInfo>, String> {
    let models_dir = get_models_dir(&app)?;
    let active_id = {
        let guard = state.active_model_id.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    let mut result = Vec::new();
    for item in CATALOG {
        let is_downloaded = is_model_downloaded(item, &models_dir);
        let is_active = item.id == active_id;

        result.push(ModelInfo {
            id: item.id.to_string(),
            name: item.name.to_string(),
            filename: item.filename.to_string(),
            subtitle: item.subtitle.to_string(),
            description: item.description.to_string(),
            size_mb: item.size_mb,
            accuracy: item.accuracy,
            speed: item.speed,
            languages: item.languages.to_string(),
            is_downloaded,
            is_active,
            engine: item.engine,
            is_recommended: item.is_recommended,
            is_streaming: item.is_streaming,
            streaming: item.is_streaming,
            can_translate: item.can_translate,
        });
    }

    Ok(result)
}

struct CancellationGuard<'a> {
    state: &'a AppState,
    model_id: &'a str,
}

impl<'a> Drop for CancellationGuard<'a> {
    fn drop(&mut self) {
        if let Ok(mut map) = self.state.download_cancellations.lock() {
            map.remove(self.model_id);
        }
    }
}

#[tauri::command]
pub async fn download_model<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    model_id: String,
) -> Result<(), String> {
    let target_item = CATALOG
        .iter()
        .find(|item| item.id == model_id)
        .ok_or_else(|| format!("Unknown model ID: {}", model_id))?;

    let cancel_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut cancellations = state.download_cancellations.lock().map_err(|e| e.to_string())?;
        cancellations.insert(model_id.clone(), cancel_flag.clone());
    }
    let _cleaner = CancellationGuard {
        state: &state,
        model_id: &model_id,
    };

    let expected_total_bytes = (target_item.size_mb as u64) * 1024 * 1024;
    let models_dir = get_models_dir(&app)?;

    let is_dir_model = target_item.engine != ModelEngine::Whisper;
    let target_dir = if is_dir_model {
        let dir = models_dir.join(target_item.filename);
        if !dir.exists() {
            tokio::fs::create_dir_all(&dir)
                .await
                .map_err(|e| format!("Failed to create model directory: {}", e))?;
        }
        dir
    } else {
        models_dir.clone()
    };

    let client = reqwest::Client::builder()
        .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
        .http1_only()
        .user_agent("Pulse-App/1.2.0")
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("{:?}", e))?;

    let _ = app.emit(
        "model-download-progress",
        DownloadProgressPayload {
            model_id: model_id.clone(),
            percent: 0.0,
        },
    );

    let mut total_downloaded: u64 = 0;
    let mut last_reported_percent: i64 = -1;

    for (url, relative_name) in target_item.files {
        if cancel_flag.load(std::sync::atomic::Ordering::Relaxed) {
            if is_dir_model {
                let _ = tokio::fs::remove_dir_all(&target_dir).await;
            }
            let _ = app.emit("model-download-cancelled", serde_json::json!({ "model_id": &model_id }));
            return Ok(());
        }

        let final_dest = target_dir.join(relative_name);
        let tmp_dest = target_dir.join(format!("{}.tmp", relative_name));

        // Skip downloading if the file already exists with non-zero size
        if final_dest.is_file() {
            if let Ok(metadata) = final_dest.metadata() {
                if metadata.len() > 0 {
                    total_downloaded += metadata.len();
                    continue;
                }
            }
        }

        // Retry loop for transient network glitches
        let mut response = None;
        let mut last_err = String::new();
        for attempt in 1..=3 {
            if cancel_flag.load(std::sync::atomic::Ordering::Relaxed) {
                if is_dir_model {
                    let _ = tokio::fs::remove_dir_all(&target_dir).await;
                }
                let _ = app.emit("model-download-cancelled", serde_json::json!({ "model_id": &model_id }));
                return Ok(());
            }

            match client.get(*url).send().await {
                Ok(res) if res.status().is_success() => {
                    response = Some(res);
                    break;
                }
                Ok(res) => {
                    last_err = format!("Server returned status: {}", res.status());
                }
                Err(e) => {
                    last_err = format!("{:?}", e);
                }
            }
            if attempt < 3 {
                tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            }
        }

        let response = match response {
            Some(res) => res,
            None => {
                if is_dir_model {
                    let _ = tokio::fs::remove_dir_all(&target_dir).await;
                }
                return Err(format!(
                    "Failed to download '{}' after 3 attempts. Last error: {}",
                    relative_name, last_err
                ));
            }
        };

        let mut file = tokio::fs::File::create(&tmp_dest)
            .await
            .map_err(|e| format!("Failed to create temporary file: {}", e))?;

        let mut stream = response.bytes_stream();

        while let Some(chunk_res) = stream.next().await {
            if cancel_flag.load(std::sync::atomic::Ordering::Relaxed) {
                drop(file);
                let _ = tokio::fs::remove_file(&tmp_dest).await;
                if is_dir_model {
                    let _ = tokio::fs::remove_dir_all(&target_dir).await;
                } else {
                    let _ = tokio::fs::remove_file(&final_dest).await;
                }
                let _ = app.emit("model-download-cancelled", serde_json::json!({ "model_id": &model_id }));
                return Ok(());
            }

            let chunk = match chunk_res {
                Ok(c) => c,
                Err(e) => {
                    drop(file);
                    let _ = tokio::fs::remove_file(&tmp_dest).await;
                    if is_dir_model {
                        let _ = tokio::fs::remove_dir_all(&target_dir).await;
                    }
                    return Err(format!("Error while streaming download: {:?}", e));
                }
            };

            if let Err(e) = file.write_all(&chunk).await {
                drop(file);
                let _ = tokio::fs::remove_file(&tmp_dest).await;
                if is_dir_model {
                    let _ = tokio::fs::remove_dir_all(&target_dir).await;
                }
                return Err(format!("Failed to write to temporary file: {}", e));
            }

            total_downloaded += chunk.len() as u64;
            let percent = (total_downloaded as f64 / expected_total_bytes as f64 * 100.0).clamp(0.0, 99.0);
            let current_percent_int = percent.floor() as i64;

            if current_percent_int > last_reported_percent {
                last_reported_percent = current_percent_int;
                let _ = app.emit(
                    "model-download-progress",
                    DownloadProgressPayload {
                        model_id: model_id.clone(),
                        percent,
                    },
                );
            }
        }

        if let Err(e) = file.flush().await {
            drop(file);
            let _ = tokio::fs::remove_file(&tmp_dest).await;
            if is_dir_model {
                let _ = tokio::fs::remove_dir_all(&target_dir).await;
            }
            return Err(format!("Failed to flush temporary file: {}", e));
        }
        drop(file);

        if cancel_flag.load(std::sync::atomic::Ordering::Relaxed) {
            let _ = tokio::fs::remove_file(&tmp_dest).await;
            if is_dir_model {
                let _ = tokio::fs::remove_dir_all(&target_dir).await;
            } else {
                let _ = tokio::fs::remove_file(&final_dest).await;
            }
            let _ = app.emit("model-download-cancelled", serde_json::json!({ "model_id": &model_id }));
            return Ok(());
        }

        if let Err(e) = tokio::fs::rename(&tmp_dest, &final_dest).await {
            let _ = tokio::fs::remove_file(&tmp_dest).await;
            if is_dir_model {
                let _ = tokio::fs::remove_dir_all(&target_dir).await;
            }
            return Err(format!("Failed to rename temporary file: {}", e));
        }
    }

    // Emit 100% completion
    let _ = app.emit(
        "model-download-progress",
        DownloadProgressPayload {
            model_id: model_id.clone(),
            percent: 100.0,
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn cancel_model_download(
    state: State<'_, AppState>,
    model_id: String,
) -> Result<(), String> {
    let cancellations = state.download_cancellations.lock().map_err(|e| e.to_string())?;
    if let Some(flag) = cancellations.get(&model_id) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_model<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    model_id: String,
) -> Result<(), String> {
    let target_item = CATALOG
        .iter()
        .find(|item| item.id == model_id)
        .ok_or_else(|| format!("Unknown model ID: {}", model_id))?;

    // 1. If model_id is loaded in cached_context, unload it first to release Windows file locks
    {
        let mut cached = state.cached_context.lock().map_err(|e| e.to_string())?;
        if let Some((ref cached_id, _)) = *cached {
            if cached_id == &model_id {
                *cached = None;
            }
        }
    }

    let models_dir = get_models_dir(&app)?;

    // 2. Complete storage cleanup: remove directory and/or files + any leftover partial files
    match target_item.engine {
        ModelEngine::Parakeet
        | ModelEngine::Canary
        | ModelEngine::Nemotron
        | ModelEngine::Unified
        | ModelEngine::Multitalker
        | ModelEngine::Moonshine => {
            let target_dir = models_dir.join(target_item.filename);
            if target_dir.exists() {
                tokio::fs::remove_dir_all(&target_dir)
                    .await
                    .map_err(|e| format!("Failed to delete model directory: {}", e))?;
            }
            // Also clean legacy parakeet directory if deleting parakeet v3
            if target_item.id == "parakeet-tdt-0.6b-v3" {
                let legacy_dir = models_dir.join("parakeet-v3-int8");
                if legacy_dir.exists() {
                    let _ = tokio::fs::remove_dir_all(&legacy_dir).await;
                }
            }
            let tmp_dir = models_dir.join(format!("{}.tmp", target_item.filename));
            if tmp_dir.exists() {
                let _ = tokio::fs::remove_dir_all(&tmp_dir).await;
            }
        }
        ModelEngine::Whisper => {
            let target_file = models_dir.join(target_item.filename);
            let tmp_file = models_dir.join(format!("{}.tmp", target_item.filename));
            let part_file = models_dir.join(format!("{}.part", target_item.filename));
            if target_file.exists() {
                tokio::fs::remove_file(&target_file)
                    .await
                    .map_err(|e| format!("Failed to delete model file: {}", e))?;
            }
            if tmp_file.exists() {
                let _ = tokio::fs::remove_file(&tmp_file).await;
            }
            if part_file.exists() {
                let _ = tokio::fs::remove_file(&part_file).await;
            }
        }
    }

    // 3. Fallback active_model if the deleted model was active
    let is_active = {
        let guard = state.active_model_id.lock().map_err(|e| e.to_string())?;
        *guard == model_id
    };
    if is_active {
        let fallback = CATALOG
            .iter()
            .find(|m| m.id != model_id && is_model_downloaded(m, &models_dir));
        let new_active = match fallback {
            Some(m) => m.id.to_string(),
            None => String::new(),
        };
        {
            let mut guard = state.active_model_id.lock().map_err(|e| e.to_string())?;
            *guard = new_active.clone();
        }
        let store = app.store("settings.json").map_err(|e| e.to_string())?;
        store.set("active_model", serde_json::json!(new_active));
        store.save().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn open_model_folder<R: Runtime>(
    app: AppHandle<R>,
    model_id: String,
) -> Result<(), String> {
    let models_dir = get_models_dir(&app)?;
    let target_item = CATALOG.iter().find(|m| m.id == model_id);

    let path_to_open = if let Some(item) = target_item {
        if item.engine != ModelEngine::Whisper {
            let dir = models_dir.join(item.filename);
            if dir.exists() {
                dir
            } else if item.id == "parakeet-tdt-0.6b-v3" && models_dir.join("parakeet-v3-int8").exists() {
                models_dir.join("parakeet-v3-int8")
            } else {
                models_dir
            }
        } else {
            models_dir
        }
    } else {
        models_dir
    };

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path_to_open)
            .spawn()
            .map_err(|e| format!("Failed to open folder in Explorer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path_to_open)
            .spawn()
            .map_err(|e| format!("Failed to open folder in Finder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path_to_open)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn set_active_model<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    model_id: String,
) -> Result<(), String> {
    let target_item = CATALOG
        .iter()
        .find(|item| item.id == model_id)
        .ok_or_else(|| format!("Unknown model ID: {}", model_id))?;

    let models_dir = get_models_dir(&app)?;

    if !is_model_downloaded(target_item, &models_dir) {
        return Err("Cannot activate a model that has not been downloaded yet".to_string());
    }

    // 1. Update AppState
    {
        let mut guard = state.active_model_id.lock().map_err(|e| e.to_string())?;
        *guard = model_id.clone();
    }

    // Invalidate cached context so next transcription loads the new model
    {
        let mut cached = state.cached_context.lock().map_err(|e| e.to_string())?;
        *cached = None;
    }

    // 2. Persist to tauri-plugin-store
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    store.set("active_model", serde_json::json!(model_id));
    store.save().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_canary_languages(state: State<'_, AppState>) -> Result<(String, String), String> {
    let src = state.canary_source_lang.lock().map_err(|e| e.to_string())?.clone();
    let tgt = state.canary_target_lang.lock().map_err(|e| e.to_string())?.clone();
    Ok((src, tgt))
}

#[tauri::command]
pub async fn set_canary_languages<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    source: String,
    target: String,
) -> Result<(), String> {
    {
        let mut src_guard = state.canary_source_lang.lock().map_err(|e| e.to_string())?;
        *src_guard = source.clone();
        let mut tgt_guard = state.canary_target_lang.lock().map_err(|e| e.to_string())?;
        *tgt_guard = target.clone();
    }
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    store.set("canary_source_lang", serde_json::json!(source));
    store.set("canary_target_lang", serde_json::json!(target));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_catalog_definitions() {
        assert_eq!(CATALOG.len(), 12);
        assert_eq!(CATALOG[0].id, "parakeet-unified-en-0.6b");
        assert_eq!(CATALOG[0].engine, ModelEngine::Unified);
        assert!(CATALOG[0].is_streaming);
        assert_eq!(CATALOG[1].id, "nemotron-speech-streaming-en");
        assert_eq!(CATALOG[1].engine, ModelEngine::Nemotron);
        assert!(CATALOG[1].is_streaming);
        assert_eq!(CATALOG[2].id, "multitalker-parakeet-streaming-en");
        assert_eq!(CATALOG[2].engine, ModelEngine::Multitalker);
        assert!(CATALOG[2].is_streaming);
        assert_eq!(CATALOG[3].id, "moonshine-streaming-medium");
        assert_eq!(CATALOG[3].engine, ModelEngine::Moonshine);
        assert!(CATALOG[3].is_streaming);
        assert_eq!(CATALOG[4].id, "moonshine-streaming-small");
        assert_eq!(CATALOG[4].engine, ModelEngine::Moonshine);
        assert!(CATALOG[4].is_streaming);
        assert_eq!(CATALOG[5].id, "moonshine-streaming-tiny");
        assert_eq!(CATALOG[5].engine, ModelEngine::Moonshine);
        assert!(CATALOG[5].is_streaming);
        assert_eq!(CATALOG[6].id, "nemotron-streaming-3.5");
        assert_eq!(CATALOG[6].engine, ModelEngine::Nemotron);
        assert!(CATALOG[6].is_streaming);
    }
}
