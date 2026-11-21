import { useEffect, useState, useRef } from "react";
import {
  getHistory,
  deleteHistoryItem,
  clearHistory,
  getHistoryLimit,
  setHistoryLimit,
  onHistoryUpdated,
  type HistoryItem,
} from "../lib/tauri";
import {
  IconHistory,
  IconCopy,
  IconCheck,
  IconTrash,
} from "@tabler/icons-react";

export default function HistoryTab() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [limit, setLimit] = useState<number>(10);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    Promise.all([getHistory(), getHistoryLimit()])
      .then(([items, lim]) => {
        if (!cancelled) {
          setHistory(items);
          setLimit(lim);
        }
      })
      .catch((err) => console.error("Failed to load history data:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    onHistoryUpdated((items) => {
      if (!cancelled) setHistory(items);
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
      if (copyTimeoutRef.current !== null) {
        clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = null;
      }
    };
  }, []);

  const handleLimitChange = async (newLimit: number) => {
    const clamped = Math.max(1, Math.min(30, newLimit));
    setLimit(clamped);
    try {
      await setHistoryLimit(clamped);
    } catch (err) {
      console.error("Failed to set history limit:", err);
    }
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      if (copyTimeoutRef.current !== null) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedId(null);
        copyTimeoutRef.current = null;
      }, 2000);
    } catch (err) {
      console.error("Failed to copy text:", err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const updated = await deleteHistoryItem(id);
      setHistory(updated);
    } catch (err) {
      console.error("Failed to delete history item:", err);
    }
  };

  const handleClearAll = async () => {
    if (history.length === 0) return;
    try {
      await clearHistory();
      setHistory([]);
    } catch (err) {
      console.error("Failed to clear history:", err);
    }
  };

  const formatRelativeTime = (timestamp: number) => {
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.max(0, now - timestamp);

    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <div className="space-y-5">
      {/* Header with Title & Action Controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900 dark:text-zinc-100">
            Transcription History
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Locally saved dictations. Accessible via tray "Copy Last Conversation".
          </p>
        </div>

        {history.length > 0 && (
          <button
            onClick={handleClearAll}
            className="flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
          >
            <IconTrash size={13} stroke={1.75} />
            <span className="whitespace-nowrap">Clear All</span>
          </button>
        )}
      </div>

      {/* History Limit Stepper Card */}
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-200/90 dark:border-zinc-800/90 p-4 shadow-xs flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-slate-900 dark:text-zinc-100">
            Max Stored Transcriptions
          </h3>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Auto-discards older items when limit is exceeded (1 to 30 items).
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <input
            type="range"
            min={1}
            max={30}
            value={limit}
            onChange={(e) => handleLimitChange(Number(e.target.value))}
            className="w-24 accent-indigo-600 cursor-pointer"
          />
          <span className="w-8 text-center text-xs font-mono font-semibold text-slate-700 dark:text-zinc-200 bg-slate-100 dark:bg-zinc-800 py-1 rounded-md border border-slate-200/60 dark:border-zinc-700/60">
            {limit}
          </span>
        </div>
      </div>

      {/* History Item List */}
      <div className="space-y-2.5">
        {loading ? (
          <div className="text-center py-8 text-xs text-slate-400 dark:text-zinc-500">Loading history...</div>
        ) : history.length === 0 ? (
          <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-dashed border-slate-200 dark:border-zinc-800 p-8 text-center space-y-2">
            <IconHistory size={36} stroke={1.5} className="text-slate-400 dark:text-zinc-500 mx-auto" />
            <div className="text-sm font-medium text-slate-700 dark:text-zinc-300">
              No transcriptions yet
            </div>
            <p className="text-xs text-slate-400 dark:text-zinc-500 max-w-xs mx-auto">
              Hold or toggle your push-to-talk hotkey to dictate text into any application.
            </p>
          </div>
        ) : (
          history.map((item) => (
            <div
              key={item.id}
              className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-200/80 dark:border-zinc-800/80 p-4 space-y-2.5 shadow-2xs hover:border-slate-300 dark:hover:border-zinc-700 transition-colors group"
            >
              <div className="flex items-center justify-between text-xs text-slate-400 dark:text-zinc-400">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 border border-indigo-200/50 dark:border-indigo-500/30 font-mono text-[11px] font-medium">
                    {item.model_id.includes("parakeet") ? "Parakeet TDT" : "Whisper"}
                  </span>
                  <span className="text-[11px] text-slate-400 dark:text-zinc-500">
                    {formatRelativeTime(item.timestamp)}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 opacity-90 group-hover:opacity-100 transition-opacity shrink-0 whitespace-nowrap">
                  <button
                    onClick={() => handleCopy(item.id, item.text)}
                    title="Copy text"
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 border border-transparent dark:border-zinc-700/60 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    {copiedId === item.id ? (
                      <>
                        <IconCheck size={12} stroke={2} className="text-emerald-500" />
                        <span className="whitespace-nowrap">Copied</span>
                      </>
                    ) : (
                      <>
                        <IconCopy size={12} stroke={1.75} />
                        <span className="whitespace-nowrap">Copy</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleDelete(item.id)}
                    title="Delete entry"
                    className="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer shrink-0"
                  >
                    <IconTrash size={13} stroke={1.75} />
                  </button>
                </div>
              </div>

              <p className="text-xs text-slate-800 dark:text-zinc-200 leading-relaxed select-text whitespace-pre-wrap">
                {item.text}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
