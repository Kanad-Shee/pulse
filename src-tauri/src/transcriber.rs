use serde::Serialize;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Runtime, State};
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters,
};
use parakeet_rs::{ExecutionConfig, ParakeetTDT, Transcriber, Nemotron, ParakeetUnified, SentencePieceVocab};
use canary_rs::Canary;
use crate::models::{
    find_canary_dir, find_moonshine_dir, find_multitalker_dir, find_nemotron_dir,
    find_parakeet_dir, find_unified_dir, get_models_dir, CATALOG, ModelEngine,
};
use crate::state::{AppState, LoadedModel};
use ndarray::{Array1, Array2, Array3, Array4};
use realfft::RealFftPlanner;

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

pub fn create_optimized_exec_config(env: parakeet_rs::ort::environment::Environment) -> ExecutionConfig {
    let intra = num_cpus::get_physical().clamp(2, 6);
    ExecutionConfig::new()
        .with_environment(env)
        .with_intra_threads(intra)
        .with_inter_threads(1)
        .with_custom_configure(|builder| {
            let b = builder.with_memory_pattern(true)?;
            Ok(b)
        })
}

pub fn build_optimized_session(
    env: &parakeet_rs::ort::environment::Environment,
    model_path: &Path,
) -> Result<parakeet_rs::ort::session::Session, String> {
    use parakeet_rs::ort::session::builder::GraphOptimizationLevel;

    let intra_threads = num_cpus::get_physical().clamp(2, 6);

    let mut builder = parakeet_rs::ort::session::Session::builder(env)
        .map_err(|e| format!("Failed to create session builder: {e}"))?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| format!("Failed to set Level3 optimization: {e}"))?
        .with_intra_threads(intra_threads)
        .map_err(|e| format!("Failed to set intra threads: {e}"))?
        .with_inter_threads(1)
        .map_err(|e| format!("Failed to set inter threads: {e}"))?
        .with_memory_pattern(true)
        .map_err(|e| format!("Failed to set memory pattern: {e}"))?;

    builder
        .commit_from_file(model_path)
        .map_err(|e| format!("Failed to load ONNX session from {}: {e}", model_path.display()))
}

// =========================================================================
// NeMo 128-Mel Spectrogram Generator for Multitalker
// =========================================================================

fn hz_to_mel(hz: f32) -> f32 {
    2595.0 * (1.0 + hz / 700.0).log10()
}

fn mel_to_hz(mel: f32) -> f32 {
    700.0 * (10.0f32.powf(mel / 2595.0) - 1.0)
}

pub fn create_nemo_mel_filterbank(n_fft: usize, n_mels: usize, sample_rate: usize) -> Array2<f32> {
    let num_bins = n_fft / 2 + 1;
    let mut weights = Array2::<f32>::zeros((n_mels, num_bins));
    let mel_low = hz_to_mel(0.0);
    let mel_high = hz_to_mel((sample_rate / 2) as f32);
    let mel_step = (mel_high - mel_low) / (n_mels + 1) as f32;

    let mut mel_points = Vec::with_capacity(n_mels + 2);
    for i in 0..=n_mels + 1 {
        mel_points.push(mel_to_hz(mel_low + i as f32 * mel_step));
    }

    let bin_width = sample_rate as f32 / n_fft as f32;
    for m in 0..n_mels {
        let left = mel_points[m];
        let center = mel_points[m + 1];
        let right = mel_points[m + 2];

        for k in 0..num_bins {
            let freq = k as f32 * bin_width;
            if freq >= left && freq <= center {
                weights[[m, k]] = (freq - left) / (center - left).max(1e-5);
            } else if freq > center && freq <= right {
                weights[[m, k]] = (right - freq) / (right - center).max(1e-5);
            }
        }
        let filter_width = right - left;
        if filter_width > 0.0 {
            let norm = 2.0 / filter_width;
            for k in 0..num_bins {
                weights[[m, k]] *= norm;
            }
        }
    }
    weights
}

