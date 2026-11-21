import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ModelEngine =
  | "whisper"
  | "parakeet"
  | "canary"
  | "nemotron"
  | "unified"
  | "multitalker"
  | "moonshine";

export interface ModelInfo {
  id: string;
  name: string;
  filename: string;
  subtitle: string;
  description: string;
  size_mb: number;
  accuracy: number;
  speed: number;
  languages: string;
  is_downloaded: boolean;
  is_active: boolean;
  engine: ModelEngine;
  is_recommended: boolean;
  is_streaming: boolean;
  streaming?: boolean;
  can_translate: boolean;
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

export async function cancelModelDownload(modelId: string): Promise<void> {
  return await invoke<void>("cancel_model_download", { modelId });
}

export async function deleteModel(modelId: string): Promise<void> {
  return await invoke<void>("delete_model", { modelId });
}

export async function openModelFolder(modelId: string): Promise<void> {
  return await invoke<void>("open_model_folder", { modelId });
}

export async function onDownloadCancelled(
  callback: (payload: { model_id: string }) => void
): Promise<UnlistenFn> {
  return await listen<{ model_id: string }>("model-download-cancelled", (event) => {
    callback(event.payload);
  });
}

export async function setActiveModel(modelId: string): Promise<void> {
  return await invoke<void>("set_active_model", { modelId });
}

export async function getCanaryLanguages(): Promise<[string, string]> {
  return await invoke<[string, string]>("get_canary_languages");
}

export async function setCanaryLanguages(source: string, target: string): Promise<void> {
  return await invoke<void>("set_canary_languages", { source, target });
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

export interface AdvancedConfig {
  start_hidden: boolean;
  overlay_mode: "live" | "minimal" | "off";
  overlay_position: "bottom" | "top";
  unload_model_minutes: number;

  paste_method: "ctrl_v" | "ctrl_shift_v" | "direct_type";
  clipboard_handling: "restore" | "keep";
  auto_submit: "off" | "enter" | "ctrl_enter";
  append_trailing_space: boolean;

  vad_enabled: boolean;
  remove_filler_words: boolean;
  custom_words: string[];

  acceleration: "auto" | "gpu" | "cpu";
  keep_mic_open: boolean;
}

export async function getAdvancedConfig(): Promise<AdvancedConfig> {
  return await invoke<AdvancedConfig>("get_advanced_config");
}

export async function saveAdvancedConfig(config: AdvancedConfig): Promise<void> {
  return await invoke<void>("save_advanced_config", { config });
}

export type OverlayTextStyle = "normal" | "italic";

export async function getOverlayTextStyle(): Promise<OverlayTextStyle> {
  return await invoke<OverlayTextStyle>("get_overlay_text_style");
}

export async function setOverlayTextStyle(style: OverlayTextStyle): Promise<OverlayTextStyle> {
  return await invoke<OverlayTextStyle>("set_overlay_text_style", { style });
}

export async function onOverlayStyleUpdated(
  callback: (payload: { style: OverlayTextStyle }) => void
): Promise<UnlistenFn> {
  return await listen<{ style: OverlayTextStyle }>("overlay-style-updated", (event) => {
    callback(event.payload);
  });
}
