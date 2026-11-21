use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Runtime, State};
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters,
};
use parakeet_rs::{ExecutionConfig, ParakeetTDT, Transcriber, Nemotron};
use canary_rs::Canary;
use crate::models::{find_canary_dir, find_nemotron_dir, find_parakeet_dir, get_models_dir, CATALOG, ModelEngine};
use crate::state::{AppState, LoadedModel};

static ORT_ENV: Mutex<Option<Arc<parakeet_rs::ort::environment::Environment>>> = Mutex::new(None);

pub fn get_ort_env() -> Result<parakeet_rs::ort::environment::Environment, String> {
    let mut guard = ORT_ENV.lock().map_err(|e| e.to_string())?;
    if let Some(ref env) = *guard {
        return Ok((**env).clone());
    }
    let env = parakeet_rs::ort::init()
        .build()
        .map_err(|e| format!("Failed to initialize ONNX Runtime environment: {e}"))?;
    let env_clone = env.clone();
    *guard = Some(Arc::new(env));
    Ok(env_clone)
}

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
            let parakeet_dir = find_parakeet_dir(&parakeet_base).or_else(|| {
                let legacy = models_dir.join("parakeet-v3-int8");
                find_parakeet_dir(&legacy)
            }).ok_or_else(|| {
                format!(
                    "Parakeet model files not found in '{}'. Please download it from Settings first.",
                    parakeet_base.display()
                )
            })?;

            let env = get_ort_env()?;
            let config = ExecutionConfig::new().with_environment(env);
            let model = ParakeetTDT::from_pretrained(&parakeet_dir, Some(config))
                .map_err(|e| format!("Failed to load Parakeet model: {e}"))?;

            LoadedModel::Parakeet(Arc::new(Mutex::new(model)))
        }
        ModelEngine::Canary => {
            let canary_base = models_dir.join(target_item.filename);
            let canary_dir = find_canary_dir(&canary_base).ok_or_else(|| {
                format!(
                    "Canary model files not found in '{}'. Please download it from Settings first.",
                    canary_base.display()
                )
            })?;

            let env = get_ort_env()?;

            let session_config = canary_rs::SessionConfig {
                use_pnc: true,
                use_itn: Some(false), // Critical: Set use_itn = false and use_pnc = true for canary-180m-flash
                ..Default::default()
            };

            let accel = {
                state.advanced_config.lock().map(|g| g.acceleration.clone()).unwrap_or_else(|_| "auto".to_string())
            };
            let canary_ep = match accel.as_str() {
                "gpu" | "auto" => canary_rs::ExecutionProvider::DirectML,
                _ => canary_rs::ExecutionProvider::Cpu,
            };

            let config = canary_rs::ExecutionConfig::new()
                .with_environment(env)
                .with_execution_provider(canary_ep)
                .with_session_config(session_config);

            let model = Canary::from_pretrained(&canary_dir, Some(config))
                .map_err(|e| format!("Failed to load Canary model: {e}"))?;

            LoadedModel::Canary(Arc::new(Mutex::new(model)))
        }
        ModelEngine::Nemotron => {
            let nemotron_base = models_dir.join(target_item.filename);
            let nemotron_dir = find_nemotron_dir(&nemotron_base).ok_or_else(|| {
                format!(
                    "Nemotron model files not found in '{}'. Please download it from Settings first.",
                    nemotron_base.display()
                )
            })?;

            let env = get_ort_env()?;
            let config = ExecutionConfig::new().with_environment(env);
            let model = Nemotron::from_pretrained(&nemotron_dir, Some(config))
                .map_err(|e| format!("Failed to load Nemotron model: {e}"))?;

            LoadedModel::Nemotron(Arc::new(Mutex::new(model)))
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

pub fn run_nemotron_chunk(
    nemotron_mutex: &Arc<Mutex<Nemotron>>,
    chunk: &[f32],
) -> Result<String, String> {
    let mut nemotron = nemotron_mutex.lock().map_err(|e| e.to_string())?;
    nemotron.transcribe_chunk(chunk).map_err(|e| format!("{:?}", e))
}

pub fn remove_filler_words(text: &str) -> String {
    let re = match regex::Regex::new(r"(?i)\b(um|uh|uhh|umm|er|ah)\b[\s,]*") {
        Ok(r) => r,
        Err(_) => return text.to_string(),
    };
    let cleaned = re.replace_all(text, " ");
    let space_re = match regex::Regex::new(r"\s+") {
        Ok(r) => r,
        Err(_) => return cleaned.to_string(),
    };
    space_re.replace_all(&cleaned, " ").trim().to_string()
}

pub fn apply_custom_words(text: &str, custom_words: &[String]) -> String {
    let mut result = text.to_string();
    for word in custom_words {
        let trimmed = word.trim();
        if trimmed.is_empty() {
            continue;
        }
        let escaped = regex::escape(trimmed);
        let pattern = format!(r"(?i)\b{}\b", escaped);
        if let Ok(re) = regex::Regex::new(&pattern) {
            result = re.replace_all(&result, trimmed).to_string();
        }
    }
    result
}

pub async fn run_transcription(
    model: LoadedModel,
    _model_id: String,
    samples: Vec<f32>,
    canary_langs: Option<(String, String)>,
    adv_config: Option<crate::state::AdvancedConfig>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let raw_text = match model {
            LoadedModel::Parakeet(parakeet_mutex) => {
                let mut parakeet = parakeet_mutex.lock().map_err(|e| e.to_string())?;
                let res = parakeet
                    .transcribe_samples(samples, 16000, 1, None)
                    .map_err(|e| format!("Parakeet transcription failed: {:?}", e))?;
                res.text.trim().to_string()
            }
            LoadedModel::Canary(canary_mutex) => {
                let (src, tgt) = canary_langs.unwrap_or_else(|| ("en".to_string(), "en".to_string()));
                let canary = canary_mutex.lock().map_err(|e| e.to_string())?;
                let mut session = canary.session();
                let res = session
                    .transcribe_samples(&samples, 16000, 1, &src, &tgt)
                    .map_err(|e| format!("Canary transcription failed: {:?}", e))?;
                res.text.trim().to_string()
            }
            LoadedModel::Nemotron(nemotron_mutex) => {
                let mut nemotron = nemotron_mutex.lock().map_err(|e| e.to_string())?;
                nemotron.reset();
                let mut full_text = String::new();
                for chunk in samples.chunks(8960) {
                    if chunk.len() == 8960 {
                        if let Ok(part) = nemotron.transcribe_chunk(chunk) {
                            if !part.is_empty() {
                                full_text.push_str(&part);
                            }
                        }
                    } else {
                        let mut padded = chunk.to_vec();
                        padded.resize(8960, 0.0);
                        if let Ok(part) = nemotron.transcribe_chunk(&padded) {
                            if !part.is_empty() {
                                full_text.push_str(&part);
                            }
                        }
                    }
                }
                full_text.trim().to_string()
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

                if let Some(ref adv) = adv_config {
                    if !adv.custom_words.is_empty() {
                        let prompt = adv.custom_words.join(", ");
                        params.set_initial_prompt(&prompt);
                    }
                }

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

                text.trim().to_string()
            }
        };

        let mut cleaned = raw_text;
        if let Some(ref adv) = adv_config {
            if adv.remove_filler_words {
                cleaned = remove_filler_words(&cleaned);
            }
            if !adv.custom_words.is_empty() {
                cleaned = apply_custom_words(&cleaned, &adv.custom_words);
            }
        }

        Ok(cleaned.trim().to_string())
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
    let canary_langs = {
        let src = state.canary_source_lang.lock().map_err(|e| e.to_string())?.clone();
        let tgt = state.canary_target_lang.lock().map_err(|e| e.to_string())?.clone();
        Some((src, tgt))
    };
    let adv_cfg = state.advanced_config.lock().map(|g| g.clone()).ok();
    run_transcription(model, model_id, samples, canary_langs, adv_cfg).await
}

#[tauri::command]
pub async fn test_transcribe<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<TranscribeResult, String> {
    let (model_id, model) = get_or_load_model(&app, &state)?;
    let canary_langs = {
        let src = state.canary_source_lang.lock().map_err(|e| e.to_string())?.clone();
        let tgt = state.canary_target_lang.lock().map_err(|e| e.to_string())?.clone();
        Some((src, tgt))
    };
    let adv_cfg = state.advanced_config.lock().map(|g| g.clone()).ok();

    state.audio_controller.start_recording(None)?;
    tokio::time::sleep(Duration::from_secs(3)).await;
    let samples = state.audio_controller.stop_recording()?;

    let sample_count = samples.len();
    let duration_secs = sample_count as f32 / 16000.0;

    let transcript = run_transcription(model, model_id, samples, canary_langs, adv_cfg).await?;

    Ok(TranscribeResult {
        transcript,
        duration_secs,
        sample_count,
    })
}
