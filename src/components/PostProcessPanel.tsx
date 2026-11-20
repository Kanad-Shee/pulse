import React, { useEffect, useState } from "react";
import {
  getPostProcessConfig,
  savePostProcessConfig,
  fetchPostProcessModels,
  setPostProcessHotkey,
  testPostProcess,
  type PostProcessConfig,
  type PromptPreset,
} from "../lib/tauri";
import {
  IconSparkles,
  IconKeyboard,
  IconRotate,
  IconRefresh,
  IconPlus,
  IconTrash,
  IconDeviceFloppy,
  IconCheck,
  IconAlertCircle,
  IconInfoCircle,
  IconPlayerPlay,
} from "@tabler/icons-react";

export default function PostProcessPanel() {
  const [config, setConfig] = useState<PostProcessConfig | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Hotkey recording states
  const [isRecordingHotkey, setIsRecordingHotkey] = useState<boolean>(false);
  const [tempHotkey, setTempHotkey] = useState<string>("");

  // Models state
  const [models, setModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState<boolean>(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);
  const [customModelMode, setCustomModelMode] = useState<boolean>(false);

  // Test Post-Process states
  const [testInput, setTestInput] = useState<string>(
    "in the auth flow I want to do some changes first remove cookie validation and second add jwt bearer token check and also log the user id"
  );
  const [testRunning, setTestRunning] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testLatencyMs, setTestLatencyMs] = useState<number | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Load config on mount
  useEffect(() => {
    getPostProcessConfig()
      .then((cfg) => {
        setConfig(cfg);
        setLoading(false);
        // Automatically try to fetch models if baseUrl is available
        if (cfg.base_url) {
          loadModels(cfg.base_url, cfg.api_key, cfg.model);
        }
      })
      .catch((err) => {
        setError(typeof err === "string" ? err : "Failed to load post-process config");
        setLoading(false);
      });
  }, []);

  const loadModels = async (baseUrl: string, apiKey: string, currentModel?: string) => {
    setIsFetchingModels(true);
    setModelFetchError(null);
    try {
      const fetched = await fetchPostProcessModels(baseUrl, apiKey);
      setModels(fetched);
      if (fetched.length > 0) {
        // If current model isn't in fetched list, we can let user keep it via custom mode
        if (currentModel && !fetched.includes(currentModel)) {
          setCustomModelMode(true);
        } else {
          setCustomModelMode(false);
        }
      } else {
        setCustomModelMode(true);
      }
    } catch (err) {
      setModelFetchError(typeof err === "string" ? err : "Failed to fetch models");
      setCustomModelMode(true);
    } finally {
      setIsFetchingModels(false);
    }
  };

  // Hotkey keyboard event listener
  useEffect(() => {
    if (!isRecordingHotkey) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
        const parts: string[] = [];
        if (e.ctrlKey) parts.push("Ctrl");
        if (e.altKey) parts.push("Alt");
        if (e.shiftKey) parts.push("Shift");
        if (e.metaKey) parts.push("Super");
        setTempHotkey(parts.join("+"));
        return;
      }

      if (e.key === "Escape") {
        setIsRecordingHotkey(false);
        setTempHotkey("");
        setError(null);
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      if (e.metaKey) parts.push("Super");

      let key = e.key;
      if (key === " ") key = "Space";
      else if (key.length === 1) key = key.toUpperCase();

      parts.push(key);
      const combo = parts.join("+");
      setTempHotkey(combo);

      const isFunctionKey = /^F(1[0-2]|[1-9])$/.test(key);
      const hasModifier = parts.length > 1;

      if (!hasModifier && !isFunctionKey) {
        setError("Shortcut must include a modifier key (e.g., Ctrl, Shift, Alt)");
        return;
      }

      setError(null);
      setSaving(true);

      setPostProcessHotkey(combo)
        .then((saved) => {
          if (config) {
            setConfig({ ...config, hotkey: saved });
          }
          setIsRecordingHotkey(false);
          setTempHotkey("");
        })
        .catch((err) => {
          setError(typeof err === "string" ? err : "Failed to set hotkey");
        })
        .finally(() => {
          setSaving(false);
        });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isRecordingHotkey, config]);

  const handleResetHotkey = async () => {
    try {
      setSaving(true);
      setError(null);
      const saved = await setPostProcessHotkey("Ctrl+Shift+Space");
      if (config) {
        setConfig({ ...config, hotkey: saved });
      }
      setIsRecordingHotkey(false);
      setTempHotkey("");
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to reset hotkey");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (updatedConfig?: PostProcessConfig) => {
    const toSave = updatedConfig || config;
    if (!toSave) return;
    try {
      setSaving(true);
      setError(null);
      await savePostProcessConfig(toSave);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-400">
        <IconRefresh size={20} className="animate-spin" />
      </div>
    );
  }

  // Active prompt preset
  const selectedPrompt =
    config.prompts.find((p) => p.id === config.selected_prompt_id) ||
    config.prompts[0] || {
      id: "smart_clean",
      label: "Improve Transcriptions",
      instructions: "Clean up the transcript:\n\n${output}",
    };

  const handleCreatePrompt = () => {
    const newId = `custom_${Date.now()}`;
    const newPreset: PromptPreset = {
      id: newId,
      label: "Custom Prompt",
      instructions: `Clean and format the dictation below. Return ONLY the final formatted text.\n\nTranscript:\n\${output}`,
    };
    const updated: PostProcessConfig = {
      ...config,
      selected_prompt_id: newId,
      prompts: [...config.prompts, newPreset],
    };
    setConfig(updated);
  };

  const handleDeletePrompt = (idToDelete: string) => {
    if (config.prompts.length <= 1) return;
    const remaining = config.prompts.filter((p) => p.id !== idToDelete);
    const nextSelected = remaining[0]?.id || "";
    const updated: PostProcessConfig = {
      ...config,
      selected_prompt_id: nextSelected,
      prompts: remaining,
    };
    setConfig(updated);
  };

  const handleUpdateCurrentPrompt = (field: "label" | "instructions", value: string) => {
    const updatedPrompts = config.prompts.map((p) =>
      p.id === selectedPrompt.id ? { ...p, [field]: value } : p
    );
    setConfig({ ...config, prompts: updatedPrompts });
  };

  const keyTokens = (
    isRecordingHotkey && tempHotkey ? tempHotkey : config.hotkey
  ).split("+");

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
          <IconSparkles size={18} className="text-indigo-600 dark:text-indigo-400" />
          <span>AI Post-Processing</span>
        </h2>
        <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
          Clean grammar, format lists, or convert spoken notes into polished text with local Ollama or OpenAI-compatible APIs.
        </p>
      </div>

      {/* Global Error Banner */}
      {error && (
        <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200/60 dark:border-rose-900/40 rounded-xl p-3">
          <IconAlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 1. Dedicated Hotkey Section */}
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-200/90 dark:border-zinc-800/90 shadow-xs p-4.5 space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
              Post-Processing Hotkey
            </h3>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
              Press this key anywhere to record audio and paste AI-polished text.
            </p>
          </div>

          {config.hotkey !== "Ctrl+Shift+Space" && !isRecordingHotkey && (
            <button
              onClick={handleResetHotkey}
              disabled={saving}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
            >
              <IconRotate size={12} stroke={1.75} />
              <span className="whitespace-nowrap">Reset</span>
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-zinc-900/90 border border-slate-200/80 dark:border-zinc-800 rounded-xl p-3">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">
            {keyTokens.map((token, index) => (
              <React.Fragment key={index}>
                {index > 0 && (
                  <span className="text-slate-400 dark:text-zinc-500 text-xs font-semibold">+</span>
                )}
                <kbd className="px-2.5 py-1 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-xs font-mono font-medium text-slate-700 dark:text-zinc-200 shadow-2xs whitespace-nowrap">
                  {token || "..."}
                </kbd>
              </React.Fragment>
            ))}
          </div>

          <button
            onClick={() => {
              setError(null);
              setTempHotkey("");
              setIsRecordingHotkey(!isRecordingHotkey);
            }}
            disabled={saving}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
              isRecordingHotkey
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200 border border-amber-200 dark:border-amber-800 animate-pulse"
                : "bg-indigo-50 dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-zinc-700 border border-indigo-200/60 dark:border-indigo-500/30"
            }`}
          >
            <IconKeyboard size={13} stroke={1.75} />
            <span className="whitespace-nowrap">{isRecordingHotkey ? "Press Keys (Esc to cancel)" : "Change Hotkey"}</span>
          </button>
        </div>
      </div>

      {/* 2. API Configuration (Ollama / OpenAI-Compatible) */}
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-200/90 dark:border-zinc-800/90 shadow-xs p-4.5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
            LLM Provider & Model
          </h3>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Connect to local Ollama (recommended, 100% offline) or any OpenAI-compatible endpoint.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Provider Selector */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">
              Provider
            </label>
            <select
              value={config.provider}
              onChange={(e) => {
                const prov = e.target.value;
                const newBaseUrl =
                  prov === "ollama" && !config.base_url.includes("11434")
                    ? "http://localhost:11434/v1"
                    : config.base_url;
                const updated = { ...config, provider: prov, base_url: newBaseUrl };
                setConfig(updated);
                loadModels(newBaseUrl, updated.api_key, updated.model);
              }}
              className="w-full bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 cursor-pointer"
            >
              <option value="ollama">Ollama (Local)</option>
              <option value="custom">Custom (OpenAI-Compatible)</option>
            </select>
          </div>

          {/* Model Selector / Custom Input */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                Model Name
              </label>
              <button
                type="button"
                onClick={() => setCustomModelMode(!customModelMode)}
                className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer shrink-0 whitespace-nowrap"
              >
                <span className="whitespace-nowrap">{customModelMode ? "Select from list" : "Type custom"}</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              {!customModelMode && models.length > 0 ? (
                <select
                  value={config.model}
                  onChange={(e) => setConfig({ ...config, model: e.target.value })}
                  className="flex-1 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 cursor-pointer"
                >
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={config.model}
                  placeholder="e.g. qwen2.5:1.5b"
                  onChange={(e) => setConfig({ ...config, model: e.target.value })}
                  className="flex-1 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              )}

              <button
                type="button"
                onClick={() => loadModels(config.base_url, config.api_key, config.model)}
                disabled={isFetchingModels}
                title="Refresh models from endpoint"
                className="p-2 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 rounded-xl text-slate-600 dark:text-zinc-300 transition-colors cursor-pointer shrink-0"
              >
                <IconRefresh
                  size={14}
                  className={isFetchingModels ? "animate-spin text-indigo-500" : ""}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Base URL & API Key */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">
              Base URL
            </label>
            <input
              type="text"
              value={config.base_url}
              onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
              placeholder="http://localhost:11434/v1"
              className="w-full bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-zinc-200 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">
              API Key (Optional for Ollama)
            </label>
            <input
              type="password"
              value={config.api_key}
              onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
              placeholder="Bearer token or leave blank"
              className="w-full bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>
        </div>

        {/* Endpoint Connection Note / Error */}
        {modelFetchError ? (
          <div className="flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-900/40 rounded-xl p-2.5">
            <IconAlertCircle size={14} className="shrink-0 mt-0.5" />
            <div>
              <span>Could not fetch models from {config.base_url}.</span>
              <p className="mt-0.5 text-slate-500 dark:text-zinc-400">
                If using Ollama, ensure it is installed and running (`ollama serve`). You can still enter your model name manually.
              </p>
            </div>
          </div>
        ) : models.length > 0 ? (
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/50 dark:border-emerald-900/40 rounded-xl px-3 py-1.5">
            <IconCheck size={13} />
            <span>Connected to endpoint ({models.length} model{models.length === 1 ? "" : "s"} detected)</span>
          </div>
        ) : null}
      </div>

      {/* 3. Prompt Presets Manager */}
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-200/90 dark:border-zinc-800/90 shadow-xs p-4.5 space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
              Formatting Prompt Presets
            </h3>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
              Select or customize the instructions passed to the LLM during post-processing.
            </p>
          </div>

          <button
            type="button"
            onClick={handleCreatePrompt}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-50 dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-zinc-700 border border-indigo-200/60 dark:border-indigo-500/30 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
          >
            <IconPlus size={13} stroke={2} />
            <span className="whitespace-nowrap">New Prompt</span>
          </button>
        </div>

        {/* Preset Selector & Delete */}
        <div className="flex items-center gap-2">
          <select
            value={config.selected_prompt_id}
            onChange={(e) => setConfig({ ...config, selected_prompt_id: e.target.value })}
            className="flex-1 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 cursor-pointer"
          >
            {config.prompts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>

          {config.prompts.length > 1 && (
            <button
              type="button"
              onClick={() => handleDeletePrompt(selectedPrompt.id)}
              title="Delete this prompt"
              className="p-2 bg-slate-100 dark:bg-zinc-800 hover:bg-rose-100 dark:hover:bg-rose-950/70 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-xl transition-colors cursor-pointer shrink-0"
            >
              <IconTrash size={14} />
            </button>
          )}
        </div>

        {/* Selected Prompt Editor */}
        <div className="space-y-3 pt-1 border-t border-slate-100 dark:border-zinc-800">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">
              Prompt Label
            </label>
            <input
              type="text"
              value={selectedPrompt.label}
              onChange={(e) => handleUpdateCurrentPrompt("label", e.target.value)}
              placeholder="e.g. Improve Transcriptions"
              className="w-full bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                Instructions
              </label>
              <div className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-zinc-500">
                <IconInfoCircle size={12} />
                <span>Use <code className="bg-slate-100 dark:bg-zinc-800 px-1 py-0.5 rounded text-indigo-500 dark:text-indigo-400 font-mono text-[10px]">${"{output}"}</code> for transcript</span>
              </div>
            </div>
            <textarea
              rows={6}
              value={selectedPrompt.instructions}
              onChange={(e) => handleUpdateCurrentPrompt("instructions", e.target.value)}
              placeholder="Enter instructions for the LLM..."
              className="w-full bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-xs text-slate-800 dark:text-zinc-200 font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500/30 resize-y"
            />
          </div>
        </div>
      </div>

      {/* Save Settings Footer Button */}
      <div className="flex items-center justify-end gap-3 pt-1">
        {saveSuccess && (
          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            <IconCheck size={14} />
            <span>Saved successfully</span>
          </span>
        )}
        <button
          type="button"
          onClick={() => handleSave()}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
        >
          <IconDeviceFloppy size={14} stroke={2} className="shrink-0" />
          <span className="whitespace-nowrap">{saving ? "Saving..." : "Save Settings"}</span>
        </button>
      </div>

      {/* 4. Test Post-Processing Card */}
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-200/90 dark:border-zinc-800/90 shadow-xs p-4.5 space-y-3.5">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <IconPlayerPlay size={15} className="text-indigo-600 dark:text-indigo-400" />
            <span>Test Post-Processing</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Send a sample dictation to verify model response, list formatting, and latency without using global hotkeys.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            placeholder="Type sample text to format..."
            className="flex-1 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          />
          <button
            type="button"
            onClick={async () => {
              if (!testInput.trim() || testRunning) return;
              setTestRunning(true);
              setTestResult(null);
              setTestError(null);
              setTestLatencyMs(null);
              const start = performance.now();
              try {
                const res = await testPostProcess(testInput);
                const elapsed = Math.round(performance.now() - start);
                setTestResult(res);
                setTestLatencyMs(elapsed);
              } catch (err) {
                setTestError(typeof err === "string" ? err : JSON.stringify(err));
              } finally {
                setTestRunning(false);
              }
            }}
            disabled={testRunning || !testInput.trim()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
          >
            {testRunning ? (
              <IconRefresh size={13} className="animate-spin shrink-0" />
            ) : (
              <IconPlayerPlay size={13} stroke={2} className="shrink-0" />
            )}
            <span className="whitespace-nowrap">{testRunning ? "Testing..." : "Run Test"}</span>
          </button>
        </div>

        {testError && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/40 text-xs text-rose-700 dark:text-rose-300 font-mono whitespace-pre-wrap break-words">
            {testError}
          </div>
        )}

        {testResult && (
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-zinc-900/90 border border-slate-200 dark:border-zinc-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700 dark:text-zinc-300">
                Formatted Output
              </span>
              {testLatencyMs !== null && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                  {testLatencyMs} ms
                </span>
              )}
            </div>
            <div className="p-3 rounded-lg bg-white dark:bg-zinc-800 border border-slate-200/80 dark:border-zinc-700/60 text-xs text-slate-800 dark:text-zinc-100 font-mono whitespace-pre-wrap leading-relaxed select-text">
              {testResult}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
