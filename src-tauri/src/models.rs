use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_store::StoreExt;
use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;
use crate::state::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelEngine {
    Whisper,
    Parakeet,
}

#[derive(Debug, Clone)]
pub struct CatalogItem {
    pub id: &'static str,
    pub name: &'static str,
    pub filename: &'static str,
    pub size_mb: u32,
    pub engine: ModelEngine,
    pub description: &'static str,
    pub download_url: &'static str,
    pub is_recommended: bool,
}

pub const CATALOG: &[CatalogItem] = &[
    CatalogItem {
        id: "parakeet-tdt-0.6b-v3",
        name: "NVIDIA Parakeet TDT 0.6B (v3)",
        filename: "parakeet-v3-int8",
        size_mb: 650,
        engine: ModelEngine::Parakeet,
        description: "Fastest & most accurate (~650 MB, Recommended)",
        download_url: "https://blob.handy.computer/parakeet-v3-int8.tar.gz",
        is_recommended: true,
    },
    CatalogItem {
        id: "ggml-tiny.en.bin",
        name: "Whisper Tiny (English)",
        filename: "ggml-tiny.en.bin",
        size_mb: 75,
        engine: ModelEngine::Whisper,
        description: "Fastest (~75 MB), good for quick commands",
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
        is_recommended: false,
    },
    CatalogItem {
        id: "ggml-base.en.bin",
        name: "Whisper Base (English)",
        filename: "ggml-base.en.bin",
        size_mb: 142,
        engine: ModelEngine::Whisper,
        description: "Balanced speed & accuracy (~142 MB)",
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
        is_recommended: false,
    },
    CatalogItem {
        id: "ggml-small.en.bin",
        name: "Whisper Small (English)",
        filename: "ggml-small.en.bin",
        size_mb: 466,
        engine: ModelEngine::Whisper,
        description: "High accuracy (~466 MB) for technical/coding terms",
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
        is_recommended: false,
    },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub size_mb: u32,
    pub is_downloaded: bool,
    pub is_active: bool,
    pub description: String,
    pub engine: ModelEngine,
    pub is_recommended: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgressPayload {
    pub model_id: String,
    pub percent: f64,
}

pub fn get_models_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let models_dir = app_data.join("models");
    if !models_dir.exists() {
        std::fs::create_dir_all(&models_dir).map_err(|e| e.to_string())?;
    }
    Ok(models_dir)
}

pub fn find_parakeet_dir(base_dir: &Path) -> Option<PathBuf> {
    if base_dir.join("vocab.txt").exists() {
        return Some(base_dir.to_path_buf());
    }
    if let Ok(entries) = std::fs::read_dir(base_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join("vocab.txt").exists() {
                return Some(path);
            }
        }
    }
    None
}

pub fn is_model_downloaded(item: &CatalogItem, models_dir: &Path) -> bool {
    match item.engine {
        ModelEngine::Parakeet => {
            let target_dir = models_dir.join(item.filename);
            target_dir.is_dir() && find_parakeet_dir(&target_dir).is_some()
        }
        ModelEngine::Whisper => {
            let target_file = models_dir.join(item.filename);
            target_file.is_file()
                && target_file.metadata().map(|m| m.len() > 0).unwrap_or(false)
        }
    }
}

