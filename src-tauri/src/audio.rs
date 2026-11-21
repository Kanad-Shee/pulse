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
    ReadSince(usize, Sender<(Vec<f32>, usize)>),
    SetKeepMicOpen(bool),
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

    pub fn set_keep_mic_open(&self, enabled: bool) {
        let _ = self.tx.send(AudioCommand::SetKeepMicOpen(enabled));
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

    pub fn read_since(&self, offset: usize) -> (Vec<f32>, usize) {
        let (reply_tx, reply_rx) = mpsc::channel();
        if self.tx.send(AudioCommand::ReadSince(offset, reply_tx)).is_err() {
            return (Vec::new(), offset);
        }
        reply_rx.recv().unwrap_or((Vec::new(), offset))
    }
}

struct AudioStreamState {
    _stream: cpal::Stream,
    stop_drain: Arc<std::sync::atomic::AtomicBool>,
    drain_handle: Option<std::thread::JoinHandle<()>>,
}

fn run_audio_worker(rx: Receiver<AudioCommand>) {
    let mut current_stream_state: Option<AudioStreamState> = None;
    let mut current_buffer: Option<Arc<Mutex<Vec<f32>>>> = None;
    let mut current_sample_rate: u32 = 16000;
    let mut keep_mic_open = false;
    let is_capturing = Arc::new(std::sync::atomic::AtomicBool::new(false));

    while let Ok(cmd) = rx.recv() {
        match cmd {
            AudioCommand::SetKeepMicOpen(enabled) => {
                keep_mic_open = enabled;
                if !enabled && !is_capturing.load(std::sync::atomic::Ordering::Relaxed) {
                    if let Some(mut state) = current_stream_state.take() {
                        state.stop_drain.store(true, std::sync::atomic::Ordering::SeqCst);
                        if let Some(h) = state.drain_handle.take() {
                            let _ = h.join();
                        }
                    }
                    current_buffer = None;
                }
            }
            AudioCommand::Start(reply, app_handle) => {
                // If stream is already alive from keep_mic_open, just clear buffer & start capturing
                if keep_mic_open && current_stream_state.is_some() {
                    if let Some(ref buf_arc) = current_buffer {
                        if let Ok(mut buf) = buf_arc.lock() {
                            buf.clear();
                        }
                    }
                    is_capturing.store(true, std::sync::atomic::Ordering::SeqCst);
                    let _ = reply.send(Ok(()));
                    continue;
                }

                // Drop any stale stream before building new one
                if let Some(mut state) = current_stream_state.take() {
                    state.stop_drain.store(true, std::sync::atomic::Ordering::SeqCst);
                    if let Some(h) = state.drain_handle.take() {
                        let _ = h.join();
                    }
                }
                current_buffer = None;
                is_capturing.store(false, std::sync::atomic::Ordering::SeqCst);

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
                let is_capturing_clone = Arc::clone(&is_capturing);

                // Pre-allocated lock-free SPSC ring buffer (holding up to ~5 seconds of audio)
                let ring_capacity = (current_sample_rate as usize * 5).max(65536);
                let (mut producer, mut consumer) = rtrb::RingBuffer::<f32>::new(ring_capacity);

                let stop_drain = Arc::new(std::sync::atomic::AtomicBool::new(false));
                let stop_drain_clone = Arc::clone(&stop_drain);
                let rec_buf = Arc::clone(&buffer);
                let is_capturing_drain = Arc::clone(&is_capturing);
                let app_opt = app_handle.clone();

                // Dedicated consumer thread to drain samples without blocking the CPAL audio callback
                let drain_handle = std::thread::Builder::new()
                    .name("pulse-audio-drain".to_string())
                    .spawn(move || {
                        let mut last_emit = Instant::now();
                        let mut frame_sum_sq = 0.0f32;
                        let mut frame_count = 0usize;
                        let mut batch = Vec::with_capacity(2048);

                        while !stop_drain_clone.load(std::sync::atomic::Ordering::Relaxed) {
                            batch.clear();
                            while let Ok(sample) = consumer.pop() {
                                if is_capturing_drain.load(std::sync::atomic::Ordering::Relaxed) {
                                    batch.push(sample);
                                    frame_sum_sq += sample * sample;
                                    frame_count += 1;
                                }
                                if batch.len() >= 4096 {
                                    break;
                                }
                            }

                            if !batch.is_empty() {
                                if let Ok(mut g) = rec_buf.lock() {
                                    g.extend_from_slice(&batch);
                                }
                            }

                            let now = Instant::now();
                            if now.duration_since(last_emit) >= Duration::from_millis(33) {
                                last_emit = now;
                                if frame_count > 0 {
                                    let rms = (frame_sum_sq / frame_count as f32).sqrt();
                                    let level = (rms * 5.0).clamp(0.0, 1.0);
                                    if let Some(ref app) = app_opt {
                                        let _ = app.emit("audio-level", level);
                                    }
                                    frame_sum_sq = 0.0;
                                    frame_count = 0;
                                }
                            }

                            std::thread::sleep(Duration::from_millis(4));
                        }

                        // Final drain upon stop
                        batch.clear();
                        while let Ok(sample) = consumer.pop() {
                            if is_capturing_drain.load(std::sync::atomic::Ordering::Relaxed) {
                                batch.push(sample);
                            }
                        }
                        if !batch.is_empty() {
                            if let Ok(mut g) = rec_buf.lock() {
                                g.extend_from_slice(&batch);
                            }
                        }
                    })
                    .expect("Failed to spawn audio drain thread");

                let sample_format = default_config.sample_format();
                let stream_result = match sample_format {
                    cpal::SampleFormat::F32 => {
                        let is_capturing_cb = Arc::clone(&is_capturing_clone);
                        device.build_input_stream(
                            &default_config.into(),
                            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                                if !is_capturing_cb.load(std::sync::atomic::Ordering::Relaxed) {
                                    return;
                                }
                                if channels == 1 {
                                    for &s in data {
                                        let _ = producer.push(s);
                                    }
                                } else {
                                    for frame in data.chunks_exact(channels) {
                                        let sum: f32 = frame.iter().sum();
                                        let mono = sum / channels as f32;
                                        let _ = producer.push(mono);
                                    }
                                }
                            },
                            |err| eprintln!("Audio input stream error: {:?}", err),
                            None,
                        )
                    }
                    cpal::SampleFormat::I16 => {
                        let is_capturing_cb = Arc::clone(&is_capturing_clone);
                        device.build_input_stream(
                            &default_config.into(),
                            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                                if !is_capturing_cb.load(std::sync::atomic::Ordering::Relaxed) {
                                    return;
                                }
                                if channels == 1 {
                                    for &s in data {
                                        let f = s as f32 / 32768.0;
                                        let _ = producer.push(f);
                                    }
                                } else {
                                    for frame in data.chunks_exact(channels) {
                                        let sum: f32 = frame.iter().map(|&s| s as f32 / 32768.0).sum();
                                        let mono = sum / channels as f32;
                                        let _ = producer.push(mono);
                                    }
                                }
                            },
                            |err| eprintln!("Audio input stream error: {:?}", err),
                            None,
                        )
                    }
                    cpal::SampleFormat::U16 => {
                        let is_capturing_cb = Arc::clone(&is_capturing_clone);
                        device.build_input_stream(
                            &default_config.into(),
                            move |data: &[u16], _: &cpal::InputCallbackInfo| {
                                if !is_capturing_cb.load(std::sync::atomic::Ordering::Relaxed) {
                                    return;
                                }
                                if channels == 1 {
                                    for &s in data {
                                        let f = (s as f32 - 32768.0) / 32768.0;
                                        let _ = producer.push(f);
                                    }
                                } else {
                                    for frame in data.chunks_exact(channels) {
                                        let sum: f32 = frame
                                            .iter()
                                            .map(|&s| (s as f32 - 32768.0) / 32768.0)
                                            .sum();
                                        let mono = sum / channels as f32;
                                        let _ = producer.push(mono);
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

                is_capturing.store(true, std::sync::atomic::Ordering::SeqCst);
                current_stream_state = Some(AudioStreamState {
                    _stream: stream,
                    stop_drain,
                    drain_handle: Some(drain_handle),
                });
                current_buffer = Some(buffer);
                let _ = reply.send(Ok(()));
            }
            AudioCommand::Stop(reply) => {
                is_capturing.store(false, std::sync::atomic::Ordering::SeqCst);

                let raw_samples = if keep_mic_open {
                    // Let drain thread finish queued samples
                    std::thread::sleep(Duration::from_millis(15));
                    if let Some(ref buf_arc) = current_buffer {
                        let mut g = buf_arc.lock().unwrap_or_else(|e| e.into_inner());
                        let samples = g.clone();
                        g.clear();
                        samples
                    } else {
                        Vec::new()
                    }
                } else {
                    // Stop drain thread and drop stream to release Windows microphone
                    if let Some(mut state) = current_stream_state.take() {
                        state.stop_drain.store(true, std::sync::atomic::Ordering::SeqCst);
                        if let Some(h) = state.drain_handle.take() {
                            let _ = h.join();
                        }
                    }

                    match current_buffer.take() {
                        Some(buf_arc) => match Arc::try_unwrap(buf_arc) {
                            Ok(mutex) => mutex.into_inner().unwrap_or_default(),
                            Err(shared) => shared.lock().map(|g| g.clone()).unwrap_or_default(),
                        },
                        None => Vec::new(),
                    }
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
            AudioCommand::ReadSince(offset, reply) => {
                let raw_samples = match current_buffer {
                    Some(ref buf_arc) => buf_arc.lock().map(|g| g.clone()).unwrap_or_default(),
                    None => Vec::new(),
                };
                let resampled = resample_to_16k(&raw_samples, current_sample_rate);
                let total = resampled.len();
                if offset < total {
                    let chunk = resampled[offset..].to_vec();
                    let _ = reply.send((chunk, total));
                } else {
                    let _ = reply.send((Vec::new(), total));
                }
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

pub fn trim_silence(samples: &[f32]) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }

    let window_size = 480; // 30ms @ 16kHz
    let threshold: f32 = 0.012; // ~ -38 dB
    let mut first_speech_idx: Option<usize> = None;
    let mut last_speech_idx: Option<usize> = None;

    for (i, chunk) in samples.chunks(window_size).enumerate() {
        let sum_sq: f32 = chunk.iter().map(|&s| s * s).sum();
        let rms = (sum_sq / chunk.len() as f32).sqrt();
        if rms >= threshold {
            let start = i * window_size;
            let end = (start + chunk.len()).min(samples.len());
            if first_speech_idx.is_none() {
                first_speech_idx = Some(start);
            }
            last_speech_idx = Some(end);
        }
    }

    match (first_speech_idx, last_speech_idx) {
        (Some(start), Some(end)) if end > start => {
            // Keep 100ms (1600 samples) pre-speech and 200ms (3200 samples) post-speech
            let pre_pad = 1600;
            let post_pad = 3200;
            let safe_start = start.saturating_sub(pre_pad);
            let safe_end = (end + post_pad).min(samples.len());
            samples[safe_start..safe_end].to_vec()
        }
        _ => Vec::new(),
    }
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
