# Pulse

Website: [pulse.filekitstudio.com](https://pulse.filekitstudio.com)

Pulse is a local, zero-cloud speech-to-text dictation application for Windows 10 and 11. It runs natively using a Rust backend and Tauri, capturing audio directly from your microphone and injecting transcribed text into whatever text field or editor currently has focus.

All transcription and optional language model post-processing run entirely on your local machine. No audio data, text, or telemetry is transmitted across the network.

---

## Core Features

- **Local Speech Engines:** Uses on-device models via ONNX Runtime and whisper.cpp. Supports NVIDIA Parakeet TDT for sub-200ms real-time dictation, alongside OpenAI Whisper (Tiny, Base, Small) for multilingual transcription.
- **System-Wide Push-to-Talk:** Global hotkey listener works in any application (VS Code, terminal, Slack, Obsidian, browsers) without stealing window focus.
- **Two Interaction Modes:**
  - **Hold (Push-to-Talk):** Hold the hotkey while speaking; transcription and paste execute immediately upon key release.
  - **Toggle (Hands-Free):** Tap once to record with a live floating waveform preview; tap again to transcribe and paste.
- **Direct Cursor Injection:** Uses synthesized input events to paste text at your cursor position, restoring previous clipboard contents so your clipboard history remains intact.
- **Local AI Post-Processing:** Secondary hotkey triggers an automated LLM cleanup pipeline powered by local Ollama. Formats bulleted lists, fixes grammar, removes spoken filler words ("um", "uh"), and applies structured change logs.
- **Model Pre-Warming:** When the post-processing hotkey is pressed, Pulse signals local Ollama to preload the model into VRAM in the background while you speak, eliminating cold-start response latency.
- **System Tray Integration:** Runs quietly in the background with an idle memory footprint of approximately 10 MB. Offers quick actions such as copying the most recent transcription and toggling launch at Windows startup.
- **Local History and Diagnostics:** Stores up to 30 past transcriptions locally. Includes a built-in microphone level tester and a test prompt runner with latency measurements.

---

## Architecture

Pulse is organized into a lightweight Tauri frontend and a native Rust backend:

```text
pulse/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs          # Application entry point
│   │   ├── lib.rs           # Tauri setup, system tray, window management
│   │   ├── audio.rs         # CPAL microphone capture and WAV buffering
│   │   ├── transcriber.rs   # Whisper.cpp and Parakeet inference pipelines
│   │   ├── injector.rs      # Windows SendInput and clipboard injection
│   │   ├── shortcuts.rs     # Low-level Windows global hotkey handling
│   │   ├── postprocess.rs   # Ollama API client and model pre-warming
│   │   ├── models.rs        # Hugging Face model downloads and verification
│   │   ├── history.rs       # Local transcription persistence
│   │   └── state.rs         # Thread-safe global application state
│   ├── Cargo.toml           # Rust dependencies and release profiles
│   └── tauri.conf.json      # Window capabilities, bundle metadata, icons
├── src/
│   ├── components/          # React interface (Settings, Diagnostics, Models)
│   ├── lib/                 # Tauri IPC command wrappers and theme state
│   ├── App.tsx              # Settings window shell and tab navigation
│   └── main.tsx             # Frontend mount point
└── package.json
```

---

## Supported Speech Models

| Model | Architecture | Size | Target Latency | Best Used For |
| :--- | :--- | :--- | :--- | :--- |
| **Parakeet TDT** | FastConformer RNN-T | ~600 MB | ~180 ms | Daily English dictation, short commands, coding |
| **Whisper Tiny** | Encoder-Decoder | ~75 MB | ~150 ms | Low-spec hardware, simple punctuation |
| **Whisper Base** | Encoder-Decoder | ~145 MB | ~250 ms | General balance of accuracy and speed |
| **Whisper Small** | Encoder-Decoder | ~480 MB | ~380 ms | High accuracy, complex terminology, multi-language |

Models are downloaded directly from official repositories into `%LOCALAPPDATA%\pulse\models` and cached for offline use.

---

## Post-Processing (Ollama)

When using the dedicated post-processing hotkey (`Ctrl + Shift + Space` by default), raw audio transcription is passed through a local LLM before injection.

- **Default Endpoint:** `http://localhost:11434/v1` (native Ollama OpenAI-compatible endpoint)
- **Supported Models:** Any model installed in your local Ollama instance (such as `qwen2.5:1.5b`, `llama3.2:1b`, `mistral`, or `phi3`).
- **Prompt Presets:**
  - **Smart Clean:** Fixes capitalization and punctuation, removes fillers, and converts list requests into formatted markdown bullets.
  - **Developer Changes:** Structures conversational changes into clear, technical modification lists.
  - **Custom:** Define custom prompt instructions using the `${output}` variable.
- **Pre-Warming:** Pulse dispatches an asynchronous `keep_alive` call to Ollama the instant audio recording begins. The model is resident in VRAM by the time dictation finishes.

---

## Requirements

- **Operating System:** Windows 10 or Windows 11 (64-bit)
- **Microphone:** Any standard input device recognized by Windows
- **Optional for Post-Processing:** [Ollama](https://ollama.com/) running locally with at least one model pulled (`ollama pull qwen2.5:1.5b`)

---

## Building from Source

### Prerequisites

1. **Rust Toolchain:** Install Rust via [rustup](https://rustup.rs/) using the `stable-x86_64-pc-windows-msvc` target.
2. **Node.js:** Version 18 or newer with npm.
3. **C++ Build Tools:** Visual Studio 2022 Community with the "Desktop development with C++" workload (includes MSVC and CMake).
4. **LLVM / Clang:** Required by bindgen for native library compilation. Install LLVM and set the environment variable:
   ```powershell
   $env:LIBCLANG_PATH = "C:\Program Files\LLVM\bin"
   ```

### Development

Clone the repository and install frontend dependencies:

```bash
git clone https://github.com/Kanad-Shee/pulse.git
cd pulse
npm install
```

Run the application in development mode with hot reload:

```bash
npm run tauri dev
```

### Production Build

To compile an optimized release executable and generate installers (NSIS `.exe` and WiX `.msi`):

```powershell
$env:LIBCLANG_PATH = "C:\Program Files\LLVM\bin"
npm run tauri build
```

Generated packages will be located in:
- Setup Installer: `src-tauri/target/release/bundle/nsis/Pulse_1.0.0_x64-setup.exe`
- Enterprise MSI: `src-tauri/target/release/bundle/msi/Pulse_1.0.0_x64_en-US.msi`
- Standalone Binary: `src-tauri/target/release/pulse.exe`

---

## Privacy Policy

Pulse is strictly local software:
- Audio buffers are held in volatile RAM only for the duration of the dictation session and cleared after inference.
- Transcriptions are stored exclusively on your local disk in `%LOCALAPPDATA%\pulse`.
- The application makes no telemetry calls, analytics requests, or remote tracking pings.
- Internet access is used only when explicitly requesting model downloads from Hugging Face or checking for GitHub releases.

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
