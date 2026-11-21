use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};

use pulse_lib::models::{
    find_canary_dir, find_moonshine_dir, find_multitalker_dir, find_nemotron_dir,
    find_parakeet_dir, find_unified_dir, is_model_downloaded, ModelEngine, CATALOG,
};
use pulse_lib::state::LoadedModel;
use pulse_lib::transcriber::{
    create_optimized_exec_config, get_ort_env, run_transcription, MoonshineRunner, MultitalkerRunner,
};
use parakeet_rs::{Nemotron, ParakeetTDT, ParakeetUnified};
use canary_rs::Canary;
use whisper_rs::{WhisperContext, WhisperContextParameters};

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

struct SystemMonitor {
    sys: System,
    pid: Pid,
}

impl SystemMonitor {
    fn new() -> Self {
        let mut sys = System::new_all();
        sys.refresh_all();
        let pid = sysinfo::get_current_pid().unwrap_or_else(|_| Pid::from_u32(std::process::id()));
        Self { sys, pid }
    }

    fn refresh(&mut self) {
        self.sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[self.pid]),
            true,
            ProcessRefreshKind::nothing().with_memory().with_cpu(),
        );
    }

    fn current_ram_mb(&mut self) -> f64 {
        self.refresh();
        if let Some(proc) = self.sys.process(self.pid) {
            proc.memory() as f64 / (1024.0 * 1024.0)
        } else {
            0.0
        }
    }

    fn sample_idle_cpu(&mut self, duration_secs: u64) -> f32 {
        let interval = Duration::from_millis(500);
        let steps = (duration_secs * 1000) / 500;
        let mut cpu_samples = Vec::new();

        self.refresh(); // prime baseline
        for _ in 0..steps {
            std::thread::sleep(interval);
            self.refresh();
            if let Some(proc) = self.sys.process(self.pid) {
                cpu_samples.push(proc.cpu_usage());
            }
        }

        if cpu_samples.is_empty() {
            0.0
        } else {
            cpu_samples.iter().sum::<f32>() / cpu_samples.len() as f32
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AudioTestResult {
    avg_ms: f64,
    rtf: f64,
    passes_ms: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ModelBenchmarkResult {
    id: String,
    name: String,
    provider: String,
    engine: String,
    load_ms: f64,
    idle_cpu_pct: f32,
    ram_initial_mb: f64,
    ram_loaded_mb: f64,
    ram_delta_mb: f64,
    ram_peak_mb: f64,
    ram_after_unload_mb: f64,
    tests: std::collections::BTreeMap<String, AudioTestResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HardwareInfo {
    os_name: String,
    os_version: String,
    cpu_brand: String,
    cpu_cores: usize,
    total_ram_mb: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BenchmarkReport {
    timestamp: String,
    models_dir: String,
    hardware: HardwareInfo,
    results: Vec<ModelBenchmarkResult>,
}

fn locate_models_dir() -> Result<PathBuf, String> {
    if let Ok(app_data) = std::env::var("APPDATA") {
        let candidate = PathBuf::from(app_data).join("com.pulse.app").join("models");
        if candidate.exists() && candidate.is_dir() {
            return Ok(candidate);
        }
    }

    let local = PathBuf::from("models");
    if local.exists() && local.is_dir() {
        return Ok(local);
    }

    let parent_local = PathBuf::from("../models");
    if parent_local.exists() && parent_local.is_dir() {
        return Ok(parent_local);
    }

    Err("Could not locate Pulse models directory. Checked %APPDATA%/com.pulse.app/models, ./models, ../models".to_string())
}

fn generate_synthetic_audio(duration_secs: f32) -> Vec<f32> {
    let sample_rate = 16000;
    let num_samples = (sample_rate as f32 * duration_secs) as usize;
    let mut samples = Vec::with_capacity(num_samples);

    for i in 0..num_samples {
        let t = i as f32 / sample_rate as f32;
        // Speech-like amplitude cadence ~3 Hz
        let cadence = 0.5 + 0.5 * (2.0 * std::f32::consts::PI * 3.0 * t).sin();
        // Formant harmonics
        let wave = (2.0 * std::f32::consts::PI * 180.0 * t).sin() * 0.45
            + (2.0 * std::f32::consts::PI * 360.0 * t).sin() * 0.25
            + (2.0 * std::f32::consts::PI * 720.0 * t).sin() * 0.15
            + (2.0 * std::f32::consts::PI * 1440.0 * t).sin() * 0.08;
        samples.push(wave * cadence * 0.65);
    }
    samples
}

fn load_test_audio(duration_secs: f32) -> Vec<f32> {
    // Check if sample.wav exists
    for candidate in &["benchmarks/sample.wav", "../benchmarks/sample.wav"] {
        if Path::new(candidate).exists() {
            break;
        }
    }
    generate_synthetic_audio(duration_secs)
}

fn load_model(
    _item_id: &str,
    engine: ModelEngine,
    filename: &str,
    models_dir: &Path,
) -> Result<LoadedModel, String> {
    match engine {
        ModelEngine::Parakeet => {
            let parakeet_base = models_dir.join(filename);
            let parakeet_dir = find_parakeet_dir(&parakeet_base)
                .or_else(|| {
                    let legacy = models_dir.join("parakeet-v3-int8");
                    find_parakeet_dir(&legacy)
                })
                .ok_or_else(|| {
                    format!("Parakeet files not found in '{}'", parakeet_base.display())
                })?;

            let env = get_ort_env()?;
            let config = create_optimized_exec_config(env);
            let model = ParakeetTDT::from_pretrained(&parakeet_dir, Some(config))
                .map_err(|e| format!("Failed to load Parakeet: {e}"))?;
            Ok(LoadedModel::Parakeet(Arc::new(Mutex::new(model))))
        }
        ModelEngine::Canary => {
            let canary_base = models_dir.join(filename);
            let canary_dir = find_canary_dir(&canary_base)
                .ok_or_else(|| format!("Canary files not found in '{}'", canary_base.display()))?;

            let env = get_ort_env()?;
            let session_config = canary_rs::SessionConfig {
                use_pnc: true,
                use_itn: Some(false),
                ..Default::default()
            };

            let intra = num_cpus::get_physical().clamp(2, 6);
            let config_dml = canary_rs::ExecutionConfig::new()
                .with_environment(env.clone())
                .with_execution_provider(canary_rs::ExecutionProvider::DirectML)
                .with_threads(1, intra)
                .with_session_config(session_config.clone());

            let model = Canary::from_pretrained(&canary_dir, Some(config_dml))
                .or_else(|_| {
                    let config_cpu = canary_rs::ExecutionConfig::new()
                        .with_environment(env)
                        .with_execution_provider(canary_rs::ExecutionProvider::Cpu)
                        .with_threads(1, intra)
                        .with_session_config(session_config);
                    Canary::from_pretrained(&canary_dir, Some(config_cpu))
                })
                .map_err(|e| format!("Failed to load Canary: {e}"))?;

            Ok(LoadedModel::Canary(Arc::new(Mutex::new(model))))
        }
        ModelEngine::Nemotron => {
            let nemotron_base = models_dir.join(filename);
            let nemotron_dir = find_nemotron_dir(&nemotron_base)
                .ok_or_else(|| format!("Nemotron files not found in '{}'", nemotron_base.display()))?;

            let env = get_ort_env()?;
            let config = create_optimized_exec_config(env);
            let model = Nemotron::from_pretrained(&nemotron_dir, Some(config))
                .map_err(|e| format!("Failed to load Nemotron: {e}"))?;
            Ok(LoadedModel::Nemotron(Arc::new(Mutex::new(model))))
        }
        ModelEngine::Unified => {
            let unified_base = models_dir.join(filename);
            let unified_dir = find_unified_dir(&unified_base)
                .ok_or_else(|| format!("Unified files not found in '{}'", unified_base.display()))?;

            let env = get_ort_env()?;
            let config = create_optimized_exec_config(env);
            let model = ParakeetUnified::from_pretrained(&unified_dir, Some(config))
                .map_err(|e| format!("Failed to load Unified: {e}"))?;
            Ok(LoadedModel::Unified(Arc::new(Mutex::new(model))))
        }
        ModelEngine::Multitalker => {
            let multitalker_base = models_dir.join(filename);
            let multitalker_dir = find_multitalker_dir(&multitalker_base).ok_or_else(|| {
                format!(
                    "Multitalker files not found in '{}'",
                    multitalker_base.display()
                )
            })?;

            let runner = MultitalkerRunner::new(&multitalker_dir)?;
            Ok(LoadedModel::Multitalker(Arc::new(Mutex::new(runner))))
        }
        ModelEngine::Moonshine => {
            let moonshine_base = models_dir.join(filename);
            let moonshine_dir = find_moonshine_dir(&moonshine_base)
                .ok_or_else(|| format!("Moonshine files not found in '{}'", moonshine_base.display()))?;

            let runner = MoonshineRunner::new(&moonshine_dir)?;
            Ok(LoadedModel::Moonshine(Arc::new(Mutex::new(runner))))
        }
        ModelEngine::Whisper => {
            let model_path = models_dir.join(filename);
            if !model_path.is_file() {
                return Err(format!("Whisper model '{}' not found", model_path.display()));
            }
            let model_path_str = model_path
                .to_str()
                .ok_or_else(|| "Invalid UTF-8 model path".to_string())?;

            let ctx = WhisperContext::new_with_params(
                model_path_str,
                WhisperContextParameters::default(),
            )
            .map_err(|e| format!("Failed to load Whisper model: {:?}", e))?;
            Ok(LoadedModel::Whisper(Arc::new(ctx)))
        }
    }
}

fn get_provider_name(engine: ModelEngine) -> &'static str {
    match engine {
        ModelEngine::Whisper => "whisper.cpp (CPU)",
        ModelEngine::Parakeet => "ONNX INT8 (CPU)",
        ModelEngine::Canary => "ONNX INT8 (DirectML / CPU)",
        ModelEngine::Nemotron => "ONNX INT8 (CPU)",
        ModelEngine::Unified => "ONNX INT8 (CPU)",
        ModelEngine::Multitalker => "ONNX INT8 (CPU)",
        ModelEngine::Moonshine => "ONNX INT8 (CPU)",
    }
}

#[derive(Debug, Clone)]
struct TargetModel {
    id: String,
    name: String,
    filename: String,
    engine: ModelEngine,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("================================================================================");
    println!("           PULSE SPEECH MODELS BENCHMARK RUNNER (BASELINE SUITE)");
    println!("================================================================================");

    let mut monitor = SystemMonitor::new();
    let models_dir = locate_models_dir()?;
    println!("Using Models Directory: {}", models_dir.display());

    // Detect all downloaded models from catalog
    let mut targets: Vec<TargetModel> = Vec::new();
    for item in CATALOG {
        if is_model_downloaded(item, &models_dir) {
            targets.push(TargetModel {
                id: item.id.to_string(),
                name: item.name.to_string(),
                filename: item.filename.to_string(),
                engine: item.engine,
            });
        }
    }

    // Check for any additional downloaded whisper `.bin` models in models_dir
    if let Ok(entries) = fs::read_dir(&models_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.ends_with(".bin") && !targets.iter().any(|t| t.filename == name) {
                        let display_name = if name.contains("turbo") {
                            "Whisper Large v3 Turbo (q5_0)"
                        } else if name.contains("base") {
                            "Whisper Base"
                        } else if name.contains("small") {
                            "Whisper Small"
                        } else {
                            name
                        };
                        targets.push(TargetModel {
                            id: name.to_string(),
                            name: display_name.to_string(),
                            filename: name.to_string(),
                            engine: ModelEngine::Whisper,
                        });
                    }
                }
            }
        }
    }

    if targets.is_empty() {
        eprintln!("\n[ERROR] No downloaded models found in '{}'.", models_dir.display());
        eprintln!("Please download at least one model in Pulse Settings first.");
        std::process::exit(1);
    }

    println!("\nDiscovered {} downloaded model(s) to benchmark:", targets.len());
    for (i, t) in targets.iter().enumerate() {
        println!("  {}. {} (Engine: {:?}, Filename: {})", i + 1, t.name, t.engine, t.filename);
    }

    let hardware = HardwareInfo {
        os_name: System::name().unwrap_or_else(|| "Windows".to_string()),
        os_version: System::os_version().unwrap_or_else(|| "11".to_string()),
        cpu_brand: monitor
            .sys
            .cpus()
            .first()
            .map(|c| c.brand().trim().to_string())
            .unwrap_or_else(|| "Generic CPU".to_string()),
        cpu_cores: monitor.sys.cpus().len(),
        total_ram_mb: monitor.sys.total_memory() as f64 / (1024.0 * 1024.0),
    };

    println!("\nHardware Profile:");
    println!("  CPU: {} ({} logical cores)", hardware.cpu_brand, hardware.cpu_cores);
    println!("  RAM: {:.1} MB total", hardware.total_ram_mb);
    println!("  OS:  {} {}\n", hardware.os_name, hardware.os_version);

    // Audio test clips
    let test_durations = [
        ("2s", 2.0f32, 2000.0f64),
        ("5s", 5.0f32, 5000.0f64),
        ("15s", 15.0f32, 15000.0f64),
    ];

    println!("Generating test audio fixtures (2s, 5s, 15s @ 16kHz mono)...");
    let audio_clips: Vec<(&'static str, f32, f64, Vec<f32>)> = test_durations
        .iter()
        .map(|(label, dur, ms)| (*label, *dur, *ms, load_test_audio(*dur)))
        .collect();
    println!("Audio fixtures ready.\n");

    let mut report_results: Vec<ModelBenchmarkResult> = Vec::new();

    for (idx, target) in targets.iter().enumerate() {
        println!("--------------------------------------------------------------------------------");
        println!("[{}/{}] Benchmarking Model: {}", idx + 1, targets.len(), target.name);
        println!("--------------------------------------------------------------------------------");

        // 1. Baseline Idle Metrics (Before Load)
        let ram_initial_mb = monitor.current_ram_mb();
        println!("  1. Baseline Idle RAM: {:.2} MB", ram_initial_mb);

        // 2. Cold Model Load Time
        print!("  2. Loading model from disk... ");
        let load_start = Instant::now();
        let loaded_model = match load_model(&target.id, target.engine, &target.filename, &models_dir) {
            Ok(m) => m,
            Err(e) => {
                println!("FAILED!");
                eprintln!("     Error: {e}");
                continue;
            }
        };
        let load_ms = load_start.elapsed().as_secs_f64() * 1000.0;
        let ram_loaded_mb = monitor.current_ram_mb();
        let ram_delta_mb = (ram_loaded_mb - ram_initial_mb).max(0.0);
        println!("DONE in {:.1} ms | Post-load RAM: {:.2} MB (Delta: +{:.2} MB)", load_ms, ram_loaded_mb, ram_delta_mb);

        // 3. Idle CPU Spin Check (3-Second Wait)
        print!("  3. Measuring idle CPU spin (3s no-op wait)... ");
        let idle_cpu_pct = monitor.sample_idle_cpu(3);
        println!("{:.1}% process CPU", idle_cpu_pct);

        // 4. Inference Latency & RTF Across 3 Audio Lengths
        println!("  4. Running Inference Latency & RTF Tests:");
        let mut peak_ram_mb = monitor.current_ram_mb();
        let mut test_results = std::collections::BTreeMap::new();

        for (label, _dur_secs, dur_ms, samples) in &audio_clips {
            // Warm-up pass (discarded)
            let _ = run_transcription(
                loaded_model.clone(),
                target.id.clone(),
                samples.clone(),
                None,
                None,
            )
            .await;

            let ram_cur = monitor.current_ram_mb();
            if ram_cur > peak_ram_mb {
                peak_ram_mb = ram_cur;
            }

            // 3 timed passes
            let mut pass_durations = Vec::with_capacity(3);
            for pass_i in 1..=3 {
                let pass_start = Instant::now();
                let _res = run_transcription(
                    loaded_model.clone(),
                    target.id.clone(),
                    samples.clone(),
                    None,
                    None,
                )
                .await;
                let pass_ms = pass_start.elapsed().as_secs_f64() * 1000.0;
                pass_durations.push(pass_ms);

                let cur_ram = monitor.current_ram_mb();
                if cur_ram > peak_ram_mb {
                    peak_ram_mb = cur_ram;
                }

                print!("     [{}] Pass #{}: {:.1} ms", label, pass_i, pass_ms);
                if pass_i < 3 {
                    print!(" | ");
                } else {
                    println!();
                }
            }

            let avg_ms = pass_durations.iter().sum::<f64>() / pass_durations.len() as f64;
            let rtf = avg_ms / dur_ms;
            println!("     => {} Avg: {:.1} ms (RTF: {:.4})", label, avg_ms, rtf);

            test_results.insert(
                label.to_string(),
                AudioTestResult {
                    avg_ms,
                    rtf,
                    passes_ms: pass_durations,
                },
            );
        }

        println!("     Peak RAM during inference: {:.2} MB", peak_ram_mb);

        // 5. Unload & Memory Reclamation Check
        print!("  5. Unloading model and checking memory reclamation... ");
        drop(loaded_model);
        std::thread::sleep(Duration::from_millis(500));
        let ram_after_unload_mb = monitor.current_ram_mb();
        let reclaimed_mb = (ram_loaded_mb - ram_after_unload_mb).max(0.0);
        println!("DONE | Post-Unload RAM: {:.2} MB (Reclaimed: {:.2} MB)\n", ram_after_unload_mb, reclaimed_mb);

        let provider_str = get_provider_name(target.engine).to_string();

        report_results.push(ModelBenchmarkResult {
            id: target.id.clone(),
            name: target.name.clone(),
            provider: provider_str,
            engine: format!("{:?}", target.engine).to_lowercase(),
            load_ms,
            idle_cpu_pct,
            ram_initial_mb,
            ram_loaded_mb,
            ram_delta_mb,
            ram_peak_mb: peak_ram_mb,
            ram_after_unload_mb,
            tests: test_results,
        });
    }

    // Print Clean Markdown Summary Table to stdout
    println!("\n================================================================================");
    println!("                      OPTIMIZED BENCHMARK SUMMARY TABLE");
    println!("================================================================================\n");

    println!("| Model | Provider | Load (ms) | 2s (ms / RTF) | 5s (ms / RTF) | 15s (ms / RTF) | Idle CPU % | Loaded RAM | Post-Unload RAM |");
    println!("| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |");

    for r in &report_results {
        let test_2s = r.tests.get("2s").map(|t| format!("{:.0} ms / {:.3}", t.avg_ms, t.rtf)).unwrap_or_else(|| "N/A".into());
        let test_5s = r.tests.get("5s").map(|t| format!("{:.0} ms / {:.3}", t.avg_ms, t.rtf)).unwrap_or_else(|| "N/A".into());
        let test_15s = r.tests.get("15s").map(|t| format!("{:.0} ms / {:.3}", t.avg_ms, t.rtf)).unwrap_or_else(|| "N/A".into());

        println!(
            "| {} | {} | {:.0} ms | {} | {} | {} | {:.1}% | {:.0} MB | {:.0} MB |",
            r.name,
            r.provider,
            r.load_ms,
            test_2s,
            test_5s,
            test_15s,
            r.idle_cpu_pct,
            r.ram_loaded_mb,
            r.ram_after_unload_mb,
        );
    }

    // Try loading baseline.json for Before vs. After comparison
    let baseline_paths = [
        PathBuf::from("benchmarks/baseline.json"),
        PathBuf::from("../benchmarks/baseline.json"),
    ];

    let mut baseline_report: Option<BenchmarkReport> = None;
    for b_path in &baseline_paths {
        if let Ok(content) = fs::read_to_string(b_path) {
            if let Ok(parsed) = serde_json::from_str::<BenchmarkReport>(&content) {
                baseline_report = Some(parsed);
                break;
            }
        }
    }

    if let Some(base) = baseline_report {
        println!("\n================================================================================");
        println!("                   BASELINE vs. FINAL OPTIMIZATION COMPARISON");
        println!("================================================================================\n");

        println!("| Model | Metric | Baseline (Before) | Final (After) | Speedup / Change |");
        println!("| :--- | :--- | :---: | :---: | :---: |");

        for cur in &report_results {
            if let Some(prev) = base.results.iter().find(|r| r.id == cur.id) {
                let load_sp = if cur.load_ms > 0.0 { prev.load_ms / cur.load_ms } else { 1.0 };
                println!(
                    "| **{}** | Cold Load | {:.0} ms | {:.0} ms | **{:.2}× faster** |",
                    cur.name, prev.load_ms, cur.load_ms, load_sp
                );

                if let (Some(p2), Some(c2)) = (prev.tests.get("2s"), cur.tests.get("2s")) {
                    let sp = if c2.avg_ms > 0.0 { p2.avg_ms / c2.avg_ms } else { 1.0 };
                    println!(
                        "| | 2s Latency (RTF) | {:.0} ms ({:.3}) | {:.0} ms ({:.3}) | **{:.2}× faster** |",
                        p2.avg_ms, p2.rtf, c2.avg_ms, c2.rtf, sp
                    );
                }

                if let (Some(p5), Some(c5)) = (prev.tests.get("5s"), cur.tests.get("5s")) {
                    let sp = if c5.avg_ms > 0.0 { p5.avg_ms / c5.avg_ms } else { 1.0 };
                    println!(
                        "| | 5s Latency (RTF) | {:.0} ms ({:.3}) | {:.0} ms ({:.3}) | **{:.2}× faster** |",
                        p5.avg_ms, p5.rtf, c5.avg_ms, c5.rtf, sp
                    );
                }

                if let (Some(p15), Some(c15)) = (prev.tests.get("15s"), cur.tests.get("15s")) {
                    let sp = if c15.avg_ms > 0.0 { p15.avg_ms / c15.avg_ms } else { 1.0 };
                    println!(
                        "| | 15s Latency (RTF) | {:.0} ms ({:.3}) | {:.0} ms ({:.3}) | **{:.2}× faster** |",
                        p15.avg_ms, p15.rtf, c15.avg_ms, c15.rtf, sp
                    );
                }

                println!(
                    "| | Peak RAM | {:.0} MB | {:.0} MB | {:+.0} MB |",
                    prev.ram_peak_mb, cur.ram_peak_mb, cur.ram_peak_mb - prev.ram_peak_mb
                );
                println!("| | | | | |");
            }
        }
    }

    println!("\n================================================================================\n");

    // Save final snapshot to benchmarks/final_opt.json
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let full_report = BenchmarkReport {
        timestamp: format!("epoch-{}", now),
        models_dir: models_dir.display().to_string(),
        hardware,
        results: report_results,
    };

    let json_bytes = serde_json::to_string_pretty(&full_report)?;

    let save_targets = [
        PathBuf::from("benchmarks/final_opt.json"),
        PathBuf::from("../benchmarks/final_opt.json"),
    ];

    let mut saved_any = false;
    for out_path in &save_targets {
        if let Some(parent) = out_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if fs::write(out_path, &json_bytes).is_ok() {
            println!("Final JSON saved to: {}", out_path.display());
            saved_any = true;
        }
    }

    if !saved_any {
        let fallback = PathBuf::from("final_opt.json");
        fs::write(&fallback, &json_bytes)?;
        println!("Final JSON saved to: {}", fallback.display());
    }

    println!("\nBenchmark run completed successfully.");
    Ok(())
}
