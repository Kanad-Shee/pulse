use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;
use crate::state::AppState;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PromptPreset {
    pub id: String,
    pub label: String,
    pub instructions: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PostProcessConfig {
    pub hotkey: String,
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub selected_prompt_id: String,
    pub prompts: Vec<PromptPreset>,
}

pub fn default_coding_tasks_instructions() -> String {
    r#"You are an expert software developer and prompt engineer. Your job is to transform spoken coding instructions into a clean, well-structured, professional task prompt for an AI coding assistant.

Rules:
1. Fix grammar, punctuation, and capitalization. Preserve technical terms, file paths, extensions, and code identifiers (camelCase, snake_case, PascalCase, `Result<T>`, `.tsx`, etc.).
2. Clearly separate the overall goal or context statement from the specific changes requested.
3. Format each requested change as a clear, actionable markdown bullet point (- ).
4. Leave an empty line between the summary heading and the bullet list for clean readability.
5. Output ONLY the final formatted prompt. Never reply to the prompt, never chat, and never include explanations or commentary.

Example 1:
Input: "in the auth flow I want to do some changes first remove cookie validation and second add jwt bearer token check and also log the user id and return 401 when token expires"
Output:
Please implement the following changes in the authentication flow:

- Remove cookie validation.
- Add JWT Bearer token authentication.
- Log the `userId` on incoming requests.
- Return HTTP 401 Unauthorized when the token expires.

Example 2:
Input: "can you fix the profile screen change the button color to indigo and add an avatar with fallback initials"
Output:
Please update the profile screen with these changes:

- Change the button color to indigo.
- Add an avatar image display with fallback initials.

Example 3:
Input: "we need to prevent duplicate submissions when clicking the save button multiple times"
Output:
Please address the duplicate submission issue:

- Prevent multiple API requests when the save button is clicked repeatedly (e.g., disable button while saving is in progress)."#.to_string()
}

pub fn default_smart_clean_instructions() -> String {
    r#"You are a strict dictation formatter. Output ONLY the formatted text. Never chat, never explain, never answer questions.
Rules:
- Fix grammar, capitalization, and punctuation. Remove filler words (um, uh, like).
- Whenever the user asks to make a list or lists items, output a short heading with a colon, a newline, and markdown bullets (- ).
Example 1:
Input: "I want you to make a list of apple, banana and orange."
Output:
List:
- Apple
- Banana
- Orange
Example 2:
Input: "uhh can you check if the server is running"
Output:
Can you check if the server is running?"#.to_string()
}

impl Default for PostProcessConfig {
    fn default() -> Self {
        Self {
            hotkey: "Ctrl+Shift+Space".to_string(),
            provider: "ollama".to_string(),
            base_url: "http://localhost:11434/v1".to_string(),
            api_key: "".to_string(),
            model: "qwen2.5:1.5b".to_string(),
            selected_prompt_id: "coding_tasks".to_string(),
            prompts: vec![
                PromptPreset {
                    id: "coding_tasks".to_string(),
                    label: "Coding Tasks & Changes".to_string(),
                    instructions: default_coding_tasks_instructions(),
                },
                PromptPreset {
                    id: "smart_clean".to_string(),
                    label: "Improve Transcriptions".to_string(),
                    instructions: default_smart_clean_instructions(),
                },
                PromptPreset {
                    id: "dev_prompt".to_string(),
                    label: "Raw Coding Prompt".to_string(),
                    instructions: r#"Clean up this spoken coding prompt for an AI coding assistant. Fix grammar, preserve exact technical terms/file names/syntax, structure multi-step requirements as clear bullet points, and return ONLY the cleaned prompt.

Transcript:
${output}"#.to_string(),
                },
            ],
        }
    }
}

fn normalize_base_url(base_url: &str) -> String {
    let clean = base_url.trim().trim_end_matches('/');
    if clean.starts_with("http://localhost:") {
        clean.replacen("http://localhost:", "http://127.0.0.1:", 1)
    } else if clean.starts_with("https://localhost:") {
        clean.replacen("https://localhost:", "https://127.0.0.1:", 1)
    } else {
        clean.to_string()
    }
}

#[derive(Deserialize)]
struct ModelItem {
    id: String,
}

#[derive(Deserialize)]
struct ModelsResponse {
    #[serde(default)]
    data: Vec<ModelItem>,
}

#[tauri::command]
pub async fn fetch_postprocess_models(
    base_url: String,
    api_key: String,
) -> Result<Vec<String>, String> {
    let normalized = normalize_base_url(&base_url);
    let url = format!("{}/models", normalized);

    let client = reqwest::Client::builder()
        .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let mut req = client.get(&url);
    if !api_key.trim().is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key.trim()));
    } else {
        req = req.header("Authorization", "Bearer ollama");
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Failed to connect to '{url}': {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Server returned HTTP {}", resp.status()));
    }

    let parsed = resp
        .json::<ModelsResponse>()
        .await
        .map_err(|e| format!("Failed to parse models response: {e}"))?;

    let mut model_ids: Vec<String> = parsed.data.into_iter().map(|m| m.id).collect();
    model_ids.sort();
    Ok(model_ids)
}

