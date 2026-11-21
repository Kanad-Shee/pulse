use crate::types::{CanaryError, Result};
use ndarray::Array3;
use std::path::Path;

pub fn load_audio_file<P: AsRef<Path>>(path: P) -> Result<(Vec<f32>, usize, usize)> {
    let path = path.as_ref();

    // Check if it's a raw file
    if path.extension().and_then(|s| s.to_str()) == Some("raw") {
        // Assume 16kHz mono f32
        let bytes = std::fs::read(path)?;
        if bytes.len() % 4 != 0 {
            return Err(CanaryError::AudioError(
                "Raw audio length must be a multiple of 4 bytes".into(),
            ));
        }
        let samples: Vec<f32> = bytes
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect();

        return Ok((samples, 16000, 1));
    }

    // Otherwise try to load as WAV
    let mut reader = hound::WavReader::open(path)
        .map_err(|e| CanaryError::AudioError(format!("Failed to open WAV: {}", e)))?;

    let spec = reader.spec();
    let sample_rate = spec.sample_rate as usize;
    let channels = spec.channels as usize;

    let samples: Vec<f32> = match (spec.sample_format, spec.bits_per_sample) {
        (hound::SampleFormat::Float, 32) => reader
            .samples::<f32>()
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| CanaryError::AudioError(format!("Failed to read samples: {}", e)))?,
        (hound::SampleFormat::Int, 16) => reader
            .samples::<i16>()
            .map(|s| s.map(|s| s as f32 / 32768.0))
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| CanaryError::AudioError(format!("Failed to read samples: {}", e)))?,
        (hound::SampleFormat::Int, bits) => {
            let scale = (1u32 << (bits - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.map(|s| s as f32 / scale))
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(|e| CanaryError::AudioError(format!("Failed to read samples: {}", e)))?
        }
        _ => {
            return Err(CanaryError::AudioError(format!(
                "Unsupported audio format: {:?} {}-bit",
                spec.sample_format, spec.bits_per_sample
            )));
        }
    };

    Ok((samples, sample_rate, channels))
}

pub fn to_mono(audio: &[f32], channels: usize) -> Vec<f32> {
    audio
        .chunks(channels)
        .map(|chunk| chunk.iter().sum::<f32>() / channels as f32)
        .collect()
}

pub fn resample(audio: &[f32], from_rate: usize, to_rate: usize) -> Result<Vec<f32>> {
    if audio.is_empty() {
        return Ok(Vec::new());
    }
    if from_rate == to_rate {
        return Ok(audio.to_vec());
    }

    let ratio = to_rate as f32 / from_rate as f32;
    let new_len = (audio.len() as f32 * ratio).round() as usize;
    let mut resampled = Vec::with_capacity(new_len);

    for i in 0..new_len {
        let src_idx = i as f32 / ratio;
        let idx0 = src_idx.floor() as usize;
        let idx1 = (idx0 + 1).min(audio.len() - 1);
        let frac = src_idx - idx0 as f32;
        resampled.push(audio[idx0] * (1.0 - frac) + audio[idx1] * frac);
    }

    Ok(resampled)
}

