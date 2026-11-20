import React, { useEffect, useState } from "react";
import {
  getShortcut,
  setShortcut,
  getShortcutMode,
  setShortcutMode,
  type ShortcutMode,
} from "../lib/tauri";
import { IconKeyboard, IconRotate } from "@tabler/icons-react";

export default function HotkeyPicker() {
  const [currentShortcut, setCurrentShortcut] = useState<string>("Alt+Space");
  const [mode, setMode] = useState<ShortcutMode>("hold");
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [tempCombo, setTempCombo] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    getShortcut()
      .then((sc) => {
        if (sc) setCurrentShortcut(sc);
      })
      .catch((err) => {
        console.error("Failed to load shortcut:", err);
      });

    getShortcutMode()
      .then((m) => {
        if (m) setMode(m);
      })
      .catch((err) => {
        console.error("Failed to load shortcut mode:", err);
      });
  }, []);

  const handleModeChange = async (newMode: ShortcutMode) => {
    if (newMode === mode || saving) return;
    try {
      setSaving(true);
      setError(null);
      const savedMode = await setShortcutMode(newMode);
      setMode(savedMode);
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to change shortcut mode");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Don't record standalone modifier presses
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
        const parts: string[] = [];
        if (e.ctrlKey) parts.push("Ctrl");
        if (e.altKey) parts.push("Alt");
        if (e.shiftKey) parts.push("Shift");
        if (e.metaKey) parts.push("Super");
        setTempCombo(parts.join("+"));
        return;
      }

      // Escape cancels recording mode
      if (e.key === "Escape") {
        setIsRecording(false);
        setTempCombo("");
        setError(null);
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      if (e.metaKey) parts.push("Super");

      // Key normalization
      let key = e.key;
      if (key === " ") key = "Space";
      else if (key.length === 1) key = key.toUpperCase();

      parts.push(key);

      const combo = parts.join("+");
      setTempCombo(combo);

      // Validate combo has at least one modifier unless it's a function key (F1-F12)
      const isFunctionKey = /^F(1[0-2]|[1-9])$/.test(key);
      const hasModifier = parts.length > 1;

      if (!hasModifier && !isFunctionKey) {
        setError("Shortcut must include a modifier key (e.g., Alt, Ctrl, Shift)");
        return;
      }

      setError(null);
      setSaving(true);

      setShortcut(combo)
        .then((saved) => {
          setCurrentShortcut(saved);
          setIsRecording(false);
          setTempCombo("");
        })
        .catch((err) => {
          setError(typeof err === "string" ? err : "Failed to register shortcut");
        })
        .finally(() => {
          setSaving(false);
        });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isRecording]);

  const handleReset = async () => {
    try {
      setSaving(true);
      setError(null);
      const saved = await setShortcut("Alt+Space");
      setCurrentShortcut(saved);
      setIsRecording(false);
      setTempCombo("");
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to reset shortcut");
    } finally {
      setSaving(false);
    }
  };

  const keyTokens = (isRecording && tempCombo ? tempCombo : currentShortcut).split("+");

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-zinc-100">
          Push-to-Talk Shortcut
        </h2>
        <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
          Configure your system-wide dictation key combination and trigger behavior.
        </p>
      </div>

      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-200/90 dark:border-zinc-800/90 shadow-xs p-4.5 space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
              Active Hotkey
            </h3>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
              {mode === "hold"
                ? "Hold to record, release to transcribe & paste"
                : "Click once to record with live preview, click again to paste"}
            </p>
          </div>

          {currentShortcut !== "Alt+Space" && !isRecording && (
            <button
              onClick={handleReset}
              disabled={saving}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
            >
              <IconRotate size={12} stroke={1.75} />
              <span className="whitespace-nowrap">Reset</span>
            </button>
          )}
        </div>

        {/* Shortcut Key Display & Change Button */}
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
              setTempCombo("");
              setIsRecording(!isRecording);
            }}
            disabled={saving}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
              isRecording
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200 border border-amber-200 dark:border-amber-800 animate-pulse"
                : "bg-indigo-50 dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-zinc-700 border border-indigo-200/60 dark:border-indigo-500/30"
            }`}
          >
            <IconKeyboard size={13} stroke={1.75} />
            <span className="whitespace-nowrap">{isRecording ? "Press Keys (Esc to cancel)" : "Change Shortcut"}</span>
          </button>
        </div>

        {/* Segmented Mode Selector: Hold vs Toggle */}
        <div className="space-y-1.5 pt-0.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-zinc-500">
            Interaction Mode
          </div>
          <div className="grid grid-cols-2 gap-2 bg-slate-100/80 dark:bg-zinc-900/80 p-1 rounded-xl border border-slate-200/60 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => handleModeChange("hold")}
              disabled={saving}
              className={`flex flex-col items-start px-3 py-2 rounded-lg text-left transition-all cursor-pointer allow-wrap ${
                mode === "hold"
                  ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 shadow-xs font-medium border border-slate-200/50 dark:border-indigo-500/40"
                  : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 hover:bg-white/50 dark:hover:bg-zinc-800/50"
              }`}
            >
              <span className="text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    mode === "hold" ? "bg-indigo-600 dark:bg-indigo-400" : "bg-transparent"
                  }`}
                />
                Hold (Push-to-Talk)
              </span>
              <span className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5 whitespace-nowrap">
                Hold to talk, release to paste
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleModeChange("toggle")}
              disabled={saving}
              className={`flex flex-col items-start px-3 py-2 rounded-lg text-left transition-all cursor-pointer allow-wrap ${
                mode === "toggle"
                  ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 shadow-xs font-medium border border-slate-200/50 dark:border-indigo-500/40"
                  : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 hover:bg-white/50 dark:hover:bg-zinc-800/50"
              }`}
            >
              <span className="text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    mode === "toggle" ? "bg-indigo-600 dark:bg-indigo-400" : "bg-transparent"
                  }`}
                />
                Toggle (Hands-Free)
              </span>
              <span className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5 whitespace-nowrap">
                Live preview, click again to paste
              </span>
            </button>
          </div>
        </div>

        {error && (
          <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200/60 dark:border-rose-900/40 rounded-lg p-2">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