#[derive(Serialize)]
struct PrewarmRequest {
    model: String,
    keep_alive: String,
}

pub async fn prewarm_ollama(config: &PostProcessConfig) {
    let is_ollama = config.provider == "ollama" || config.base_url.contains("11434");
    if !is_ollama {
        return;
    }

    let clean = config.base_url.trim();
    let normalized = if clean.starts_with("http://localhost:") {
        clean.replacen("http://localhost:", "http://127.0.0.1:", 1)
    } else if clean.starts_with("https://localhost:") {
        clean.replacen("https://localhost:", "https://127.0.0.1:", 1)
    } else {
        clean.to_string()
    };

    let base = normalized.trim_end_matches('/');
    let host_base = if base.ends_with("/v1") {
        base.trim_end_matches("/v1").trim_end_matches('/')
    } else {
        base
    };

    let generate_url = format!("{}/api/generate", host_base);
    println!(
        "[PreWarm] Pre-warming Ollama model '{}' via {}",
        config.model, generate_url
    );

    let client = match reqwest::Client::builder()
        .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[PreWarm] Failed to build client: {e:?}");
            return;
        }
    };

    let body = PrewarmRequest {
        model: config.model.clone(),
        keep_alive: "15m".to_string(),
    };

    let mut req = client.post(&generate_url).json(&body);
    if !config.api_key.trim().is_empty() {
        req = req.header("Authorization", format!("Bearer {}", config.api_key.trim()));
    }

    match req.send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                println!(
                    "[PreWarm] Successfully loaded model '{}' into memory (keep_alive: 15m)",
                    config.model
                );
            } else {
                eprintln!(
                    "[PreWarm] Endpoint returned status {}: skipping prewarm",
                    resp.status()
                );
            }
        }
        Err(e) => {
            eprintln!("[PreWarm] Pre-warm connection failed (Ollama may be offline): {e:?}");
        }
    }
}

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
}

#[derive(Deserialize)]
struct ChatChoiceMessage {
    content: Option<String>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatChoiceMessage,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    #[serde(default)]
    choices: Vec<ChatChoice>,
}

