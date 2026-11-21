import React, { useEffect, useState, useRef } from "react";
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
import PrimeButton from "./PrimeButton";

export default function PostProcessPanel() {
  const [config, setConfig] = useState<PostProcessConfig | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);

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
    let cancelled = false;
    getPostProcessConfig()
      .then((cfg) => {
        if (!cancelled) {
          setConfig(cfg);
          setLoading(false);
          // Automatically try to fetch models if baseUrl is available
          if (cfg.base_url) {
            loadModels(cfg.base_url, cfg.api_key, cfg.model);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(typeof err === "string" ? err : "Failed to load post-process config");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (saveTimeoutRef.current !== null) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
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
      if (saveTimeoutRef.current !== null) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = window.setTimeout(() => {
        setSaveSuccess(false);
        saveTimeoutRef.current = null;
      }, 2000);
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
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
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <IconSparkles size={18} className="text-foreground" />
          <span>AI Post-Processing</span>
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5 font-normal">
          Clean grammar, format lists, or convert spoken notes into polished text with local Ollama or OpenAI-compatible APIs.
        </p>
      </div>

      {/* Global Error Banner */}
      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive bg-muted border border-border rounded-xl p-3 font-medium">
          <IconAlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 1. Dedicated Hotkey Section */}
      <div className="bg-card rounded-2xl border border-border shadow-xs p-4.5 space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-card-foreground">
              Post-Processing Hotkey
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 font-normal">
              Press this key anywhere to record audio and paste AI-polished text.
            </p>
          </div>

          {config.hotkey !== "Ctrl+Shift+Space" && !isRecordingHotkey && (
            <button
              onClick={handleResetHotkey}
              disabled={saving}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0 whitespace-nowrap font-medium"
            >
              <IconRotate size={12} stroke={1.75} />
              <span className="whitespace-nowrap">Reset</span>
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 bg-muted border border-border rounded-xl p-3">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">
            {keyTokens.map((token, index) => (
              <React.Fragment key={index}>
                {index > 0 && (
                  <span className="text-muted-foreground text-xs font-semibold">+</span>
                )}
                <kbd className="px-2.5 py-1 bg-card border border-border rounded-lg text-xs font-mono font-medium text-card-foreground shadow-2xs whitespace-nowrap">
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
                ? "bg-foreground text-background animate-pulse font-semibold"
                : "bg-card hover:bg-card/80 text-card-foreground border border-border shadow-2xs"
            }`}
          >
            <IconKeyboard size={13} stroke={1.75} />
            <span className="whitespace-nowrap">{isRecordingHotkey ? "Press Keys (Esc to cancel)" : "Change Hotkey"}</span>
          </button>
        </div>
      </div>

      {/* 2. API Configuration (Ollama / OpenAI-Compatible) */}
      <div className="bg-card rounded-2xl border border-border shadow-xs p-4.5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-card-foreground">
            LLM Provider & Model
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 font-normal">
            Connect to local Ollama (recommended, 100% offline) or any OpenAI-compatible endpoint.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Provider Selector */}
          <div>
            <label className="block text-xs font-medium text-card-foreground mb-1">
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
              className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer font-medium"
            >
              <option value="ollama">Ollama (Local)</option>
              <option value="custom">Custom (OpenAI-Compatible)</option>
            </select>
          </div>

          {/* Model Selector / Custom Input */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-card-foreground">
                Model Name
              </label>
              <button
                type="button"
                onClick={() => setCustomModelMode(!customModelMode)}
                className="text-[10px] text-muted-foreground hover:text-foreground underline cursor-pointer shrink-0 whitespace-nowrap"
              >
                <span className="whitespace-nowrap">{customModelMode ? "Select from list" : "Type custom"}</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              {!customModelMode && models.length > 0 ? (
                <select
                  value={config.model}
                  onChange={(e) => setConfig({ ...config, model: e.target.value })}
                  className="flex-1 bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer font-medium"
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
                  className="flex-1 bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-normal"
                />
              )}

              <button
                type="button"
                onClick={() => loadModels(config.base_url, config.api_key, config.model)}
                disabled={isFetchingModels}
                title="Refresh models from endpoint"
                className="p-2 bg-muted hover:bg-muted/80 border border-border rounded-xl text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
              >
                <IconRefresh
                  size={14}
                  className={isFetchingModels ? "animate-spin text-foreground" : ""}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Base URL & API Key */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-card-foreground mb-1">
              Base URL
            </label>
            <input
              type="text"
              value={config.base_url}
              onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
              placeholder="http://localhost:11434/v1"
              className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-card-foreground mb-1">
              API Key (Optional for Ollama)
            </label>
            <input
              type="password"
              value={config.api_key}
              onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
              placeholder="Bearer token or leave blank"
              className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {/* Endpoint Connection Note / Error */}
        {modelFetchError ? (
          <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-muted border border-border rounded-xl p-2.5">
            <IconAlertCircle size={14} className="shrink-0 mt-0.5 text-destructive" />
            <div>
              <span className="font-medium text-foreground">Could not fetch models from {config.base_url}.</span>
              <p className="mt-0.5 text-muted-foreground font-normal">
                If using Ollama, ensure it is installed and running (`ollama serve`). You can still enter your model name manually.
              </p>
            </div>
          </div>
        ) : models.length > 0 ? (
          <div className="flex items-center gap-1.5 text-[11px] text-foreground bg-muted border border-border rounded-xl px-3 py-1.5 font-medium">
            <IconCheck size={13} />
            <span>Connected to endpoint ({models.length} model{models.length === 1 ? "" : "s"} detected)</span>
          </div>
        ) : null}
      </div>

      {/* 3. Prompt Presets Manager */}
      <div className="bg-card rounded-2xl border border-border shadow-xs p-4.5 space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-card-foreground">
              Formatting Prompt Presets
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 font-normal">
              Select or customize the instructions passed to the LLM during post-processing.
            </p>
          </div>

          <button
            type="button"
            onClick={handleCreatePrompt}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted text-foreground hover:bg-muted/80 border border-border transition-colors cursor-pointer shrink-0 whitespace-nowrap"
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
            className="flex-1 bg-muted border border-border rounded-xl px-3 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
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
              className="p-2 bg-muted hover:bg-muted/80 text-muted-foreground hover:text-destructive border border-border rounded-xl transition-colors cursor-pointer shrink-0"
            >
              <IconTrash size={14} />
            </button>
          )}
        </div>

        {/* Selected Prompt Editor */}
        <div className="space-y-3 pt-1 border-t border-border">
          <div>
            <label className="block text-xs font-medium text-card-foreground mb-1">
              Prompt Label
            </label>
            <input
              type="text"
              value={selectedPrompt.label}
              onChange={(e) => handleUpdateCurrentPrompt("label", e.target.value)}
              placeholder="e.g. Improve Transcriptions"
              className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-normal"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-card-foreground">
                Instructions
              </label>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <IconInfoCircle size={12} />
                <span>Use <code className="bg-muted px-1 py-0.5 rounded text-foreground font-mono text-[10px] border border-border">${"{output}"}</code> for transcript</span>
              </div>
            </div>
            <textarea
              rows={6}
              value={selectedPrompt.instructions}
              onChange={(e) => handleUpdateCurrentPrompt("instructions", e.target.value)}
              placeholder="Enter instructions for the LLM..."
              className="w-full bg-muted border border-border rounded-xl p-3 text-xs text-foreground placeholder:text-muted-foreground font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring resize-y"
            />
          </div>
        </div>
      </div>

      {/* Save Settings Footer Button */}
      <div className="flex items-center justify-end gap-3 pt-1">
        {saveSuccess && (
          <span className="flex items-center gap-1 text-xs text-foreground font-medium">
            <IconCheck size={14} />
            <span>Saved successfully</span>
          </span>
        )}
        <PrimeButton
          onClick={() => handleSave()}
          disabled={saving}
          size="default"
        >
          <IconDeviceFloppy size={14} stroke={2} className="shrink-0" />
          <span className="whitespace-nowrap">{saving ? "Saving..." : "Save Settings"}</span>
        </PrimeButton>
      </div>

      {/* 4. Test Post-Processing Card */}
      <div className="bg-card rounded-2xl border border-border shadow-xs p-4.5 space-y-3.5">
        <div>
          <h3 className="text-sm font-semibold text-card-foreground flex items-center gap-2">
            <IconPlayerPlay size={15} className="text-foreground" />
            <span>Test Post-Processing</span>
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 font-normal">
            Send a sample dictation to verify model response, list formatting, and latency without using global hotkeys.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            placeholder="Type sample text to format..."
            className="flex-1 bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-normal"
          />
          <PrimeButton
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
            size="default"
          >
            {testRunning ? (
              <IconRefresh size={13} className="animate-spin shrink-0" />
            ) : (
              <IconPlayerPlay size={13} stroke={2} className="shrink-0" />
            )}
            <span className="whitespace-nowrap">{testRunning ? "Testing..." : "Run Test"}</span>
          </PrimeButton>
        </div>

        {testError && (
          <div className="p-3 rounded-xl bg-muted border border-border text-xs text-destructive font-mono whitespace-pre-wrap break-words">
            {testError}
          </div>
        )}

        {testResult && (
          <div className="p-3.5 rounded-xl bg-muted border border-border space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-card-foreground">
                Formatted Output
              </span>
              {testLatencyMs !== null && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-card text-foreground border border-border">
                  {testLatencyMs} ms
                </span>
              )}
            </div>
            <div className="p-3 rounded-lg bg-card border border-border text-xs text-card-foreground font-mono whitespace-pre-wrap leading-relaxed select-text">
              {testResult}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
