import { useEffect, useState, useRef, type MouseEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  onAudioLevel,
  onOverlayState,
  onOverlayPreview,
  cancelRecording,
  getOverlayTextStyle,
  onOverlayStyleUpdated,
  type OverlayTextStyle,
} from "../lib/tauri";
import { IconX, IconMicrophone } from "@tabler/icons-react";
import SmokyWave from "./SmokyWave";

export default function RecordingOverlay() {
  const [status, setStatus] = useState<
    "listening" | "transcribing" | "polishing" | "idle"
  >("idle");
  const [previewText, setPreviewText] = useState<string>("");
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [seconds, setSeconds] = useState<number>(0);
  const [sessionId, setSessionId] = useState<number>(0);
  const [overlayTextStyle, setOverlayTextStyle] =
    useState<OverlayTextStyle>("normal");
  const [isDark, setIsDark] = useState<boolean>(() =>
    document.documentElement.classList.contains("dark"),
  );
  const timerRef = useRef<number | null>(null);
  const textContainerRef = useRef<HTMLDivElement>(null);

  // Sync isDark when documentElement class changes
  useEffect(() => {
    const checkDark = () => {
      setIsDark(document.documentElement.classList.contains("dark"));
    };
    checkDark();

    const observer = new MutationObserver(checkDark);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  // Auto-scroll to bottom of preview text container when content changes
  useEffect(() => {
    if (textContainerRef.current) {
      textContainerRef.current.scrollTop =
        textContainerRef.current.scrollHeight;
    }
  }, [previewText]);

  // Load initial text style and listen for live updates
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    getOverlayTextStyle()
      .then((style) => {
        if (!cancelled) setOverlayTextStyle(style);
      })
      .catch((err) => console.warn("Failed to get overlay text style:", err));

    onOverlayStyleUpdated((payload) => {
      if (!cancelled) setOverlayTextStyle(payload.style);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    });

    return () => {
      cancelled = true;
      if (unlistenFn) {
        unlistenFn();
        unlistenFn = null;
      }
    };
  }, []);

  // Listen to overlay state updates from backend
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    onOverlayState((payload) => {
      if (cancelled) return;
      setStatus(payload.status);
      if (payload.status === "listening") {
        setSeconds(0);
        setPreviewText("");
        setAudioLevel(0);
        setSessionId((s) => s + 1);
      } else if (payload.status === "idle") {
        if (timerRef.current !== null) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setSeconds(0);
        setAudioLevel(0);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    });

    return () => {
      cancelled = true;
      if (unlistenFn) {
        unlistenFn();
        unlistenFn = null;
      }
    };
  }, []);

  // Listen to live preview updates from backend
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    onOverlayPreview((payload) => {
      if (!cancelled) {
        setPreviewText(payload.text || "");
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    });

    return () => {
      cancelled = true;
      if (unlistenFn) {
        unlistenFn();
        unlistenFn = null;
      }
    };
  }, []);

  // Listen to live audio levels
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    onAudioLevel((level) => {
      if (!cancelled) {
        setAudioLevel(level);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    });

    return () => {
      cancelled = true;
      if (unlistenFn) {
        unlistenFn();
        unlistenFn = null;
      }
    };
  }, []);

  // Timer logic
  useEffect(() => {
    if (status === "listening") {
      setSeconds(0);
      const startTime = Date.now();
      timerRef.current = window.setInterval(() => {
        setSeconds(Math.floor((Date.now() - startTime) / 1000));
      }, 100);
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
  }, [status, sessionId]);

  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleCancel = async (e: MouseEvent) => {
    e.stopPropagation();
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setAudioLevel(0);
    try {
      await cancelRecording();
    } catch (err) {
      console.error("Failed to cancel recording:", err);
    }
  };

  // Expanded when text arrives or during final processing states
  const isExpanded =
    previewText.trim().length > 0 ||
    status === "transcribing" ||
    status === "polishing";

  return (
    <div className="w-screen h-screen flex items-end justify-center pb-6 bg-transparent select-none overflow-hidden">
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 420, damping: 32, mass: 0.8 }}
        className={`p-[1.25px] relative transition-all ${
          isDark
            ? "bg-[linear-gradient(135deg,rgba(129,140,248,0.75)_0%,rgba(39,39,42,0.9)_38%,rgba(39,39,42,0.9)_62%,rgba(99,102,241,0.7)_100%)] shadow-[0_8px_24px_-4px_rgba(0,0,0,0.75),0_2px_8px_-1px_rgba(0,0,0,0.5),0_0_18px_rgba(99,102,241,0.18)]"
            : "bg-[linear-gradient(135deg,rgba(99,102,241,0.7)_0%,rgba(203,213,225,0.85)_38%,rgba(203,213,225,0.85)_62%,rgba(79,70,229,0.65)_100%)] shadow-[0_8px_24px_-4px_rgba(15,23,42,0.12),0_2px_8px_-1px_rgba(15,23,42,0.06),0_0_18px_rgba(99,102,241,0.10)]"
        } ${isExpanded ? "w-[360px] rounded-[26px]" : "w-[264px] rounded-full"}`}
      >
        <div
          className={`w-full h-full relative overflow-hidden backdrop-blur-md flex flex-col justify-center transition-all ${
            isDark ? "bg-[#121212]/95" : "bg-white/95"
          } ${
            isExpanded
              ? "rounded-[25px] px-4 py-3 gap-2.5"
              : "rounded-full px-3.5 py-2 gap-0"
          }`}
        >
          {/* Full-width bottom-anchored Smoky Wave background (max 40% height) */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[40%] min-h-[32px] overflow-hidden">
            <SmokyWave
              level={audioLevel}
              active={status === "listening"}
              isDark={isDark}
            />
          </div>

          {/* Top section: auto-scrolling preview text with zero quotes */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                key="overlay-text-section"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
                className="relative z-10 flex items-start justify-between gap-2 overflow-hidden pb-1"
              >
                <div
                  ref={textContainerRef}
                  className={`text-xs font-medium tracking-wide max-h-24 overflow-y-auto scrollbar-hide whitespace-pre-wrap break-words pr-1 flex-1 min-w-0 leading-snug ${
                    isDark ? "text-zinc-200" : "text-slate-700"
                  } ${overlayTextStyle === "italic" ? "italic" : "not-italic"}`}
                >
                  {status === "polishing" ? (
                    <span
                      className={`animate-pulse font-semibold not-italic ${
                        isDark ? "text-indigo-400" : "text-indigo-600"
                      }`}
                    >
                      Polishing with AI...
                    </span>
                  ) : previewText ? (
                    <span
                      className={isDark ? "text-zinc-100" : "text-slate-800"}
                    >
                      {previewText}
                    </span>
                  ) : status === "transcribing" ? (
                    <span
                      className={`animate-pulse font-semibold not-italic ${
                        isDark ? "text-indigo-400" : "text-indigo-600"
                      }`}
                    >
                      Transcribing...
                    </span>
                  ) : (
                    <span
                      className={isDark ? "text-zinc-500" : "text-slate-400"}
                    >
                      Listening...
                    </span>
                  )}
                </div>
                <div className="flex items-center shrink-0 pt-0.5">
                  <img
                    src="/pulse-logo.png"
                    alt="Pulse"
                    className="w-4 h-4 object-contain shrink-0 opacity-80"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom controls row (floating cleanly on top of the wave) */}
          <div className="relative z-10 flex items-center justify-between w-full">
            {/* Left: Audio Mic Icon with subtle, tight radiating pulse */}
            <div className="relative flex items-center justify-center w-5 h-5 shrink-0">
              {status === "listening" && (
                <motion.span
                  initial={{ scale: 1, opacity: 0.55 }}
                  animate={{ scale: [1, 1.35], opacity: [0.55, 0] }}
                  transition={{
                    repeat: Infinity,
                    duration: 1.6,
                    ease: "easeOut",
                  }}
                  className="absolute inset-0 rounded-full bg-indigo-500 dark:bg-indigo-400 pointer-events-none"
                />
              )}
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center relative transition-all duration-200 ${
                  status === "listening"
                    ? "bg-indigo-600 dark:bg-indigo-500 text-white shadow-xs shadow-indigo-500/25 ring-2 ring-indigo-200/70 dark:ring-indigo-800/60"
                    : status === "transcribing" || status === "polishing"
                      ? "bg-indigo-500 dark:bg-indigo-600 text-white animate-pulse"
                      : isDark
                        ? "bg-zinc-800 text-zinc-500 border border-zinc-700/60"
                        : "bg-slate-100 text-slate-400 border border-slate-200/60"
                }`}
              >
                <IconMicrophone
                  size={12}
                  stroke={2.2}
                  className="relative z-10"
                />
              </div>
            </div>

            {/* Right: Live timer & Cancel button */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className={`text-[11px] font-mono tabular-nums font-medium ${
                  isDark ? "text-zinc-400" : "text-slate-400"
                }`}
              >
                {formatTime(seconds)}
              </span>
              <button
                onClick={handleCancel}
                title="Cancel recording"
                aria-label="Cancel recording"
                className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                  isDark
                    ? "bg-zinc-800/90 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-400 hover:text-zinc-100 border border-zinc-700/60"
                    : "bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-500 hover:text-slate-800"
                }`}
              >
                <IconX size={12} stroke={2.5} />
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