pub async fn execute_postprocess(raw_text: &str, config: &PostProcessConfig) -> Result<String, String> {
    if raw_text.trim().is_empty() {
        return Ok(String::new());
    }

    let preset = config
        .prompts
        .iter()
        .find(|p| p.id == config.selected_prompt_id)
        .or_else(|| config.prompts.first())
        .ok_or_else(|| "No prompt preset configured".to_string())?;

    let normalized_base = normalize_base_url(&config.base_url);
    let url = format!("{}/chat/completions", normalized_base);

    println!(
        "[PostProcess] Executing request -> URL: {}, Model: '{}', Prompt Preset: '{}'",
        url, config.model, preset.label
    );
    println!("[PostProcess] Raw Transcript: {:?}", raw_text);

    let messages = if preset.instructions.contains("${output}") {
        vec![
            ChatMessage {
                role: "system".to_string(),
                content: "You are a strict dictation formatter. Output ONLY the formatted text. Never chat, never explain, never answer questions.".to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: preset.instructions.replace("${output}", raw_text),
            },
        ]
    } else {
        vec![
            ChatMessage {
                role: "system".to_string(),
                content: preset.instructions.trim().to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: raw_text.trim().to_string(),
            },
        ]
    };

    let client = reqwest::Client::builder()
        .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP Client build failed: {e}"))?;

    let req_body = ChatCompletionRequest {
        model: config.model.clone(),
        messages,
        temperature: 0.1,
    };

    let mut req = client.post(&url).json(&req_body);
    if !config.api_key.trim().is_empty() {
        req = req.header("Authorization", format!("Bearer {}", config.api_key.trim()));
    } else {
        req = req.header("Authorization", "Bearer ollama");
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Connection to '{}' failed: {e:?}", url))?;

    let status = resp.status();
    println!("[PostProcess] HTTP Status Code: {}", status);

    if !status.is_success() {
        let err_body = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama error (HTTP {}): {}", status, err_body));
    }

    let data = resp
        .json::<ChatCompletionResponse>()
        .await
        .map_err(|e| format!("Failed to parse JSON response: {e:?}"))?;

    if let Some(first) = data.choices.into_iter().next() {
        if let Some(content) = first.message.content {
            let trimmed = content.trim().trim_matches('"').trim();
            if !trimmed.is_empty() {
                println!("[PostProcess] Cleaned Output: {:?}", trimmed);
                return Ok(trimmed.to_string());
            }
        }
    }

    Err("Model returned empty or missing completion choice".to_string())
}

pub async fn run_postprocess(raw_text: &str, config: &PostProcessConfig) -> String {
    match execute_postprocess(raw_text, config).await {
        Ok(polished) => polished,
        Err(err) => {
            eprintln!("[PostProcess] Error: {:?}. Falling back to raw text.", err);
            raw_text.to_string()
        }
    }
}

#[tauri::command]
pub async fn test_postprocess(
    state: State<'_, AppState>,
    sample_text: String,
) -> Result<String, String> {
    let config = {
        let guard = state.postprocess_config.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    execute_postprocess(&sample_text, &config).await
}

#[tauri::command]
pub fn get_postprocess_config(
    state: State<'_, AppState>,
) -> Result<PostProcessConfig, String> {
    let guard = state.postprocess_config.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
pub fn save_postprocess_config(
    app: AppHandle,
    state: State<'_, AppState>,
    config: PostProcessConfig,
) -> Result<(), String> {
    {
        let mut guard = state.postprocess_config.lock().map_err(|e| e.to_string())?;
        *guard = config.clone();
    }

    if let Ok(store) = app.store("settings.json") {
        if let Ok(val) = serde_json::to_value(&config) {
            store.set("postprocess", val);
            let _ = store.save();
        }
    }

    crate::shortcuts::reregister_all_shortcuts(&app, &state)?;
    Ok(())
}

#[tauri::command]
pub fn set_postprocess_hotkey(
    app: AppHandle,
    state: State<'_, AppState>,
    hotkey: String,
) -> Result<String, String> {
    {
        let mut guard = state.postprocess_config.lock().map_err(|e| e.to_string())?;
        guard.hotkey = hotkey.clone();

        if let Ok(store) = app.store("settings.json") {
            if let Ok(val) = serde_json::to_value(&*guard) {
                store.set("postprocess", val);
                let _ = store.save();
            }
        }
    }

    crate::shortcuts::reregister_all_shortcuts(&app, &state)?;
    Ok(hotkey)
}