pub fn extract_nemo_mel_features(audio: &[f32], mel_basis: &Array2<f32>) -> Array3<f32> {
    const N_FFT: usize = 512;
    const HOP_LENGTH: usize = 160;
    const WIN_LENGTH: usize = 400;
    const N_MELS: usize = 128;

    if audio.is_empty() {
        return Array3::zeros((1, N_MELS, 0));
    }

    let mut preemph = Vec::with_capacity(audio.len());
    preemph.push(audio[0]);
    for i in 1..audio.len() {
        preemph.push(audio[i] - 0.97 * audio[i - 1]);
    }

    let pad = N_FFT / 2;
    let mut padded = vec![0.0f32; pad];
    padded.extend_from_slice(&preemph);
    padded.resize(padded.len() + pad, 0.0);

    let num_frames = audio.len() / HOP_LENGTH;
    if num_frames == 0 {
        return Array3::zeros((1, N_MELS, 0));
    }

    let window: Vec<f32> = (0..WIN_LENGTH)
        .map(|i| 0.5 - 0.5 * ((2.0 * std::f32::consts::PI * i as f32) / (WIN_LENGTH as f32 - 1.0)).cos())
        .collect();

    let mut planner = RealFftPlanner::<f32>::new();
    let plan = planner.plan_fft_forward(N_FFT);
    let mut input = vec![0.0f32; N_FFT];
    let mut output = plan.make_output_vec();
    let window_offset = (N_FFT - WIN_LENGTH) / 2;

    let num_bins = N_FFT / 2 + 1;
    let mut mel_spectrogram = Array2::<f32>::zeros((N_MELS, num_frames));

    for f in 0..num_frames {
        let start = f * HOP_LENGTH;
        input.fill(0.0);
        for i in 0..WIN_LENGTH {
            if start + window_offset + i < padded.len() {
                input[window_offset + i] = padded[start + window_offset + i] * window[i];
            }
        }
        let _ = plan.process(&mut input, &mut output);

        let mut power = vec![0.0f32; num_bins];
        for k in 0..num_bins {
            let re = output[k].re;
            let im = output[k].im;
            power[k] = re * re + im * im;
        }

        for m in 0..N_MELS {
            let mut sum = 0.0f32;
            for k in 0..num_bins {
                sum += mel_basis[[m, k]] * power[k];
            }
            mel_spectrogram[[m, f]] = (sum + 5.9604645e-8).ln();
        }
    }

    for m in 0..N_MELS {
        let mut mean = 0.0f32;
        for f in 0..num_frames {
            mean += mel_spectrogram[[m, f]];
        }
        mean /= num_frames as f32;

        let mut var = 0.0f32;
        for f in 0..num_frames {
            let diff = mel_spectrogram[[m, f]] - mean;
            var += diff * diff;
        }
        let std = (var / num_frames as f32).sqrt().max(1e-5);

        for f in 0..num_frames {
            mel_spectrogram[[m, f]] = (mel_spectrogram[[m, f]] - mean) / std;
        }
    }

    let mut out = Array3::<f32>::zeros((1, N_MELS, num_frames));
    for m in 0..N_MELS {
        for f in 0..num_frames {
            out[[0, m, f]] = mel_spectrogram[[m, f]];
        }
    }
    out
}

// =========================================================================
// Multitalker Runner (Single-Speaker Streaming Mode)
// =========================================================================

pub struct MultitalkerRunner {
    encoder: parakeet_rs::ort::session::Session,
    decoder_joint: parakeet_rs::ort::session::Session,
    vocab: SentencePieceVocab,
    cache_last_channel: Array4<f32>,
    cache_last_time: Array4<f32>,
    cache_last_channel_len: Array1<i64>,
    state_1: Array3<f32>,
    state_2: Array3<f32>,
    last_token: i32,
    audio_buffer: Vec<f32>,
    accumulated_tokens: Vec<usize>,
    mel_basis: Array2<f32>,
}

