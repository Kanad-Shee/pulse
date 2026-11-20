To keep **Pulse** lightweight (~10 MB idle instead of Electron's 150 MB+), fast, and easy for a smaller agent model to build without hallucinating, the best stack is **Tauri v2 (Rust backend) + React/Tailwind (minimal Settings window)**.

### Why This Architecture Works Best

- **True Background App:** Tauri v2 natively supports a **Windows System Tray** icon with a hidden main window—no taskbar clutter.
- **Reliable Text Injection:** Instead of simulating individual keystrokes (which lags or breaks in VS Code and terminals), the Rust backend copies the transcript to the clipboard (`arboard`), simulates `Ctrl+V` (`enigo`), and restores your previous clipboard.
- **Free Local Models:** Downloads official GGML models directly from Hugging Face (`ggerganov/whisper.cpp`) into `%APPDATA%/Pulse/models/`. You can switch, download, or delete them anytime.

---

### Master Prompt for Your Antigravity Agent

Copy and paste everything inside the code block below into your Antigravity IDE (or save it as `PLAN.md` in your repo root and tell the agent to execute **Phase 1 only**).

````markdown
# Project Specification: Pulse (Local Windows Voice-to-Text App)

You are building **Pulse**, a minimal, local-first Windows dictation app inspired by Wispr Flow.
**Core Workflow:** App sits silently in the Windows System Tray -> User holds a global shortcut key and speaks -> User releases the key -> Local Whisper model transcribes the audio -> Text is instantly pasted into the currently focused window (e.g., VS Code, browser, Slack).

## Strict Engineering Guardrails (DO NOT VIOLATE)

1. **No Cloud APIs / No Paid Keys:** 100% local inference using `whisper-rs` (`whisper.cpp`).
2. **No Over-Engineering:** No user auth, no database, no LLM post-processing, no floating waveform overlays in v1. Keep the UI to a single clean Settings window opened from the System Tray.
3. **Phased Execution:** Complete ONLY ONE phase at a time. After finishing a phase, run `cargo check` / `npm run build` to verify zero errors, summarize what you built, and **STOP** to wait for my confirmation before starting the next phase.

---

## Tech Stack & Exact Dependencies

- **Shell:** Tauri v2 (Windows target)
- **Frontend:** React + TypeScript + Tailwind CSS (minimal light-mode settings panel)
- **Rust Backend Crates (`src-tauri/Cargo.toml`):**
  - `tauri` (with `tray-icon` feature)
  - `tauri-plugin-global-shortcut` (global push-to-talk hotkey)
  - `tauri-plugin-store` (persist selected model & shortcut in `settings.json`)
  - `cpal` (microphone audio capture)
  - `whisper-rs` (local Whisper inference)
  - `reqwest` (with `stream` feature, for downloading models from Hugging Face)
  - `arboard` (clipboard read/write)
  - `enigo` (simulate `Ctrl+V` keystroke on Windows)
  - `tokio` (async runtime)
  - `serde` / `serde_json`

---

## Folder Structure

```text
pulse/
├── index.html
├── package.json
├── app/ (or src/ if default Tauri Vite template)
│   ├── App.tsx                # Main Settings UI (Hotkey, Model Manager, Status)
│   ├── components/
│   │   ├── HotkeyPicker.tsx   # Record and save custom global shortcut
│   │   └── ModelManager.tsx   # List, Download (with progress), Select, Delete models
│   └── lib/
│       └── tauri.ts           # Typed wrappers for Tauri invoke() calls
└── src-tauri/
    ├── tauri.conf.json        # Window hidden by default, system tray enabled
    ├── capabilities/default.json
    └── src/
        ├── main.rs
        ├── lib.rs             # Tauri app setup, tray menu, plugin init
        ├── audio.rs           # cpal mic capture -> 16kHz mono f32 Vec
        ├── transcriber.rs     # whisper-rs model loading & inference
        ├── models.rs          # Model catalog, HF download stream, local delete
        ├── injector.rs        # Clipboard backup -> write -> Ctrl+V -> restore
        └── state.rs           # AppState (Mutex-wrapped audio buffer, loaded model)
```
````

---

## Free Local Whisper Model Catalog (Hardcode in `models.rs`)

All models are fetched from `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/` and saved to `{app_data_dir}/models/`:

1. `ggml-tiny.en.bin` (~75 MB) — Fastest, good for quick commands
2. `ggml-base.en.bin` (~142 MB) — Balanced speed & accuracy (Recommended default)
3. `ggml-small.en.bin` (~466 MB) — High accuracy for technical/coding terms
4. `ggml-large-v3-turbo-q5_0.bin` (~547 MB) — Best multilingual/accent accuracy (quantized)

---

## Step-by-Step Execution Plan

### Phase 1: Tauri v2 Scaffold & System Tray Shell

1. Initialize a Tauri v2 + React + TypeScript + Tailwind project.
2. Configure `tauri.conf.json` so the main window (`"settings"`) starts **hidden** (`visible: false`, `width: 480`, `height: 600`, `resizable: false`).
3. Implement the Windows System Tray in `src-tauri/src/lib.rs`:

- Left-click or Tray Menu **"Settings"**: shows and focuses the Settings window.
- Tray Menu **"Quit"**: exits the app cleanly.
- Closing the Settings window (`CloseRequested` event) must **hide** the window instead of exiting the app.

4. **Verification:** App launches silently to the Windows System Tray, opens Settings on click, and hides to tray when closed.

### Phase 2: Model Manager (Download, List, Select, Delete)

1. In `src-tauri/src/models.rs`, define the 4 models above and implement Tauri commands:

- `list_models()` -> returns each model's `id`, `name`, `size_mb`, `is_downloaded`, `is_active`.
- `download_model(model_id)` -> streams from Hugging Face to `{app_data_dir}/models/{filename}`, emitting `model-download-progress` events (`{ model_id, percent }`) to the frontend. Write to a `.tmp` file first and rename on completion to prevent corrupted files.
- `delete_model(model_id)` -> deletes the local `.bin` file from disk.
- `set_active_model(model_id)` -> saves to `tauri-plugin-store` and updates `AppState`.

2. Build `ModelManager.tsx` with clean Download / Progress Bar / Select / Delete buttons.
3. **Verification:** User can download `ggml-tiny.en.bin`, see progress, select it, and delete it.

### Phase 3: Audio Capture (`cpal`)

1. In `src-tauri/src/audio.rs`, implement `start_recording()` and `stop_recording() -> Vec<f32>`.
2. Capture from the default Windows input device.
3. Downmix to mono and resample to **16,000 Hz `f32` PCM** (exact format required by `whisper.cpp`).
4. Add a temporary "Test Mic (3s)" button in Settings to verify non-empty audio samples are captured.
5. **Verification:** Recording captures clean 16kHz PCM audio without crashing or blocking the UI thread.

### Phase 4: Local Transcription (`whisper-rs`)

1. In `src-tauri/src/transcriber.rs`, load the active `.bin` model into memory using `WhisperContext::new_with_params` (keep it cached in `AppState` so it doesn't reload on every shortcut press; only reload when the user switches models).
2. Implement `transcribe(samples: Vec<f32>) -> Result<String, String>` running on a background thread (`tokio::task::spawn_blocking`) so the app never freezes.
3. Trim whitespace and filter out common Whisper hallucination tokens like `[BLANK_AUDIO]`.
4. **Verification:** Audio captured in Phase 3 prints accurate transcribed text to the Rust console.

### Phase 5: Global Push-to-Talk Shortcut & Text Injection

1. In `src-tauri/src/injector.rs`, implement `inject_text(text: &str)`:

- Save current clipboard text via `arboard`.
- Write `text` to clipboard.
- Wait 30ms, then simulate `Ctrl+V` using `enigo`.
- Wait 100ms, then restore the original clipboard text.

2. Register `tauri-plugin-global-shortcut` with a default shortcut (e.g., `Ctrl+Space` or `Alt+Space`) and make it configurable via `HotkeyPicker.tsx` (persisted in `tauri-plugin-store`).
3. Wire the full pipeline:

- `ShortcutState::Pressed` -> `start_recording()` (and update tray tooltip to "Pulse: Listening...")
- `ShortcutState::Released` -> `stop_recording()` -> `transcribe()` -> `inject_text()` (reset tray tooltip to "Pulse: Ready").

4. **Verification:** Open Notepad or VS Code, hold the shortcut, speak, release, and confirm text is pasted directly at the cursor.

### Phase 6: Polish & Windows Build

1. Add a "Launch at Windows Startup" toggle using `tauri-plugin-autostart` (optional, simple checkbox in Settings).
2. Add a subtle sound cue or tray icon state change when recording starts/stops.
3. Run `npm run tauri build` to produce the standalone Windows `.exe`/`.msi` installer.

---

**Start now with Phase 1 ONLY. Do not write code for Phase 2 yet.**

```

### One Quick Tip for Windows + `whisper-rs`
Because `whisper-rs` compiles C++ code via `cmake` and `clang`/`LLVM`, make sure you have **CMake** and **LLVM (Clang)** installed on Windows before the agent hits Phase 4 (a quick `winget install Kitware.CMake LLVM.LLVM` in PowerShell handles it). If you want GPU acceleration later, you only need to add `features = ["cuda"]` to `whisper-rs` in `Cargo.toml`—the rest of the Rust code stays identical.
