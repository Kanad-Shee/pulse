use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Runtime, State};
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters,
};
use parakeet_rs::{ExecutionConfig, ParakeetTDT, Transcriber};
use crate::models::{find_parakeet_dir, get_models_dir, CATALOG, ModelEngine};
use crate::state::{AppState, LoadedModel};

pub fn get_or_load_model<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
) -> Result<(String, LoadedModel), String> {
    let active_model = {
        let guard = state.active_model_id.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    // Check if cached context matches the active model
    {
        let cached = state.cached_context.lock().map_err(|e| e.to_string())?;
        if let Some((ref cached_id, ref model)) = *cached {
            if cached_id == &active_model {
                return Ok((cached_id.clone(), model.clone()));
            }
        }
    }

    let target_item = CATALOG
        .iter()
        .find(|item| item.id == active_model)
        .ok_or_else(|| format!("Unknown active model ID: {}", active_model))?;

    let models_dir = get_models_dir(app)?;

    let loaded_model = match target_item.engine {
        ModelEngine::Parakeet => {
            let parakeet_base = models_dir.join(target_item.filename);
            let parakeet_dir = find_parakeet_dir(&parakeet_base).ok_or_else(|| {
                format!(
                    "Parakeet model files not found in '{}'. Please download it from Settings first.",
                    parakeet_base.display()
                )
            })?;

            let env = parakeet_rs::ort::init()
                .build()
                .map_err(|e| format!("Failed to initialize ONNX Runtime environment: {e}"))?;
            let config = ExecutionConfig::new().with_environment(env);
            let model = ParakeetTDT::from_pretrained(&parakeet_dir, Some(config))
                .map_err(|e| format!("Failed to load Parakeet model: {e}"))?;

            LoadedModel::Parakeet(Arc::new(Mutex::new(model)))
        }
        ModelEngine::Whisper => {
            let model_path = models_dir.join(target_item.filename);
            if !model_path.is_file() {
                return Err(format!(
                    "Model '{}' is not downloaded. Please download it from Settings first.",
                    active_model
                ));
            }

            let model_path_str = model_path
                .to_str()
                .ok_or_else(|| "Invalid UTF-8 model path".to_string())?;

            let ctx = WhisperContext::new_with_params(
                model_path_str,
                WhisperContextParameters::default(),
            )
            .map_err(|e| format!("Failed to load Whisper model: {:?}", e))?;

            LoadedModel::Whisper(Arc::new(ctx))
        }
    };

    // Update cache
    {
        let mut cached = state.cached_context.lock().map_err(|e| e.to_string())?;
        *cached = Some((active_model.clone(), loaded_model.clone()));
    }

    Ok((active_model, loaded_model))
}

pub async fn run_transcription(
    model: LoadedModel,
    _model_id: String,
    samples: Vec<f32>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || match model {
        LoadedModel::Parakeet(parakeet_mutex) => {
            let mut parakeet = parakeet_mutex.lock().map_err(|e| e.to_string())?;
            let res = parakeet
                .transcribe_samples(samples, 16000, 1, None)
                .map_err(|e| format!("Parakeet transcription failed: {:?}", e))?;
            Ok(res.text.trim().to_string())
        }
        LoadedModel::Whisper(ctx) => {
            let mut state = ctx
                .create_state()
                .map_err(|e| format!("Failed to create Whisper state: {:?}", e))?;

            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            params.set_print_special(false);
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);
            params.set_language(Some("en"));

            state
                .full(params, &samples)
                .map_err(|e| format!("Inference error: {:?}", e))?;

            let mut text = String::new();
            for segment in state.as_iter() {
                if let Ok(segment_str) = segment.to_str() {
                    let trimmed = segment_str.trim();
                    if !trimmed.is_empty()
                        && !trimmed.eq_ignore_ascii_case("[BLANK_AUDIO]")
                        && !trimmed.eq_ignore_ascii_case("(silence)")
                    {
                        if !text.is_empty() {
                            text.push(' ');
                        }
                        text.push_str(trimmed);
                    }
                }
            }

            Ok(text.trim().to_string())
        }
    })
    .await
    .map_err(|e| format!("Transcription task failed: {}", e))?
}

#[derive(Serialize)]
pub struct TranscribeResult {
    pub transcript: String,
    pub duration_secs: f32,
    pub sample_count: usize,
}

#[tauri::command]
pub async fn transcribe_audio<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    samples: Vec<f32>,
) -> Result<String, String> {
    let (model_id, model) = get_or_load_model(&app, &state)?;
    run_transcription(model, model_id, samples).await
}

#[tauri::command]
pub async fn test_transcribe<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<TranscribeResult, String> {
    let (model_id, model) = get_or_load_model(&app, &state)?;

    state.audio_controller.start_recording(None)?;
    tokio::time::sleep(Duration::from_secs(3)).await;
    let samples = state.audio_controller.stop_recording()?;

    let sample_count = samples.len();
    let duration_secs = sample_count as f32 / 16000.0;

    let transcript = run_transcription(model, model_id, samples).await?;

    Ok(TranscribeResult {
        transcript,
        duration_secs,
        sample_count,
    })
}