impl MultitalkerRunner {
    pub fn new(model_dir: &Path) -> Result<Self, String> {
        let encoder_path = if model_dir.join("encoder.int8.onnx").exists() {
            model_dir.join("encoder.int8.onnx")
        } else {
            model_dir.join("encoder.onnx")
        };
        let decoder_path = if model_dir.join("decoder_joint.int8.onnx").exists() {
            model_dir.join("decoder_joint.int8.onnx")
        } else {
            model_dir.join("decoder_joint.onnx")
        };
        let tokenizer_path = model_dir.join("tokenizer.model");

        let vocab = SentencePieceVocab::from_file(&tokenizer_path)
            .map_err(|e| format!("Failed to load tokenizer for Multitalker: {e}"))?;

        let env = get_ort_env()?;
        let encoder = build_optimized_session(&env, &encoder_path)?;
        let decoder_joint = build_optimized_session(&env, &decoder_path)?;

        let mel_basis = create_nemo_mel_filterbank(512, 128, 16000);

        Ok(Self {
            encoder,
            decoder_joint,
            vocab,
            cache_last_channel: Array4::zeros((1, 24, 70, 1024)),
            cache_last_time: Array4::zeros((1, 24, 1024, 8)),
            cache_last_channel_len: Array1::from_vec(vec![0i64]),
            state_1: Array3::zeros((2, 1, 640)),
            state_2: Array3::zeros((2, 1, 640)),
            last_token: 1024,
            audio_buffer: Vec::new(),
            accumulated_tokens: Vec::new(),
            mel_basis,
        })
    }

    pub fn reset(&mut self) {
        self.cache_last_channel.fill(0.0);
        self.cache_last_time.fill(0.0);
        self.cache_last_channel_len[0] = 0;
        self.state_1.fill(0.0);
        self.state_2.fill(0.0);
        self.last_token = 1024;
        self.audio_buffer.clear();
        self.accumulated_tokens.clear();
    }

    pub fn get_transcript(&self) -> String {
        self.vocab.decode(&self.accumulated_tokens)
    }

    pub fn transcribe_chunk(&mut self, chunk: &[f32]) -> Result<String, String> {
        self.audio_buffer.extend_from_slice(chunk);
        if self.audio_buffer.len() < 8960 {
            return Ok(String::new());
        }

        let mut emitted_text = String::new();
        while self.audio_buffer.len() >= 8960 {
            let drained: Vec<f32> = self.audio_buffer.drain(..8960).collect();
            let text = self.process_raw_chunk(&drained)?;
            if !text.is_empty() {
                emitted_text.push_str(&text);
            }
        }

        Ok(emitted_text)
    }

