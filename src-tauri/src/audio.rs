use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::sync::{
    mpsc::{self, Receiver, Sender},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use crate::state::AppState;

pub enum AudioCommand {
    Start(Sender<Result<(), String>>, Option<AppHandle>),
    Stop(Sender<Result<Vec<f32>, String>>),
    Snapshot(Sender<Vec<f32>>),
}

#[derive(Clone)]
pub struct AudioController {
    tx: Sender<AudioCommand>,
}

impl AudioController {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel::<AudioCommand>();

        std::thread::Builder::new()
            .name("pulse-audio-worker".to_string())
            .spawn(move || {
                run_audio_worker(rx);
            })
            .expect("Failed to spawn audio worker thread");

        Self { tx }
    }

    pub fn start_recording(&self, app_handle: Option<AppHandle>) -> Result<(), String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx
            .send(AudioCommand::Start(reply_tx, app_handle))
            .map_err(|e| format!("Audio thread disconnected: {}", e))?;
        reply_rx
            .recv()
            .map_err(|e| format!("Failed to receive start response: {}", e))?
    }

    pub fn stop_recording(&self) -> Result<Vec<f32>, String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx
            .send(AudioCommand::Stop(reply_tx))
            .map_err(|e| format!("Audio thread disconnected: {}", e))?;
        reply_rx
            .recv()
            .map_err(|e| format!("Failed to receive stop response: {}", e))?
    }

    pub fn snapshot_samples(&self) -> Vec<f32> {
        let (reply_tx, reply_rx) = mpsc::channel();
        if self.tx.send(AudioCommand::Snapshot(reply_tx)).is_err() {
            return Vec::new();
        }
        reply_rx.recv().unwrap_or_default()
    }
}

