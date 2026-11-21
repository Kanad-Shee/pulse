import { useEffect, useState } from "react";
import {
  listModels,
  downloadModel,
  cancelModelDownload,
  deleteModel,
  openModelFolder,
  onDownloadProgress,
  onDownloadCancelled,
  setActiveModel,
  getCanaryLanguages,
  setCanaryLanguages,
  type ModelInfo,
} from "../lib/tauri";
import {
  IconRefresh,
  IconDownload,
  IconTrash,
  IconCheck,
  IconWorld,
  IconWaveSine,
  IconLanguage,
  IconArrowRight,
  IconX,
  IconFolderOpen,
} from "@tabler/icons-react";
import PrimeButton from "./PrimeButton";

export default function ModelManager() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [canarySource, setCanarySource] = useState<string>("en");
  const [canaryTarget, setCanaryTarget] = useState<string>("en");

  const fetchModels = async () => {
    try {
      setLoading(true);
      const [list, canaryLangs] = await Promise.all([
        listModels(),
        getCanaryLanguages().catch(() => ["en", "en"] as [string, string]),
      ]);
      setModels(list);
      setCanarySource(canaryLangs[0] || "en");
      setCanaryTarget(canaryLangs[1] || "en");
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let unlistenProgress: (() => void) | null = null;
    let unlistenCancel: (() => void) | null = null;

    fetchModels();

    onDownloadProgress((payload) => {
      if (cancelled) return;
      setProgressMap((prev) => ({
        ...prev,
        [payload.model_id]: Math.min(100, Math.max(0, payload.percent)),
      }));
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenProgress = fn;
      }
    });

    onDownloadCancelled((payload) => {
      if (cancelled) return;
      setDownloadingId((current) => (current === payload.model_id ? null : current));
      setProgressMap((prev) => {
        const copy = { ...prev };
        delete copy[payload.model_id];
        return copy;
      });
      fetchModels();
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenCancel = fn;
      }
    });

    return () => {
      cancelled = true;
      if (unlistenProgress) {
        unlistenProgress();
        unlistenProgress = null;
      }
      if (unlistenCancel) {
        unlistenCancel();
        unlistenCancel = null;
      }
    };
  }, []);

  const handleDownload = async (modelId: string) => {
    try {
      setDownloadingId(modelId);
      setProgressMap((prev) => ({ ...prev, [modelId]: 0 }));
      setErrorMessage(null);
      await downloadModel(modelId);
      await fetchModels();
    } catch (err) {
      setErrorMessage(String(err));
    } finally {
      setDownloadingId((current) => (current === modelId ? null : current));
      setProgressMap((prev) => {
        const copy = { ...prev };
        delete copy[modelId];
        return copy;
      });
    }
  };

  const handleCancelDownload = async (modelId: string) => {
    try {
      setErrorMessage(null);
      await cancelModelDownload(modelId);
      setDownloadingId(null);
      setProgressMap((prev) => {
        const copy = { ...prev };
        delete copy[modelId];
        return copy;
      });
      await fetchModels();
    } catch (err) {
      setErrorMessage(String(err));
    }
  };

  const handleOpenFolder = async (modelId: string) => {
    try {
      setErrorMessage(null);
      await openModelFolder(modelId);
    } catch (err) {
      setErrorMessage(String(err));
    }
  };

  const handleDelete = async (modelId: string) => {
    try {
      setErrorMessage(null);
      await deleteModel(modelId);
      await fetchModels();
    } catch (err) {
      setErrorMessage(String(err));
    }
  };

  const handleSelect = async (modelId: string) => {
    try {
      setErrorMessage(null);
      await setActiveModel(modelId);
      await fetchModels();
    } catch (err) {
      setErrorMessage(String(err));
    }
  };

  const handleCanaryLangChange = async (src: string, tgt: string) => {
    try {
      setCanarySource(src);
      setCanaryTarget(tgt);
      await setCanaryLanguages(src, tgt);
    } catch (err) {
      setErrorMessage(String(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900 dark:text-zinc-100">
            Speech Models
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Local ONNX & GGML models &bull; Zero network latency during dictation
          </p>
        </div>
        <button
          onClick={fetchModels}
          disabled={loading || !!downloadingId}
          className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium disabled:opacity-50 cursor-pointer shrink-0 whitespace-nowrap"
        >
          <IconRefresh size={13} stroke={1.75} className={loading ? "animate-spin" : ""} />
          <span className="whitespace-nowrap">Refresh</span>
        </button>
      </div>

      {errorMessage && (
        <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/40 text-xs text-rose-700 dark:text-rose-300 break-words">
          {errorMessage}
        </div>
      )}

      {loading && models.length === 0 ? (
        <div className="p-6 text-center text-xs text-slate-400 dark:text-zinc-500">Loading models...</div>
      ) : (
        <div className="space-y-3">
          {models.map((model) => {
            const isDownloading = downloadingId === model.id;
            const progress = progressMap[model.id] ?? 0;

            return (
              <div
                key={model.id}
                className={`p-3.5 rounded-2xl border transition-all ${
                  model.is_active
                    ? "border-indigo-400 dark:border-indigo-500/80 bg-indigo-50/40 dark:bg-zinc-900 ring-1 ring-indigo-200 dark:ring-indigo-500/30"
                    : "border-slate-200/90 dark:border-zinc-800/90 bg-white dark:bg-[#1a1a1a] shadow-2xs"
                }`}
              >
                {/* Header row: Left title & badge, Right accuracy & speed progress bars */}
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                        {model.name}
                      </span>
                      {model.is_recommended && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                          Recommended
                        </span>
                      )}
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase font-semibold ${
                          model.engine === "parakeet" || model.engine === "nemotron"
                            ? "bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300"
                            : model.engine === "canary"
                            ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
                            : "bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300"
                        }`}
                      >
                        {model.engine}
                      </span>
                      {model.is_active && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-600 text-white shadow-xs">
                          <IconCheck size={11} stroke={2.5} />
                          <span>Active</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 leading-snug line-clamp-1">
                      {model.subtitle || model.description}
                    </p>
                  </div>

                  {/* Accuracy & Speed horizontal progress bars */}
                  <div className="flex flex-col gap-1 w-28 shrink-0">
                    <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-zinc-400 font-medium">
                      <span>Accuracy</span>
                      <span className="font-mono text-slate-700 dark:text-zinc-300">{model.accuracy}%</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${model.accuracy}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-zinc-400 font-medium mt-0.5">
                      <span>Speed</span>
                      <span className="font-mono text-slate-700 dark:text-zinc-300">{model.speed}%</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${model.speed}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Canary Language Pair Selector (if Canary is downloaded or active) */}
                {model.id === "canary-180m-flash" && model.is_downloaded && (
                  <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-zinc-800/80 flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-slate-600 dark:text-zinc-400">
                      <IconLanguage size={14} className="text-indigo-500" />
                      <span className="font-medium text-[11px]">Translation Language:</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={canarySource}
                        onChange={(e) => handleCanaryLangChange(e.target.value, canaryTarget)}
                        className="text-xs bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-md px-1.5 py-0.5 text-slate-800 dark:text-zinc-200 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                        title="Source Language"
                      >
                        <option value="en">EN (English)</option>
                        <option value="es">ES (Spanish)</option>
                        <option value="de">DE (German)</option>
                        <option value="fr">FR (French)</option>
                      </select>
                      <IconArrowRight size={12} className="text-slate-400 shrink-0" />
                      <select
                        value={canaryTarget}
                        onChange={(e) => handleCanaryLangChange(canarySource, e.target.value)}
                        className="text-xs bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-md px-1.5 py-0.5 text-slate-800 dark:text-zinc-200 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                        title="Target Language"
                      >
                        <option value="en">EN (English)</option>
                        <option value="es">ES (Spanish)</option>
                        <option value="de">DE (German)</option>
                        <option value="fr">FR (French)</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Bottom row: Metadata chips on Left, Size & Action buttons on Right */}
                <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-zinc-800/80 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300">
                      <IconWorld size={12} stroke={1.75} />
                      <span>{model.languages}</span>
                    </span>

                    {model.is_streaming && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200/60 dark:border-sky-800/60">
                        <IconWaveSine size={12} stroke={1.75} />
                        <span>Streaming</span>
                      </span>
                    )}

                    {model.can_translate && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60">
                        <IconLanguage size={12} stroke={1.75} />
                        <span>Translate</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-auto">
                    <span className="text-[11px] text-slate-400 dark:text-zinc-500 whitespace-nowrap">
                      ~{model.size_mb} MB
                    </span>

                    {model.is_downloaded ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleOpenFolder(model.id)}
                          className="p-1 text-slate-400 hover:text-indigo-600 dark:text-zinc-400 dark:hover:text-indigo-400 rounded-md transition-colors cursor-pointer shrink-0"
                          title="Open file location"
                        >
                          <IconFolderOpen size={14} stroke={1.75} />
                        </button>
                        {!model.is_active && (
                          <button
                            onClick={() => handleSelect(model.id)}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-50 dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-zinc-700 border border-indigo-200/60 dark:border-indigo-500/30 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                          >
                            <span className="whitespace-nowrap">Use Model</span>
                          </button>
                        )}
                        {!model.is_active && (
                          <button
                            onClick={() => handleDelete(model.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-400 rounded-md transition-colors cursor-pointer shrink-0"
                            title="Delete model"
                          >
                            <IconTrash size={14} stroke={1.75} />
                          </button>
                        )}
                      </div>
                    ) : isDownloading ? (
                      <button
                        onClick={() => handleCancelDownload(model.id)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-900/50 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                        title="Cancel download"
                      >
                        <IconX size={13} stroke={2} />
                        <span className="whitespace-nowrap">Cancel</span>
                      </button>
                    ) : (
                      <PrimeButton
                        onClick={() => handleDownload(model.id)}
                        disabled={!!downloadingId}
                        size="xs"
                      >
                        <IconDownload size={13} stroke={1.75} />
                        <span className="whitespace-nowrap">Download</span>
                      </PrimeButton>
                    )}
                  </div>
                </div>

                {/* Download Progress Bar with Cancel Action */}
                {isDownloading && (
                  <div className="mt-3 space-y-1.5 p-2 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200/60 dark:border-zinc-800">
                    <div className="w-full bg-slate-200 dark:bg-zinc-700 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-indigo-600 h-full transition-all duration-150"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-400 font-mono">
                      <span>Downloading model files... {progress.toFixed(0)}%</span>
                      <button
                        onClick={() => handleCancelDownload(model.id)}
                        className="inline-flex items-center gap-1 text-[11px] text-rose-600 hover:text-rose-700 dark:text-rose-400 font-medium px-1.5 py-0.5 rounded hover:bg-rose-100/60 dark:hover:bg-rose-950/60 transition-colors cursor-pointer"
                        title="Cancel download"
                      >
                        <IconX size={12} stroke={2} />
                        <span>Cancel</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