    fn process_raw_chunk(&mut self, chunk: &[f32]) -> Result<String, String> {
        let features = extract_nemo_mel_features(chunk, &self.mel_basis);
        let t_mel = features.shape()[2];
        let t_enc = t_mel / 8;
        if t_enc == 0 {
            return Ok(String::new());
        }

        let length_arr = Array1::from_vec(vec![t_mel as i64]);
        let spk_targets = Array2::from_elem((1, t_enc), 1.0f32);
        let bg_spk_targets = Array2::from_elem((1, t_enc), 0.0f32);

        let encoder_outputs = self.encoder.run(parakeet_rs::ort::inputs![
            "processed_signal" => parakeet_rs::ort::value::Value::from_array(features).map_err(|e| e.to_string())?,
            "processed_signal_length" => parakeet_rs::ort::value::Value::from_array(length_arr).map_err(|e| e.to_string())?,
            "cache_last_channel" => parakeet_rs::ort::value::Value::from_array(self.cache_last_channel.clone()).map_err(|e| e.to_string())?,
            "cache_last_time" => parakeet_rs::ort::value::Value::from_array(self.cache_last_time.clone()).map_err(|e| e.to_string())?,
            "cache_last_channel_len" => parakeet_rs::ort::value::Value::from_array(self.cache_last_channel_len.clone()).map_err(|e| e.to_string())?,
            "spk_targets" => parakeet_rs::ort::value::Value::from_array(spk_targets).map_err(|e| e.to_string())?,
            "bg_spk_targets" => parakeet_rs::ort::value::Value::from_array(bg_spk_targets).map_err(|e| e.to_string())?
        ]).map_err(|e| format!("Multitalker encoder inference failed: {e}"))?;

        let (enc_shape, enc_data) = encoder_outputs["encoded"]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Failed to extract encoded: {e}"))?;
        let dims = enc_shape.as_ref();
        let encoded = Array3::from_shape_vec(
            (dims[0] as usize, dims[1] as usize, dims[2] as usize),
            enc_data.to_vec(),
        ).map_err(|e| format!("Reshape encoded failed: {e}"))?;

        if let Ok((ch_shape, ch_data)) = encoder_outputs["cache_last_channel_next"].try_extract_tensor::<f32>() {
            let cd = ch_shape.as_ref();
            if cd.len() == 4 {
                if let Ok(c) = Array4::from_shape_vec((cd[0] as usize, cd[1] as usize, cd[2] as usize, cd[3] as usize), ch_data.to_vec()) {
                    self.cache_last_channel = c;
                }
            }
        }
        if let Ok((tm_shape, tm_data)) = encoder_outputs["cache_last_time_next"].try_extract_tensor::<f32>() {
            let td = tm_shape.as_ref();
            if td.len() == 4 {
                if let Ok(c) = Array4::from_shape_vec((td[0] as usize, td[1] as usize, td[2] as usize, td[3] as usize), tm_data.to_vec()) {
                    self.cache_last_time = c;
                }
            }
        }
        if let Ok((_, cl_data)) = encoder_outputs["cache_last_channel_len_next"].try_extract_tensor::<i64>() {
            self.cache_last_channel_len = Array1::from_vec(cl_data.to_vec());
        }

        let mut new_tokens = Vec::new();
        for t in 0..t_enc {
            let frame_slice: Vec<f32> = encoded.slice(ndarray::s![0, t, ..]).to_vec();
            let encoder_frame = Array3::from_shape_vec((1, 1, 1024), frame_slice)
                .map_err(|e| format!("Frame slice error: {e}"))?;

            for _ in 0..10 {
                let targets = Array2::from_shape_vec((1, 1), vec![self.last_token as i64])
                    .map_err(|e| format!("Target shape error: {e}"))?;

                let dec_out = self.decoder_joint.run(parakeet_rs::ort::inputs![
                    "encoder_outputs" => parakeet_rs::ort::value::Value::from_array(encoder_frame.clone()).map_err(|e| e.to_string())?,
                    "targets" => parakeet_rs::ort::value::Value::from_array(targets).map_err(|e| e.to_string())?,
                    "input_states_1" => parakeet_rs::ort::value::Value::from_array(self.state_1.clone()).map_err(|e| e.to_string())?,
                    "input_states_2" => parakeet_rs::ort::value::Value::from_array(self.state_2.clone()).map_err(|e| e.to_string())?
                ]).map_err(|e| format!("Multitalker decoder failed: {e}"))?;

                let (_, logits) = dec_out["outputs"]
                    .try_extract_tensor::<f32>()
                    .map_err(|e| format!("Failed to extract logits: {e}"))?;

                let mut best_idx = 1024;
                let mut max_val = f32::NEG_INFINITY;
                for (i, &val) in logits.iter().enumerate() {
                    if val > max_val {
                        max_val = val;
                        best_idx = i;
                    }
                }

                if let Ok((s1_shape, s1_data)) = dec_out["states_1"].try_extract_tensor::<f32>() {
                    let d = s1_shape.as_ref();
                    if d.len() == 3 {
                        if let Ok(s) = Array3::from_shape_vec((d[0] as usize, d[1] as usize, d[2] as usize), s1_data.to_vec()) {
                            self.state_1 = s;
                        }
                    }
                }
                if let Ok((s2_shape, s2_data)) = dec_out["states_2"].try_extract_tensor::<f32>() {
                    let d = s2_shape.as_ref();
                    if d.len() == 3 {
                        if let Ok(s) = Array3::from_shape_vec((d[0] as usize, d[1] as usize, d[2] as usize), s2_data.to_vec()) {
                            self.state_2 = s;
                        }
                    }
                }

                if best_idx == 1024 {
                    break;
                }
                new_tokens.push(best_idx);
                self.accumulated_tokens.push(best_idx);
                self.last_token = best_idx as i32;
            }
        }

        if !new_tokens.is_empty() {
            Ok(self.vocab.decode(&new_tokens))
        } else {
            Ok(String::new())
        }
    }

    pub fn transcribe_all(&mut self, samples: &[f32]) -> Result<String, String> {
        self.reset();
        let mut full_text = String::new();
        for chunk in samples.chunks(8960) {
            if chunk.len() == 8960 {
                let text = self.process_raw_chunk(chunk)?;
                full_text.push_str(&text);
            } else {
                let mut padded = chunk.to_vec();
                padded.resize(8960, 0.0);
                let text = self.process_raw_chunk(&padded)?;
                full_text.push_str(&text);
            }
        }
        Ok(full_text.trim().to_string())
    }
}

