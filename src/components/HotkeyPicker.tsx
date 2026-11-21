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
        <h2 className="text-base font-semibold text-foreground">
          Push-to-Talk Shortcut
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Configure your system-wide dictation key combination and trigger behavior.
        </p>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-xs p-4.5 space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-card-foreground">
              Active Hotkey
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 font-normal">
              {mode === "hold"
                ? "Hold to record, release to transcribe & paste"
                : "Click once to record with live preview, click again to paste"}
            </p>
          </div>

          {currentShortcut !== "Alt+Space" && !isRecording && (
            <button
              onClick={handleReset}
              disabled={saving}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0 whitespace-nowrap font-medium"
            >
              <IconRotate size={12} stroke={1.75} />
              <span className="whitespace-nowrap">Reset</span>
            </button>
          )}
        </div>

        {/* Shortcut Key Display & Change Button */}
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
              setTempCombo("");
              setIsRecording(!isRecording);
            }}
            disabled={saving}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
              isRecording
                ? "bg-foreground text-background animate-pulse font-semibold"
                : "bg-card hover:bg-card/80 text-card-foreground border border-border shadow-2xs"
            }`}
          >
            <IconKeyboard size={13} stroke={1.75} />
            <span className="whitespace-nowrap">{isRecording ? "Press Keys (Esc to cancel)" : "Change Shortcut"}</span>
          </button>
        </div>

        {/* Segmented Mode Selector: Hold vs Toggle */}
        <div className="space-y-1.5 pt-0.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Interaction Mode
          </div>
          <div className="grid grid-cols-2 gap-2 bg-muted p-1 rounded-xl border border-border">
            <button
              type="button"
              onClick={() => handleModeChange("hold")}
              disabled={saving}
              className={`flex flex-col items-start px-3 py-2 rounded-lg text-left transition-all cursor-pointer allow-wrap ${
                mode === "hold"
                  ? "bg-card text-foreground shadow-xs font-medium border border-border"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/40"
              }`}
            >
              <span className="text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    mode === "hold" ? "bg-foreground" : "bg-transparent"
                  }`}
                />
                Hold (Push-to-Talk)
              </span>
              <span className="text-[11px] text-muted-foreground mt-0.5 whitespace-nowrap font-normal">
                Hold to talk, release to paste
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleModeChange("toggle")}
              disabled={saving}
              className={`flex flex-col items-start px-3 py-2 rounded-lg text-left transition-all cursor-pointer allow-wrap ${
                mode === "toggle"
                  ? "bg-card text-foreground shadow-xs font-medium border border-border"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/40"
              }`}
            >
              <span className="text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    mode === "toggle" ? "bg-foreground" : "bg-transparent"
                  }`}
                />
                Toggle (Hands-Free)
              </span>
              <span className="text-[11px] text-muted-foreground mt-0.5 whitespace-nowrap font-normal">
                Live preview, click again to paste
              </span>
            </button>
          </div>
        </div>

        {error && (
          <div className="text-xs text-destructive bg-muted border border-border rounded-lg p-2 font-medium">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
