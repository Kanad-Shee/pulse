import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ModelEngine = "whisper" | "parakeet";

export interface ModelInfo {
  id: string;
  name: string;
  filename: string;
  size_mb: number;
  is_downloaded: boolean;
  is_active: boolean;
  description: string;
  engine: ModelEngine;
  is_recommended: boolean;
}

export interface DownloadProgressPayload {
  model_id: string;
  percent: number;
}

export interface MicTestResult {
  sample_count: number;
  duration_secs: number;
  peak_amplitude: number;
  rms_amplitude: number;
}

export interface TranscribeResult {
  transcript: string;
  duration_secs: number;
  sample_count: number;
}

export async function listModels(): Promise<ModelInfo[]> {
  return await invoke<ModelInfo[]>("list_models");
}

export async function downloadModel(modelId: string): Promise<void> {
  return await invoke<void>("download_model", { modelId });
}

export async function deleteModel(modelId: string): Promise<void> {
  return await invoke<void>("delete_model", { modelId });
}

export async function setActiveModel(modelId: string): Promise<void> {
  return await invoke<void>("set_active_model", { modelId });
}

export async function onDownloadProgress(
  callback: (payload: DownloadProgressPayload) => void
): Promise<UnlistenFn> {
  return await listen<DownloadProgressPayload>("model-download-progress", (event) => {
    callback(event.payload);
  });
}

export async function startRecording(): Promise<void> {
  return await invoke<void>("start_recording");
}

export async function stopRecording(): Promise<number[]> {
  return await invoke<number[]>("stop_recording");
}

export async function testMicrophone(): Promise<MicTestResult> {
  return await invoke<MicTestResult>("test_microphone");
}

export async function transcribeAudio(samples: number[]): Promise<string> {
  return await invoke<string>("transcribe_audio", { samples });
}

export async function testTranscribe(): Promise<TranscribeResult> {
  return await invoke<TranscribeResult>("test_transcribe");
}

export interface OverlayStatePayload {
  status: "listening" | "transcribing" | "polishing" | "idle";
}

export interface OverlayPreviewPayload {
  text: string;
}

export type ShortcutMode = "hold" | "toggle";

export async function getShortcut(): Promise<string> {
  return await invoke<string>("get_shortcut");
}

export async function setShortcut(shortcutStr: string): Promise<string> {
  return await invoke<string>("set_shortcut", { shortcutStr });
}

export async function getShortcutMode(): Promise<ShortcutMode> {
  return await invoke<ShortcutMode>("get_shortcut_mode");
}

export async function setShortcutMode(mode: ShortcutMode): Promise<ShortcutMode> {
  return await invoke<ShortcutMode>("set_shortcut_mode", { mode });
}

export async function cancelRecording(): Promise<void> {
  return await invoke<void>("cancel_recording");
}

export async function onAudioLevel(
  callback: (level: number) => void
): Promise<UnlistenFn> {
  return await listen<number>("audio-level", (event) => {
    callback(event.payload);
  });
}

export async function onOverlayState(
  callback: (payload: OverlayStatePayload) => void
): Promise<UnlistenFn> {
  return await listen<OverlayStatePayload>("overlay-state", (event) => {
    callback(event.payload);
  });
}

export async function onOverlayPreview(
  callback: (payload: OverlayPreviewPayload) => void
): Promise<UnlistenFn> {
  return await listen<OverlayPreviewPayload>("overlay-preview", (event) => {
    callback(event.payload);
  });
}

export interface HistoryItem {
  id: string;
  text: string;
  timestamp: number;
  model_id: string;
}

export async function getHistory(): Promise<HistoryItem[]> {
  return await invoke<HistoryItem[]>("get_history");
}

export async function deleteHistoryItem(id: string): Promise<HistoryItem[]> {
  return await invoke<HistoryItem[]>("delete_history_item", { id });
}

export async function clearHistory(): Promise<void> {
  return await invoke<void>("clear_history");
}

export async function getHistoryLimit(): Promise<number> {
  return await invoke<number>("get_history_limit");
}

export async function setHistoryLimit(limit: number): Promise<number> {
  return await invoke<number>("set_history_limit", { limit });
}

export async function onHistoryUpdated(
  callback: (items: HistoryItem[]) => void
): Promise<UnlistenFn> {
  return await listen<HistoryItem[]>("history-updated", (event) => {
    callback(event.payload);
  });
}

export interface PromptPreset {
  id: string;
  label: string;
  instructions: string;
}

export interface PostProcessConfig {
  hotkey: string;
  provider: string;
  base_url: string;
  api_key: string;
  model: string;
  selected_prompt_id: string;
  prompts: PromptPreset[];
}

export async function getPostProcessConfig(): Promise<PostProcessConfig> {
  return await invoke<PostProcessConfig>("get_postprocess_config");
}

export async function savePostProcessConfig(config: PostProcessConfig): Promise<void> {
  return await invoke<void>("save_postprocess_config", { config });
}

export async function fetchPostProcessModels(
  baseUrl: string,
  apiKey: string
): Promise<string[]> {
  return await invoke<string[]>("fetch_postprocess_models", { baseUrl, apiKey });
}

export async function setPostProcessHotkey(hotkey: string): Promise<string> {
  return await invoke<string>("set_postprocess_hotkey", { hotkey });
}

export async function testPostProcess(sampleText: string): Promise<string> {
  return await invoke<string>("test_postprocess", { sampleText });
}