// =========================================================================
// Moonshine Runner (CPU-Cached ONNX Streaming Model)
// =========================================================================

pub struct MoonshineRunner {
    encoder: parakeet_rs::ort::session::Session,
    decoder: parakeet_rs::ort::session::Session,
    tokenizer: tokenizers::Tokenizer,
    audio_buffer: Vec<f32>,
    accumulated_text: String,
}

impl MoonshineRunner {
    pub fn new(model_dir: &Path) -> Result<Self, String> {
        let encoder_path = if model_dir.join("encoder_model_int8.onnx").exists() {
            model_dir.join("encoder_model_int8.onnx")
        } else if model_dir.join("encoder_model.onnx").exists() {
            model_dir.join("encoder_model.onnx")
        } else {
            model_dir.join("encoder.onnx")
        };

        let decoder_path = if model_dir.join("decoder_model_int8.onnx").exists() {
            model_dir.join("decoder_model_int8.onnx")
        } else if model_dir.join("decoder_model.onnx").exists() {
            model_dir.join("decoder_model.onnx")
        } else {
            model_dir.join("decoder_model_merged_quantized.onnx")
        };

        let tokenizer_path = model_dir.join("tokenizer.json");
        let tokenizer = tokenizers::Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| format!("Failed to load Moonshine tokenizer: {e}"))?;

        let env = get_ort_env()?;
        let encoder = build_optimized_session(&env, &encoder_path)?;
        let decoder = build_optimized_session(&env, &decoder_path)?;

        Ok(Self {
            encoder,
            decoder,
            tokenizer,
            audio_buffer: Vec::new(),
            accumulated_text: String::new(),
        })
    }

    pub fn reset(&mut self) {
        self.audio_buffer.clear();
        self.accumulated_text.clear();
    }

    pub fn get_transcript(&self) -> String {
        self.accumulated_text.clone()
    }

    pub fn transcribe_samples(&mut self, samples: &[f32]) -> Result<String, String> {
        if samples.len() < 160 {
            return Ok(String::new());
        }

        let pad_len = (80 - (samples.len() % 80)) % 80;
        let mut padded = samples.to_vec();
        padded.resize(padded.len() + pad_len, 0.0);

        let n = padded.len();
        let input_values = Array2::from_shape_vec((1, n), padded)
            .map_err(|e| format!("Failed to build input values: {e}"))?;
        let attention_mask = Array2::from_elem((1, n), 1i64);

        let enc_out = self.encoder.run(parakeet_rs::ort::inputs![
            "input_values" => parakeet_rs::ort::value::Value::from_array(input_values).map_err(|e| e.to_string())?,
            "attention_mask" => parakeet_rs::ort::value::Value::from_array(attention_mask).map_err(|e| e.to_string())?
        ]).map_err(|e| format!("Moonshine encoder inference failed: {e}"))?;

        let (hs_shape, hs_data) = enc_out["last_hidden_state"]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Failed to extract hidden state: {e}"))?;
        let dims = hs_shape.as_ref();
        let last_hidden_state = Array3::from_shape_vec(
            (dims[0] as usize, dims[1] as usize, dims[2] as usize),
            hs_data.to_vec(),
        ).map_err(|e| format!("Hidden state reshape error: {e}"))?;

        let mut tokens: Vec<u32> = vec![1]; // BOS = 1
        for _ in 0..128 {
            let input_ids = Array2::from_shape_vec((1, tokens.len()), tokens.iter().map(|&t| t as i64).collect())
                .map_err(|e| format!("Input ids error: {e}"))?;

            let dec_out = self.decoder.run(parakeet_rs::ort::inputs![
                "input_ids" => parakeet_rs::ort::value::Value::from_array(input_ids).map_err(|e| e.to_string())?,
                "encoder_hidden_states" => parakeet_rs::ort::value::Value::from_array(last_hidden_state.clone()).map_err(|e| e.to_string())?
            ]).map_err(|e| format!("Moonshine decoder inference failed: {e}"))?;

            let (l_shape, l_data) = dec_out["logits"]
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("Logits extract error: {e}"))?;
            let l_dims = l_shape.as_ref();
            let vocab_size = *l_dims.last().unwrap() as usize;
            let last_token_offset = (tokens.len() - 1) * vocab_size;

            let mut best_id = 2;
            let mut max_val = f32::NEG_INFINITY;
            for i in 0..vocab_size {
                let val = l_data[last_token_offset + i];
                if val > max_val {
                    max_val = val;
                    best_id = i as u32;
                }
            }

            if best_id == 2 || best_id == 0 {
                break;
            }
            tokens.push(best_id);
        }

        let decoded = self.tokenizer.decode(&tokens, true)
            .map_err(|e| format!("Tokenizer decode failed: {e}"))?;
        Ok(decoded.trim().to_string())
    }

    pub fn transcribe_chunk(&mut self, chunk: &[f32]) -> Result<String, String> {
        self.audio_buffer.extend_from_slice(chunk);
        if self.audio_buffer.len() >= 8000 {
            let buffer_copy = self.audio_buffer.clone();
            let text = self.transcribe_samples(&buffer_copy)?;
            let diff = if text.starts_with(&self.accumulated_text) {
                text[self.accumulated_text.len()..].trim().to_string()
            } else {
                text.clone()
            };
            self.accumulated_text = text;
            Ok(diff)
        } else {
            Ok(String::new())
        }
    }
}