fn run_audio_worker(rx: Receiver<AudioCommand>) {
    #[allow(unused_assignments)]
    let mut _current_stream: Option<cpal::Stream> = None;
    let mut current_buffer: Option<Arc<Mutex<Vec<f32>>>> = None;
    let mut current_sample_rate: u32 = 16000;

    while let Ok(cmd) = rx.recv() {
        match cmd {
            AudioCommand::Start(reply, app_handle) => {
                // Drop any existing stream first
                _current_stream = None;
                current_buffer = None;

                let host = cpal::default_host();
                let device = match host.default_input_device() {
                    Some(d) => d,
                    None => {
                        let _ = reply.send(Err("No default input audio device found on Windows".to_string()));
                        continue;
                    }
                };

                let default_config = match device.default_input_config() {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = reply.send(Err(format!("Failed to get default input config: {}", e)));
                        continue;
                    }
                };

                current_sample_rate = default_config.sample_rate().0;
                let channels = default_config.channels() as usize;
                let buffer = Arc::new(Mutex::new(Vec::<f32>::new()));
                let buf_clone = Arc::clone(&buffer);

                let last_emit = Arc::new(Mutex::new(Instant::now()));

                let sample_format = default_config.sample_format();
                let stream_result = match sample_format {
                    cpal::SampleFormat::F32 => {
                        let app_opt = app_handle.clone();
                        let last_emit_clone = Arc::clone(&last_emit);
                        device.build_input_stream(
                            &default_config.into(),
                            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                                if let Ok(mut buf) = buf_clone.lock() {
                                    let mut frame_sum_sq: f32 = 0.0;
                                    let mut frame_count: usize = 0;
                                    if channels == 1 {
                                        for &s in data {
                                            frame_sum_sq += s * s;
                                            frame_count += 1;
                                        }
                                        buf.extend_from_slice(data);
                                    } else {
                                        for frame in data.chunks_exact(channels) {
                                            let sum: f32 = frame.iter().sum();
                                            let mono = sum / channels as f32;
                                            frame_sum_sq += mono * mono;
                                            frame_count += 1;
                                            buf.push(mono);
                                        }
                                    }

                                    if let Some(ref app) = app_opt {
                                        if let Ok(mut last) = last_emit_clone.try_lock() {
                                            let now = Instant::now();
                                            if now.duration_since(*last) >= Duration::from_millis(33) {
                                                *last = now;
                                                if frame_count > 0 {
                                                    let rms = (frame_sum_sq / frame_count as f32).sqrt();
                                                    let level = (rms * 5.0).clamp(0.0, 1.0);
                                                    let _ = app.emit("audio-level", level);
                                                }
                                            }
                                        }
                                    }
                                }
                            },
                            |err| eprintln!("Audio input stream error: {:?}", err),
                            None,
                        )
                    }
                    cpal::SampleFormat::I16 => {
                        let buf_clone = Arc::clone(&buffer);
                        let app_opt = app_handle.clone();
                        let last_emit_clone = Arc::clone(&last_emit);
                        device.build_input_stream(
                            &default_config.into(),
                            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                                if let Ok(mut buf) = buf_clone.lock() {
                                    let mut frame_sum_sq: f32 = 0.0;
                                    let mut frame_count: usize = 0;
                                    if channels == 1 {
                                        for &s in data {
                                            let f = s as f32 / 32768.0;
                                            frame_sum_sq += f * f;
                                            frame_count += 1;
                                            buf.push(f);
                                        }
                                    } else {
                                        for frame in data.chunks_exact(channels) {
                                            let sum: f32 = frame.iter().map(|&s| s as f32 / 32768.0).sum();
                                            let mono = sum / channels as f32;
                                            frame_sum_sq += mono * mono;
                                            frame_count += 1;
                                            buf.push(mono);
                                        }
                                    }

                                    if let Some(ref app) = app_opt {
                                        if let Ok(mut last) = last_emit_clone.try_lock() {
                                            let now = Instant::now();
                                            if now.duration_since(*last) >= Duration::from_millis(33) {
                                                *last = now;
                                                if frame_count > 0 {
                                                    let rms = (frame_sum_sq / frame_count as f32).sqrt();
                                                    let level = (rms * 5.0).clamp(0.0, 1.0);
                                                    let _ = app.emit("audio-level", level);
                                                }
                                            }
                                        }
                                    }
                                }
                            },
                            |err| eprintln!("Audio input stream error: {:?}", err),
                            None,
                        )
                    }
                    cpal::SampleFormat::U16 => {
                        let buf_clone = Arc::clone(&buffer);
                        let app_opt = app_handle.clone();
                        let last_emit_clone = Arc::clone(&last_emit);
                        device.build_input_stream(
                            &default_config.into(),
                            move |data: &[u16], _: &cpal::InputCallbackInfo| {
                                if let Ok(mut buf) = buf_clone.lock() {
                                    let mut frame_sum_sq: f32 = 0.0;
                                    let mut frame_count: usize = 0;
                                    if channels == 1 {
                                        for &s in data {
                                            let f = (s as f32 - 32768.0) / 32768.0;
                                            frame_sum_sq += f * f;
                                            frame_count += 1;
                                            buf.push(f);
                                        }
                                    } else {
                                        for frame in data.chunks_exact(channels) {
                                            let sum: f32 = frame
                                                .iter()
                                                .map(|&s| (s as f32 - 32768.0) / 32768.0)
                                                .sum();
                                            let mono = sum / channels as f32;
                                            frame_sum_sq += mono * mono;
                                            frame_count += 1;
                                            buf.push(mono);
                                        }
                                    }

                                    if let Some(ref app) = app_opt {
                                        if let Ok(mut last) = last_emit_clone.try_lock() {
                                            let now = Instant::now();
                                            if now.duration_since(*last) >= Duration::from_millis(33) {
                                                *last = now;
                                                if frame_count > 0 {
                                                    let rms = (frame_sum_sq / frame_count as f32).sqrt();
                                                    let level = (rms * 5.0).clamp(0.0, 1.0);
                                                    let _ = app.emit("audio-level", level);
                                                }
                                            }
                                        }
                                    }
                                }
                            },
                            |err| eprintln!("Audio input stream error: {:?}", err),
                            None,
                        )
                    }
                    _ => {
                        let _ = reply.send(Err(format!("Unsupported audio sample format: {:?}", sample_format)));
                        continue;
                    }
                };

                let stream = match stream_result {
                    Ok(s) => s,
                    Err(e) => {
                        let _ = reply.send(Err(format!("Failed to build input audio stream: {}", e)));
                        continue;
                    }
                };

                if let Err(e) = stream.play() {
                    let _ = reply.send(Err(format!("Failed to play input audio stream: {}", e)));
                    continue;
                }

                _current_stream = Some(stream);
                current_buffer = Some(buffer);
                let _ = reply.send(Ok(()));
            }
            AudioCommand::Stop(reply) => {
                // Stop and drop the stream to release the Windows microphone
                _current_stream = None;

                let raw_samples = match current_buffer.take() {
                    Some(buf_arc) => match Arc::try_unwrap(buf_arc) {
                        Ok(mutex) => mutex.into_inner().unwrap_or_default(),
                        Err(shared) => shared.lock().map(|g| g.clone()).unwrap_or_default(),
                    },
                    None => Vec::new(),
                };

                let resampled = resample_to_16k(&raw_samples, current_sample_rate);
                let _ = reply.send(Ok(resampled));
            }
            AudioCommand::Snapshot(reply) => {
                let raw_samples = match current_buffer {
                    Some(ref buf_arc) => buf_arc.lock().map(|g| g.clone()).unwrap_or_default(),
                    None => Vec::new(),
                };
                let resampled = resample_to_16k(&raw_samples, current_sample_rate);
                let _ = reply.send(resampled);
            }
        }
    }
}

