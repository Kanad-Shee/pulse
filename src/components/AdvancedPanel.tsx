import { useEffect, useState, useRef } from "react";
import {
  getAdvancedConfig,
  saveAdvancedConfig,
  type AdvancedConfig,
} from "../lib/tauri";
import {
  IconAppWindow,
  IconTerminal2,
  IconFilter,
  IconBolt,
  IconX,
  IconPlus,
  IconCheck,
  IconAlertCircle,
} from "@tabler/icons-react";
import PrimeButton from "./PrimeButton";

export default function AdvancedPanel() {
  const [config, setConfig] = useState<AdvancedConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [newWord, setNewWord] = useState("");
  const saveTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAdvancedConfig()
      .then((cfg) => {
        if (!cancelled) {
          setConfig(cfg);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMessage(String(err));
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

  const updateConfig = async (patch: Partial<AdvancedConfig>) => {
    if (!config) return;
    const nextConfig = { ...config, ...patch };
    setConfig(nextConfig);
    try {
      setSaving(true);
      await saveAdvancedConfig(nextConfig);
      setSavedFeedback(true);
      if (saveTimeoutRef.current !== null) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = window.setTimeout(() => {
        setSavedFeedback(false);
        saveTimeoutRef.current = null;
      }, 1200);
    } catch (err) {
      setErrorMessage(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustomWord = () => {
    if (!config || !newWord.trim()) return;
    const word = newWord.trim();
    if (!config.custom_words.some((w) => w.toLowerCase() === word.toLowerCase())) {
      const nextWords = [...config.custom_words, word];
      updateConfig({ custom_words: nextWords });
    }
    setNewWord("");
  };

  const handleRemoveCustomWord = (index: number) => {
    if (!config) return;
    const nextWords = config.custom_words.filter((_, i) => i !== index);
    updateConfig({ custom_words: nextWords });
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-xs text-slate-400 dark:text-zinc-500 font-medium">
        Loading advanced preferences...
      </div>
    );
  }

  if (!config) {
    return (
      <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
        <IconAlertCircle size={16} />
        <span>Failed to load advanced configuration: {errorMessage}</span>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-zinc-100">
            Advanced Settings
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Fine-tune application lifecycle, clipboard paste methods, transcription filtering, and hardware execution.
          </p>
        </div>
        {savedFeedback && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800/60 animate-fade-in">
            <IconCheck size={12} stroke={2.5} />
            <span>Saved</span>
          </span>
        )}
      </div>

      {errorMessage && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/40 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <IconAlertCircle size={15} className="shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Card 1: App Behavior */}
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-200/90 dark:border-zinc-800/90 p-4.5 space-y-4 shadow-xs">
        <div className="flex items-center gap-2 border-b border-slate-100 dark:border-zinc-800/80 pb-3">
          <div className="p-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
            <IconAppWindow size={16} stroke={2} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
              App Behavior
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400">
              Window visibility, overlay pill layout, and memory management.
            </p>
          </div>
        </div>

        <div className="space-y-3.5">
          {/* Start Hidden */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 block">
                Start Hidden in System Tray
              </span>
              <span className="text-[11px] text-slate-400 dark:text-zinc-500 block">
                Launch quietly in background without opening the Settings window on start.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={config.start_hidden}
              disabled={saving}
              onClick={() => updateConfig({ start_hidden: !config.start_hidden })}
              className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                config.start_hidden ? "bg-indigo-600" : "bg-slate-300 dark:bg-zinc-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                  config.start_hidden ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="border-t border-slate-100 dark:border-zinc-800/60" />

          {/* Overlay Mode */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 block">
                Floating Overlay Mode
              </span>
              <span className="text-[11px] text-slate-400 dark:text-zinc-500 block">
                Control the real-time visual feedback pill displayed while speaking.
              </span>
            </div>
            <select
              value={config.overlay_mode}
              onChange={(e) => updateConfig({ overlay_mode: e.target.value as any })}
              className="text-xs bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-zinc-200 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="live">Live (Waveform & Streamed Text)</option>
              <option value="minimal">Minimal (Waveform Only)</option>
              <option value="off">Off (Disable Overlay)</option>
            </select>
          </div>

          <div className="border-t border-slate-100 dark:border-zinc-800/60" />

          {/* Overlay Position */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 block">
                Overlay Position
              </span>
              <span className="text-[11px] text-slate-400 dark:text-zinc-500 block">
                Placement of the floating dictation pill on your primary monitor.
              </span>
            </div>
            <select
              value={config.overlay_position}
              onChange={(e) => updateConfig({ overlay_position: e.target.value as any })}
              className="text-xs bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-zinc-200 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="bottom">Bottom Center</option>
              <option value="top">Top Center</option>
            </select>
          </div>

          <div className="border-t border-slate-100 dark:border-zinc-800/60" />

          {/* Unload Model Minutes */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 block">
                Auto-Unload Model from Memory
              </span>
              <span className="text-[11px] text-slate-400 dark:text-zinc-500 block">
                Free RAM and VRAM when idle; automatically reloads on the next recording.
              </span>
            </div>
            <select
              value={config.unload_model_minutes}
              onChange={(e) => updateConfig({ unload_model_minutes: Number(e.target.value) })}
              className="text-xs bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-zinc-200 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              <option value={0}>Never (Keep Loaded)</option>
              <option value={2}>After 2 minutes</option>
              <option value={5}>After 5 minutes (Recommended)</option>
              <option value={15}>After 15 minutes</option>
              <option value={30}>After 30 minutes</option>
            </select>
          </div>
        </div>
      </div>

      {/* Card 2: Output & Injection */}
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-200/90 dark:border-zinc-800/90 p-4.5 space-y-4 shadow-xs">
        <div className="flex items-center gap-2 border-b border-slate-100 dark:border-zinc-800/80 pb-3">
          <div className="p-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
            <IconTerminal2 size={16} stroke={2} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
              Output & Text Injection
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400">
              How transcription results are pasted into your focused application.
            </p>
          </div>
        </div>

        <div className="space-y-3.5">
          {/* Paste Method */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 block">
                Paste Method
              </span>
              <span className="text-[11px] text-slate-400 dark:text-zinc-500 block">
                Keyboard simulation mechanism used to inject transcribed text.
              </span>
            </div>
            <select
              value={config.paste_method}
              onChange={(e) => updateConfig({ paste_method: e.target.value as any })}
              className="text-xs bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-zinc-200 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="ctrl_v">Ctrl + V (Universal Clipboard)</option>
              <option value="ctrl_shift_v">Ctrl + Shift + V (Plain Text / Terminal)</option>
              <option value="direct_type">Direct Keystroke Typing (No Clipboard)</option>
            </select>
          </div>

          <div className="border-t border-slate-100 dark:border-zinc-800/60" />

          {/* Clipboard Handling */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 block">
                Clipboard Restoration
              </span>
              <span className="text-[11px] text-slate-400 dark:text-zinc-500 block">
                Preserve your previous clipboard contents after pasting dictations.
              </span>
            </div>
            <select
              value={config.clipboard_handling}
              onChange={(e) => updateConfig({ clipboard_handling: e.target.value as any })}
              className="text-xs bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-zinc-200 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="restore">Restore Previous Clipboard</option>
              <option value="keep">Keep Dictated Text in Clipboard</option>
            </select>
          </div>

          <div className="border-t border-slate-100 dark:border-zinc-800/60" />

          {/* Auto Submit */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 block">
                Auto-Submit Key
              </span>
              <span className="text-[11px] text-slate-400 dark:text-zinc-500 block">
                Automatically press Enter or Ctrl+Enter right after pasting (great for AI chats & search).
              </span>
            </div>
            <select
              value={config.auto_submit}
              onChange={(e) => updateConfig({ auto_submit: e.target.value as any })}
              className="text-xs bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-zinc-200 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="off">Off (Paste Only)</option>
              <option value="enter">Press Enter</option>
              <option value="ctrl_enter">Press Ctrl + Enter</option>
            </select>
          </div>

          <div className="border-t border-slate-100 dark:border-zinc-800/60" />

          {/* Append Trailing Space */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 block">
                Append Trailing Space
              </span>
              <span className="text-[11px] text-slate-400 dark:text-zinc-500 block">
                Adds a trailing space after text so consecutive voice dictations flow naturally.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={config.append_trailing_space}
              disabled={saving}
              onClick={() => updateConfig({ append_trailing_space: !config.append_trailing_space })}
              className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                config.append_trailing_space ? "bg-indigo-600" : "bg-slate-300 dark:bg-zinc-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                  config.append_trailing_space ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Card 3: Transcription Cleanup */}
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-200/90 dark:border-zinc-800/90 p-4.5 space-y-4 shadow-xs">
        <div className="flex items-center gap-2 border-b border-slate-100 dark:border-zinc-800/80 pb-3">
          <div className="p-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
            <IconFilter size={16} stroke={2} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
              Transcription Cleanup
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400">
              Silence trimming, filler word removal, and domain-specific custom vocabulary dictionary.
            </p>
          </div>
        </div>

        <div className="space-y-3.5">
          {/* Voice Activity Detection */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 block">
                Voice Activity Detection (VAD)
              </span>
              <span className="text-[11px] text-slate-400 dark:text-zinc-500 block">
                Trims leading & trailing silence and skips empty audio to prevent model hallucinations.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={config.vad_enabled}
              disabled={saving}
              onClick={() => updateConfig({ vad_enabled: !config.vad_enabled })}
              className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                config.vad_enabled ? "bg-indigo-600" : "bg-slate-300 dark:bg-zinc-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                  config.vad_enabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="border-t border-slate-100 dark:border-zinc-800/60" />

          {/* Remove Filler Words */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 block">
                Remove Filler Words
              </span>
              <span className="text-[11px] text-slate-400 dark:text-zinc-500 block">
                Automatically strips vocal pauses (&quot;um&quot;, &quot;uh&quot;, &quot;uhh&quot;, &quot;umm&quot;, &quot;er&quot;, &quot;ah&quot;) and collapses double spaces.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={config.remove_filler_words}
              disabled={saving}
              onClick={() => updateConfig({ remove_filler_words: !config.remove_filler_words })}
              className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                config.remove_filler_words ? "bg-indigo-600" : "bg-slate-300 dark:bg-zinc-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                  config.remove_filler_words ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="border-t border-slate-100 dark:border-zinc-800/60" />

          {/* Custom Vocabulary Dictionary */}
          <div className="space-y-2">
            <div>
              <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 block">
                Custom Vocabulary &amp; Casing Dictionary
              </span>
              <span className="text-[11px] text-slate-400 dark:text-zinc-500 block">
                Enforces exact casing/spelling normalization (e.g. &quot;Tauri&quot;, &quot;Next.js&quot;, &quot;Parakeet&quot;) and injects vocabulary hints for Whisper models.
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddCustomWord();
                  }
                }}
                placeholder="Type a word or phrase (e.g. Next.js)..."
                className="flex-1 text-xs bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-slate-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <PrimeButton
                onClick={handleAddCustomWord}
                disabled={!newWord.trim()}
                size="sm"
              >
                <IconPlus size={13} stroke={2} />
                <span>Add Word</span>
              </PrimeButton>
            </div>

            {config.custom_words.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {config.custom_words.map((word, idx) => (
                  <span
                    key={`${word}-${idx}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700"
                  >
                    <span>{word}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomWord(idx)}
                      className="text-slate-400 hover:text-rose-500 dark:text-zinc-500 dark:hover:text-rose-400 cursor-pointer"
                      title="Remove word"
                    >
                      <IconX size={12} stroke={2.5} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-slate-400 dark:text-zinc-500 italic pt-0.5">
                No custom words added yet. Add domain names, library names, or acronyms above.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Card 4: Performance & Hardware */}
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-200/90 dark:border-zinc-800/90 p-4.5 space-y-4 shadow-xs">
        <div className="flex items-center gap-2 border-b border-slate-100 dark:border-zinc-800/80 pb-3">
          <div className="p-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
            <IconBolt size={16} stroke={2} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
              Performance &amp; Hardware
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400">
              Execution provider acceleration and microphone standby optimization.
            </p>
          </div>
        </div>

        <div className="space-y-3.5">
          {/* Acceleration */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 block">
                Hardware Acceleration
              </span>
              <span className="text-[11px] text-slate-400 dark:text-zinc-500 block">
                Use Windows ONNX DirectML provider with transparent CPU fallback.
              </span>
            </div>
            <select
              value={config.acceleration}
              onChange={(e) => updateConfig({ acceleration: e.target.value as any })}
              className="text-xs bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-zinc-200 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="auto">Auto (GPU DirectML with CPU Fallback)</option>
              <option value="gpu">GPU DirectML Preferred</option>
              <option value="cpu">CPU Only</option>
            </select>
          </div>

          <div className="border-t border-slate-100 dark:border-zinc-800/60" />

          {/* Keep Mic Open */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 block">
                Keep Microphone Stream Open
              </span>
              <span className="text-[11px] text-slate-400 dark:text-zinc-500 block">
                Keeps the audio capture stream running in the background to eliminate microphone warm-up latency.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={config.keep_mic_open}
              disabled={saving}
              onClick={() => updateConfig({ keep_mic_open: !config.keep_mic_open })}
              className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                config.keep_mic_open ? "bg-indigo-600" : "bg-slate-300 dark:bg-zinc-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                  config.keep_mic_open ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