// =========================================================================
// Model Loading & Cache Management
// =========================================================================

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

    // Cleanly drop previous ONNX session to free memory before loading new one
    {
        let mut cached = state.cached_context.lock().map_err(|e| e.to_string())?;
        *cached = None;
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
            let config = create_optimized_exec_config(env);
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
                use_itn: Some(false),
                ..Default::default()
            };

            let accel = {
                state.advanced_config.lock().map(|g| g.acceleration.clone()).unwrap_or_else(|_| "auto".to_string())
            };
            let canary_ep = match accel.as_str() {
                "gpu" | "auto" => canary_rs::ExecutionProvider::DirectML,
                _ => canary_rs::ExecutionProvider::Cpu,
            };

            let intra = num_cpus::get_physical().clamp(2, 6);
            let config = canary_rs::ExecutionConfig::new()
                .with_environment(env)
                .with_execution_provider(canary_ep)
                .with_threads(1, intra)
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
            let config = create_optimized_exec_config(env);
            let model = Nemotron::from_pretrained(&nemotron_dir, Some(config))
                .map_err(|e| format!("Failed to load Nemotron model: {e}"))?;

            LoadedModel::Nemotron(Arc::new(Mutex::new(model)))
        }
        ModelEngine::Unified => {
            let unified_base = models_dir.join(target_item.filename);
            let unified_dir = find_unified_dir(&unified_base).ok_or_else(|| {
                format!(
                    "Parakeet Unified model files not found in '{}'. Please download it from Settings first.",
                    unified_base.display()
                )
            })?;

            let env = get_ort_env()?;
            let config = create_optimized_exec_config(env);
            let model = ParakeetUnified::from_pretrained(&unified_dir, Some(config))
                .map_err(|e| format!("Failed to load Parakeet Unified model: {e}"))?;

            LoadedModel::Unified(Arc::new(Mutex::new(model)))
        }
        ModelEngine::Multitalker => {
            let multitalker_base = models_dir.join(target_item.filename);
            let multitalker_dir = find_multitalker_dir(&multitalker_base).ok_or_else(|| {
                format!(
                    "Multitalker model files not found in '{}'. Please download it from Settings first.",
                    multitalker_base.display()
                )
            })?;

            let runner = MultitalkerRunner::new(&multitalker_dir)?;
            LoadedModel::Multitalker(Arc::new(Mutex::new(runner)))
        }
        ModelEngine::Moonshine => {
            let moonshine_base = models_dir.join(target_item.filename);
            let moonshine_dir = find_moonshine_dir(&moonshine_base).ok_or_else(|| {
                format!(
                    "Moonshine model files not found in '{}'. Please download it from Settings first.",
                    moonshine_base.display()
                )
            })?;

            let runner = MoonshineRunner::new(&moonshine_dir)?;
            LoadedModel::Moonshine(Arc::new(Mutex::new(runner)))
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

// =========================================================================
// Unified Streaming Helpers
// =========================================================================

pub fn reset_streaming_model(loaded: &LoadedModel) {
    match loaded {
        LoadedModel::Nemotron(m) => {
            if let Ok(mut n) = m.lock() {
                n.reset();
            }
        }
        LoadedModel::Unified(m) => {
            if let Ok(mut u) = m.lock() {
                u.reset();
            }
        }
        LoadedModel::Multitalker(m) => {
            if let Ok(mut mt) = m.lock() {
                mt.reset();
            }
        }
        LoadedModel::Moonshine(m) => {
            if let Ok(mut ms) = m.lock() {
                ms.reset();
            }
        }
        _ => {}
    }
}

pub fn run_streaming_chunk(loaded: &LoadedModel, chunk: &[f32]) -> Result<String, String> {
    match loaded {
        LoadedModel::Nemotron(m) => {
            let mut n = m.lock().map_err(|e| e.to_string())?;
            n.transcribe_chunk(chunk).map_err(|e| format!("{:?}", e))
        }
        LoadedModel::Unified(m) => {
            let mut u = m.lock().map_err(|e| e.to_string())?;
            u.transcribe_chunk(chunk).map_err(|e| format!("{:?}", e))
        }
        LoadedModel::Multitalker(m) => {
            let mut mt = m.lock().map_err(|e| e.to_string())?;
            mt.transcribe_chunk(chunk)
        }
        LoadedModel::Moonshine(m) => {
            let mut ms = m.lock().map_err(|e| e.to_string())?;
            ms.transcribe_chunk(chunk)
        }
        _ => Ok(String::new()),
    }
}

pub fn finish_streaming_model(loaded: &LoadedModel) -> Result<String, String> {
    match loaded {
        LoadedModel::Nemotron(m) => {
            let n = m.lock().map_err(|e| e.to_string())?;
            Ok(n.get_transcript())
        }
        LoadedModel::Unified(m) => {
            let mut u = m.lock().map_err(|e| e.to_string())?;
            let _ = u.flush();
            Ok(u.get_transcript())
        }
        LoadedModel::Multitalker(m) => {
            let mt = m.lock().map_err(|e| e.to_string())?;
            Ok(mt.get_transcript())
        }
        LoadedModel::Moonshine(m) => {
            let ms = m.lock().map_err(|e| e.to_string())?;
            Ok(ms.get_transcript())
        }
        _ => Ok(String::new()),
    }
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
            LoadedModel::Unified(unified_mutex) => {
                let mut unified = unified_mutex.lock().map_err(|e| e.to_string())?;
                unified.reset();
                let text = unified
                    .transcribe_audio(samples, 16000, 1)
                    .map_err(|e| format!("Parakeet Unified transcription failed: {:?}", e))?;
                text.trim().to_string()
            }
            LoadedModel::Multitalker(multitalker_mutex) => {
                let mut runner = multitalker_mutex.lock().map_err(|e| e.to_string())?;
                runner.transcribe_all(&samples)?
            }
            LoadedModel::Moonshine(moonshine_mutex) => {
                let mut runner = moonshine_mutex.lock().map_err(|e| e.to_string())?;
                runner.transcribe_samples(&samples)?
            }
            LoadedModel::Whisper(ctx) => {
                let mut state = ctx
                    .create_state()
                    .map_err(|e| format!("Failed to create Whisper state: {:?}", e))?;

                let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
                let threads = num_cpus::get_physical().clamp(2, 8) as i32;
                params.set_n_threads(threads);
                params.set_print_special(false);
                params.set_print_progress(false);
                params.set_print_realtime(false);
                params.set_print_timestamps(false);
                params.set_no_timestamps(true);
                params.set_single_segment(true);
                params.set_no_context(true);
                params.set_language(Some("en"));

                let audio_secs = samples.len() as f32 / 16000.0;
                if audio_secs < 28.0 {
                    let raw_ctx = ((audio_secs / 30.0) * 1500.0).ceil().clamp(64.0, 1500.0) as i32;
                    let audio_ctx = (((raw_ctx + 63) / 64) * 64).min(1500);
                    params.set_audio_ctx(audio_ctx);
                }

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
