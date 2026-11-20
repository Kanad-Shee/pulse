import React, { useEffect, useState, useRef } from "react";
import {
  onAudioLevel,
  onOverlayState,
  onOverlayPreview,
  cancelRecording,
} from "../lib/tauri";
import { IconX } from "@tabler/icons-react";

const BAR_WEIGHTS = [0.2, 0.35, 0.55, 0.75, 0.9, 1.0, 0.9, 0.75, 0.55, 0.35, 0.2];

export default function RecordingOverlay() {
  const [status, setStatus] = useState<"listening" | "transcribing" | "polishing" | "idle">("listening");
  const [previewText, setPreviewText] = useState<string>("");
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [seconds, setSeconds] = useState<number>(0);
  const timerRef = useRef<number | null>(null);
  const textContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of preview text container
  useEffect(() => {
    if (textContainerRef.current) {
      textContainerRef.current.scrollTop = textContainerRef.current.scrollHeight;
    }
  }, [previewText]);

  // Listen to overlay state updates from backend
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onOverlayState((payload) => {
      setStatus(payload.status);
      if (payload.status === "listening") {
        setPreviewText("");
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Listen to live preview updates from backend
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onOverlayPreview((payload) => {
      setPreviewText(payload.text || "");
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Listen to live audio levels
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onAudioLevel((level) => {
      setAudioLevel(level);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Timer logic
  useEffect(() => {
    if (status === "listening") {
      setSeconds(0);
      timerRef.current = window.setInterval(() => {
        setSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setAudioLevel(0);
    }

    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [status]);

  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleCancel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await cancelRecording();
    } catch (err) {
      console.error("Failed to cancel recording:", err);
    }
  };

  return (
    <div className="w-screen h-screen flex items-end justify-center pb-2 bg-transparent select-none overflow-hidden">
      <div className="w-full max-w-[360px] rounded-2xl bg-white/95 dark:bg-[#141414]/95 backdrop-blur-md border border-slate-200/90 dark:border-zinc-800/90 shadow-xl px-5 py-3 flex flex-col gap-2.5">
        {/* Top row: Live Preview text OR Status label */}
        <div className="flex items-start justify-between gap-2 overflow-hidden">
          <div
            ref={textContainerRef}
            className="text-xs font-medium text-slate-700 dark:text-zinc-300 tracking-wide max-h-24 overflow-y-auto whitespace-pre-wrap break-words pr-1 flex-1 min-w-0 leading-snug"
          >
            {status === "polishing" ? (
              <span className="animate-pulse text-indigo-600 dark:text-indigo-400 font-semibold">
                Polishing with AI...
              </span>
            ) : previewText ? (
              <span className="italic text-slate-800 dark:text-zinc-100">
                "{previewText}"
              </span>
            ) : status === "listening" ? (
              <span className="italic text-slate-600 dark:text-zinc-400">Listening...</span>
            ) : status === "transcribing" ? (
              <span className="animate-pulse text-indigo-600 dark:text-indigo-400 font-semibold">
                Transcribing...
              </span>
            ) : (
              <span className="text-slate-400 dark:text-zinc-500">Ready</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
            <img src="/pulse-logo.png" alt="Pulse" className="w-3.5 h-3.5 rounded object-contain shrink-0" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">
              Pulse
            </span>
          </div>
        </div>

        {/* Bottom row: 3-column flex */}
        <div className="flex items-center justify-between gap-3">
          {/* Left: Pulsing indigo dot with ping halo */}
          <div className="flex items-center justify-center w-5 h-5 relative shrink-0">
            {status === "listening" && (
              <span className="absolute inline-flex h-3.5 w-3.5 rounded-full bg-indigo-400 opacity-75 animate-ping" />
            )}
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                status === "listening"
                  ? "bg-indigo-600 dark:bg-indigo-400"
                  : status === "transcribing" || status === "polishing"
                  ? "bg-indigo-400 animate-pulse"
                  : "bg-slate-300 dark:bg-zinc-700"
              }`}
            />
          </div>

          {/* Center: Live 11-bar dot-to-wave visualizer */}
          <div className="flex items-center justify-center gap-1.5 h-7 flex-1">
            {BAR_WEIGHTS.map((weight, i) => {
              const dynamicHeight =
                status === "listening"
                  ? Math.max(6, Math.min(28, Math.round(6 + audioLevel * weight * 24)))
                  : 6;

              return (
                <div
                  key={i}
                  style={{ height: `${dynamicHeight}px` }}
                  className="w-1.5 bg-indigo-500 dark:bg-indigo-400 rounded-full transition-all duration-75 ease-out shrink-0"
                />
              );
            })}
          </div>

          {/* Right: Live timer & Cancel button */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-mono tabular-nums text-slate-400 dark:text-zinc-500">
              {formatTime(seconds)}
            </span>
            <button
              onClick={handleCancel}
              title="Cancel recording"
              aria-label="Cancel recording"
              className="w-5 h-5 rounded-full bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 active:bg-slate-300 text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 flex items-center justify-center transition-colors cursor-pointer shrink-0"
            >
              <IconX size={12} stroke={2.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