pub fn extract_features(audio: &[f32], sample_rate: usize) -> Result<Array3<f32>> {
    use rustfft::{num_complex::Complex, num_traits::Zero, FftPlanner};
    use std::f32::consts::PI;

    let sample_rate = sample_rate as f32;
    let n_fft: usize = 512;
    let win_length: usize = 400; // 25ms at 16kHz
    let hop_length: usize = 160; // 10ms at 16kHz
    let n_mels: usize = 128; // Canary uses 128 mel features
    let log_guard = 1e-5f32;
    let norm_eps = 1e-5f32;

    let pad = n_fft / 2;
    let mut padded = vec![0.0f32; audio.len() + 2 * pad];
    if !audio.is_empty() {
        padded[pad..pad + audio.len()].copy_from_slice(audio);
    }

    let n_frames = audio.len() / hop_length + 1;

    let mut window = vec![0.0f32; win_length];
    if win_length > 1 {
        for i in 0..win_length {
            window[i] = 0.5 - 0.5 * (2.0 * PI * i as f32 / (win_length - 1) as f32).cos();
        }
    }

    let n_freqs = n_fft / 2 + 1;
    let mel_filters = build_mel_filterbank(n_fft, n_mels, sample_rate);

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(n_fft);
    let mut spectrum = vec![Complex::<f32>::zero(); n_fft];

    let mut mel_spectrogram = Array3::<f32>::zeros((1, n_mels, n_frames));

    let mut power = vec![0.0f32; n_freqs];
    for frame_idx in 0..n_frames {
        let start = frame_idx * hop_length;

        for i in 0..n_fft {
            spectrum[i] = Complex::zero();
        }

        for i in 0..win_length {
            let sample = if start + i < padded.len() {
                padded[start + i]
            } else {
                0.0
            };
            spectrum[i].re = sample * window[i];
        }

        fft.process(&mut spectrum);

        for i in 0..n_freqs {
            let c = spectrum[i];
            power[i] = c.re * c.re + c.im * c.im;
        }

        for m in 0..n_mels {
            let mut energy = 0.0f32;
            let filter = &mel_filters[m];
            for (k, w) in filter.iter().enumerate() {
                energy += w * power[k];
            }
            let log_energy = (energy + log_guard).ln();
            mel_spectrogram[[0, m, frame_idx]] = log_energy;
        }
    }

    let mut features = Array3::<f32>::zeros((1, n_mels, n_frames));
    for m in 0..n_mels {
        let mut sum = 0.0f32;
        for t in 0..n_frames {
            sum += mel_spectrogram[[0, m, t]];
        }
        let mean = sum / n_frames as f32;

        let mut var = 0.0f32;
        for t in 0..n_frames {
            let diff = mel_spectrogram[[0, m, t]] - mean;
            var += diff * diff;
        }
        let std = (var / n_frames as f32).sqrt().max(norm_eps);

        for t in 0..n_frames {
            features[[0, m, t]] = (mel_spectrogram[[0, m, t]] - mean) / std;
        }
    }

    Ok(features)
}

fn build_mel_filterbank(n_fft: usize, n_mels: usize, sample_rate: f32) -> Vec<Vec<f32>> {
    fn hz_to_mel(hz: f32) -> f32 {
        2595.0 * (1.0 + hz / 700.0).log10()
    }

    fn mel_to_hz(mel: f32) -> f32 {
        700.0 * (10f32.powf(mel / 2595.0) - 1.0)
    }

    let mel_min = hz_to_mel(0.0);
    let mel_max = hz_to_mel(sample_rate / 2.0);
    let mut mel_points = Vec::with_capacity(n_mels + 2);
    for i in 0..(n_mels + 2) {
        let mel = mel_min + (mel_max - mel_min) * i as f32 / (n_mels + 1) as f32;
        mel_points.push(mel_to_hz(mel));
    }

    let freq_bins = n_fft / 2 + 1;
    let freq_bin_width = sample_rate / n_fft as f32;
    let mut filters = vec![vec![0.0f32; freq_bins]; n_mels];
    for m in 0..n_mels {
        let left = mel_points[m];
        let center = mel_points[m + 1];
        let right = mel_points[m + 2];

        for k in 0..freq_bins {
            let freq = k as f32 * freq_bin_width;
            if freq >= left && freq <= center {
                filters[m][k] = (freq - left) / (center - left);
            } else if freq > center && freq <= right {
                filters[m][k] = (right - freq) / (right - center);
            }
        }
    }

    filters
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_mono_averages_channels() {
        let audio = vec![1.0_f32, 0.0, 0.5, 0.5];
        let mono = to_mono(&audio, 2);
        assert_eq!(mono, vec![0.5, 0.5]);
    }

    #[test]
    fn extract_features_shape_matches_expected() {
        let audio = vec![0.0_f32; 160];
        let features = extract_features(&audio, 16000).expect("features");
        let shape = features.shape();
        assert_eq!(shape, &[1, 128, 2]);
    }
}