#[tauri::command]
pub async fn list_models<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<Vec<ModelInfo>, String> {
    let models_dir = get_models_dir(&app)?;
    let active_id = {
        let guard = state.active_model_id.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    let mut result = Vec::new();
    for item in CATALOG {
        let is_downloaded = is_model_downloaded(item, &models_dir);
        let is_active = item.id == active_id;

        result.push(ModelInfo {
            id: item.id.to_string(),
            name: item.name.to_string(),
            filename: item.filename.to_string(),
            size_mb: item.size_mb,
            is_downloaded,
            is_active,
            description: item.description.to_string(),
            engine: item.engine,
            is_recommended: item.is_recommended,
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn download_model<R: Runtime>(
    app: AppHandle<R>,
    model_id: String,
) -> Result<(), String> {
    let target_item = CATALOG
        .iter()
        .find(|item| item.id == model_id)
        .ok_or_else(|| format!("Unknown model ID: {}", model_id))?;

    let url = target_item.download_url;
    let expected_size_bytes = (target_item.size_mb as u64) * 1024 * 1024;
    let models_dir = get_models_dir(&app)?;

    let is_tar_gz = url.ends_with(".tar.gz");
    let (target_path, tmp_path) = if is_tar_gz {
        (
            models_dir.join(format!("{}.tar.gz", target_item.filename)),
            models_dir.join(format!("{}.tar.gz.tmp", target_item.filename)),
        )
    } else {
        (
            models_dir.join(target_item.filename),
            models_dir.join(format!("{}.tmp", target_item.filename)),
        )
    };

    let client = reqwest::Client::builder()
        .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
        .http1_only()
        .user_agent("Pulse-App/1.0")
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("{:?}", e))?;

    // 1. Transient Windows DNS Error fix: Retry loop up to 3 attempts with 1.5s delay
    let mut response = None;
    let mut last_err = String::new();
    for attempt in 1..=3 {
        match client.get(url).send().await {
            Ok(res) if res.status().is_success() => {
                response = Some(res);
                break;
            }
            Ok(res) => {
                last_err = format!("Server returned status: {}", res.status());
            }
            Err(e) => {
                last_err = format!("{:?}", e);
            }
        }
        if attempt < 3 {
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        }
    }

    let response = response.ok_or_else(|| {
        format!("Download failed after 3 attempts. Last error: {}", last_err)
    })?;

    let total_size = response.content_length().unwrap_or(expected_size_bytes);

    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| format!("Failed to create temporary file: {}", e))?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_reported_percent: i64 = -1;

    let _ = app.emit(
        "model-download-progress",
        DownloadProgressPayload {
            model_id: model_id.clone(),
            percent: 0.0,
        },
    );

    while let Some(chunk_res) = stream.next().await {
        let chunk = match chunk_res {
            Ok(c) => c,
            Err(e) => {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                return Err(format!("Error while streaming download: {:?}", e));
            }
        };

        if let Err(e) = file.write_all(&chunk).await {
            let _ = tokio::fs::remove_file(&tmp_path).await;
            return Err(format!("Failed to write to temporary file: {}", e));
        }

        downloaded += chunk.len() as u64;
        let percent = (downloaded as f64 / total_size as f64) * 100.0;
        let current_percent_int = percent.floor() as i64;

        if current_percent_int > last_reported_percent {
            last_reported_percent = current_percent_int;
            let _ = app.emit(
                "model-download-progress",
                DownloadProgressPayload {
                    model_id: model_id.clone(),
                    percent,
                },
            );
        }
    }

    if let Err(e) = file.flush().await {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(format!("Failed to flush temporary file: {}", e));
    }
    drop(file);

    // Atomically rename .tmp to destination
    if let Err(e) = tokio::fs::rename(&tmp_path, &target_path).await {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(format!("Failed to rename temporary file: {}", e));
    }

    // If Parakeet .tar.gz, unpack it into models/parakeet-v3-int8/ and remove archive
    if is_tar_gz && target_item.engine == ModelEngine::Parakeet {
        let extract_dir = models_dir.join(target_item.filename);
        if !extract_dir.exists() {
            tokio::fs::create_dir_all(&extract_dir)
                .await
                .map_err(|e| format!("Failed to create extract directory: {}", e))?;
        }

        let archive_path = target_path.clone();
        let target_extract_dir = extract_dir.clone();

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let tar_gz_file = std::fs::File::open(&archive_path)
                .map_err(|e| format!("Failed to open tar.gz archive: {}", e))?;
            let tar = flate2::read::GzDecoder::new(tar_gz_file);
            let mut archive = tar::Archive::new(tar);
            archive
                .unpack(&target_extract_dir)
                .map_err(|e| format!("Failed to unpack tar.gz archive: {}", e))?;
            let _ = std::fs::remove_file(&archive_path);
            Ok(())
        })
        .await
        .map_err(|e| format!("Extraction task panicked: {}", e))??;
    }

    // Emit 100% completion
    let _ = app.emit(
        "model-download-progress",
        DownloadProgressPayload {
            model_id: model_id.clone(),
            percent: 100.0,
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn delete_model<R: Runtime>(
    app: AppHandle<R>,
    model_id: String,
) -> Result<(), String> {
    let target_item = CATALOG
        .iter()
        .find(|item| item.id == model_id)
        .ok_or_else(|| format!("Unknown model ID: {}", model_id))?;

    let models_dir = get_models_dir(&app)?;

    match target_item.engine {
        ModelEngine::Parakeet => {
            let target_dir = models_dir.join(target_item.filename);
            if target_dir.exists() {
                tokio::fs::remove_dir_all(&target_dir)
                    .await
                    .map_err(|e| format!("Failed to delete Parakeet directory: {}", e))?;
            }
            let archive = models_dir.join(format!("{}.tar.gz", target_item.filename));
            if archive.exists() {
                let _ = tokio::fs::remove_file(&archive).await;
            }
            let archive_tmp = models_dir.join(format!("{}.tar.gz.tmp", target_item.filename));
            if archive_tmp.exists() {
                let _ = tokio::fs::remove_file(&archive_tmp).await;
            }
        }
        ModelEngine::Whisper => {
            let target_file = models_dir.join(target_item.filename);
            let tmp_file = models_dir.join(format!("{}.tmp", target_item.filename));
            if target_file.exists() {
                tokio::fs::remove_file(&target_file)
                    .await
                    .map_err(|e| format!("Failed to delete model file: {}", e))?;
            }
            if tmp_file.exists() {
                let _ = tokio::fs::remove_file(&tmp_file).await;
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn set_active_model<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    model_id: String,
) -> Result<(), String> {
    let target_item = CATALOG
        .iter()
        .find(|item| item.id == model_id)
        .ok_or_else(|| format!("Unknown model ID: {}", model_id))?;

    let models_dir = get_models_dir(&app)?;

    if !is_model_downloaded(target_item, &models_dir) {
        return Err("Cannot activate a model that has not been downloaded yet".to_string());
    }

    // 1. Update AppState
    {
        let mut guard = state.active_model_id.lock().map_err(|e| e.to_string())?;
        *guard = model_id.clone();
    }

    // 2. Persist to tauri-plugin-store
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    store.set("active_model", serde_json::json!(model_id));
    store.save().map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_catalog_definitions() {
        assert_eq!(CATALOG.len(), 4);
        assert_eq!(CATALOG[0].id, "parakeet-tdt-0.6b-v3");
        assert_eq!(CATALOG[0].engine, ModelEngine::Parakeet);
        assert_eq!(CATALOG[1].id, "ggml-tiny.en.bin");
        assert_eq!(CATALOG[2].id, "ggml-base.en.bin");
        assert_eq!(CATALOG[3].id, "ggml-small.en.bin");
    }
}