pub fn resample_to_16k(input: &[f32], source_rate: u32) -> Vec<f32> {
    if input.is_empty() {
        return Vec::new();
    }
    if source_rate == 16000 {
        return input.to_vec();
    }

    let target_rate: f64 = 16000.0;
    let source_rate_f64: f64 = source_rate as f64;
    let ratio = source_rate_f64 / target_rate;
    let target_len = ((input.len() as f64) / ratio).round() as usize;

    let mut output = Vec::with_capacity(target_len);

    for i in 0..target_len {
        let src_idx = i as f64 * ratio;
        let idx0 = src_idx.floor() as usize;
        let idx1 = (idx0 + 1).min(input.len() - 1);
        let fract = (src_idx - idx0 as f64) as f32;

        let sample = input[idx0] * (1.0 - fract) + input[idx1] * fract;
        output.push(sample.clamp(-1.0, 1.0));
    }

    output
}

#[derive(Serialize)]
pub struct MicTestResult {
    pub sample_count: usize,
    pub duration_secs: f32,
    pub peak_amplitude: f32,
    pub rms_amplitude: f32,
}

#[tauri::command]
pub async fn start_recording(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.audio_controller.start_recording(Some(app))
}

#[tauri::command]
pub async fn stop_recording(state: State<'_, AppState>) -> Result<Vec<f32>, String> {
    state.audio_controller.stop_recording()
}

#[tauri::command]
pub async fn test_microphone(app: AppHandle, state: State<'_, AppState>) -> Result<MicTestResult, String> {
    state.audio_controller.start_recording(Some(app))?;
    tokio::time::sleep(Duration::from_secs(3)).await;
    let samples = state.audio_controller.stop_recording()?;

    let sample_count = samples.len();
    let mut peak: f32 = 0.0;
    let mut sum_sq: f32 = 0.0;

    for &s in &samples {
        let abs = s.abs();
        if abs > peak {
            peak = abs;
        }
        sum_sq += s * s;
    }

    let rms = if sample_count > 0 {
        (sum_sq / sample_count as f32).sqrt()
    } else {
        0.0
    };

    Ok(MicTestResult {
        sample_count,
        duration_secs: sample_count as f32 / 16000.0,
        peak_amplitude: peak,
        rms_amplitude: rms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resample_48k_to_16k() {
        // 48kHz for 1 second = 48,000 samples
        let input: Vec<f32> = (0..48000).map(|i| (i as f32 / 48000.0).sin()).collect();
        let resampled = resample_to_16k(&input, 48000);
        // Expect ~16,000 samples
        assert!((resampled.len() as i32 - 16000).abs() <= 2);
    }

    #[test]
    fn test_resample_44_1k_to_16k() {
        // 44.1kHz for 1 second = 44,100 samples
        let input: Vec<f32> = (0..44100).map(|i| (i as f32 / 44100.0).sin()).collect();
        let resampled = resample_to_16k(&input, 44100);
        // Expect ~16,000 samples
        assert!((resampled.len() as i32 - 16000).abs() <= 2);
    }
}
