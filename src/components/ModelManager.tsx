import { useEffect, useState, useMemo } from "react";
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
  IconSearch,
} from "@tabler/icons-react";
import PrimeButton from "./PrimeButton";

export default function ModelManager() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filters state
  const [searchQuery, setSearchQuery] = useState("");
  const [streamingOnly, setStreamingOnly] = useState(false);
  const [languageFilter, setLanguageFilter] = useState<"all" | "en" | "multilingual">("all");

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

  // Filtered models list
  const filteredModels = useMemo(() => {
    return models.filter((model) => {
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesName = model.name.toLowerCase().includes(q);
        const matchesDesc = (model.description || "").toLowerCase().includes(q);
        const matchesSub = (model.subtitle || "").toLowerCase().includes(q);
        const matchesEngine = model.engine.toLowerCase().includes(q);
        const matchesLangs = (model.languages || "").toLowerCase().includes(q);
        if (!matchesName && !matchesDesc && !matchesSub && !matchesEngine && !matchesLangs) {
          return false;
        }
      }

      // Streaming filter
      const isStreaming = model.is_streaming || (model as { streaming?: boolean }).streaming;
      if (streamingOnly && !isStreaming) {
        return false;
      }

      // Language filter
      const isEnglish =
        model.languages.toLowerCase().includes("english only") ||
        model.languages.toLowerCase() === "english";

      if (languageFilter === "en" && !isEnglish) {
        return false;
      }
      if (languageFilter === "multilingual" && isEnglish) {
        return false;
      }

      return true;
    });
  }, [models, searchQuery, streamingOnly, languageFilter]);

  // Split into Downloaded and Available
  const downloadedModels = useMemo(() => {
    const list = filteredModels.filter((m) => m.is_downloaded);
    // Keep active model at the very top of downloaded list
    return list.sort((a, b) => (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0));
  }, [filteredModels]);

  const availableModels = useMemo(() => {
    return filteredModels.filter((m) => !m.is_downloaded);
  }, [filteredModels]);

  const hasActiveFilters = searchQuery !== "" || streamingOnly || languageFilter !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setStreamingOnly(false);
    setLanguageFilter("all");
  };

  const renderModelCard = (model: ModelInfo) => {
    const isDownloading = downloadingId === model.id;
    const progress = progressMap[model.id] ?? 0;
    const isStreaming = model.is_streaming || (model as { streaming?: boolean }).streaming;

    return (
      <div
        key={model.id}
        className={`p-3.5 rounded-2xl border transition-all ${
          model.is_active
            ? "border-border bg-muted/40 shadow-xs ring-1 ring-border"
            : "border-border bg-card shadow-2xs"
        }`}
      >
        {/* Header row: Left title & badges, Right accuracy & speed progress bars */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-semibold text-card-foreground">
                {model.name}
              </span>
              {model.is_active && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary text-white border border-primary shadow-xs">
                  <IconCheck size={11} stroke={2.5} />
                  <span>Active</span>
                </span>
              )}
              {model.is_recommended && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-foreground border border-border">
                  Recommended
                </span>
              )}
              {(model.id.includes("large") || model.name.toLowerCase().includes("large")) && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25">
                  Slow on CPU
                </span>
              )}
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase font-medium bg-muted text-muted-foreground border border-border">
                {model.engine}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-snug line-clamp-1 font-normal">
              {model.subtitle || model.description}
            </p>
          </div>

          {/* Accuracy & Speed horizontal progress bars */}
          <div className="flex flex-col gap-1 w-28 shrink-0">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground font-medium">
              <span>Accuracy</span>
              <span className="font-mono text-card-foreground font-medium">{model.accuracy}%</span>
            </div>
            <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-foreground/75 h-full rounded-full transition-all duration-300"
                style={{ width: `${model.accuracy}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[10px] text-muted-foreground font-medium mt-0.5">
              <span>Speed</span>
              <span className="font-mono text-card-foreground font-medium">{model.speed}%</span>
            </div>
            <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-foreground/75 h-full rounded-full transition-all duration-300"
                style={{ width: `${model.speed}%` }}
              />
            </div>
          </div>
        </div>

        {/* Canary Language Pair Selector (if Canary is downloaded or active) */}
        {model.id === "canary-180m-flash" && model.is_downloaded && (
          <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <IconLanguage size={14} className="text-foreground" />
              <span className="font-medium text-[11px]">Translation Language:</span>
            </div>
            <div className="flex items-center gap-1.5">
              <select
                value={canarySource}
                onChange={(e) => handleCanaryLangChange(e.target.value, canaryTarget)}
                className="text-xs bg-muted border border-border rounded-md px-1.5 py-0.5 text-foreground font-medium focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
                title="Source Language"
              >
                <option value="en">EN (English)</option>
                <option value="es">ES (Spanish)</option>
                <option value="de">DE (German)</option>
                <option value="fr">FR (French)</option>
              </select>
              <IconArrowRight size={12} className="text-muted-foreground shrink-0" />
              <select
                value={canaryTarget}
                onChange={(e) => handleCanaryLangChange(canarySource, e.target.value)}
                className="text-xs bg-muted border border-border rounded-md px-1.5 py-0.5 text-foreground font-medium focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
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
        <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-muted text-muted-foreground border border-border">
              <IconWorld size={12} stroke={1.75} />
              <span>{model.languages}</span>
            </span>

            {isStreaming && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-muted text-foreground border border-border">
                <IconWaveSine size={12} stroke={1.75} />
                <span>Streaming</span>
              </span>
            )}

            {model.can_translate && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-muted text-foreground border border-border">
                <IconLanguage size={12} stroke={1.75} />
                <span>Translate</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              ~{model.size_mb} MB
            </span>

            {model.is_downloaded ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleOpenFolder(model.id)}
                  className="p-1 text-muted-foreground hover:text-foreground rounded-md transition-colors cursor-pointer shrink-0"
                  title="Open file location"
                >
                  <IconFolderOpen size={14} stroke={1.75} />
                </button>
                {!model.is_active && (
                  <button
                    onClick={() => handleSelect(model.id)}
                    className="px-2.5 py-1 text-xs font-medium rounded-lg bg-muted text-foreground hover:bg-muted/80 border border-border transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    <span className="whitespace-nowrap">Use Model</span>
                  </button>
                )}
                {!model.is_active && (
                  <button
                    onClick={() => handleDelete(model.id)}
                    className="p-1 text-muted-foreground hover:text-destructive rounded-md transition-colors cursor-pointer shrink-0"
                    title="Delete model"
                  >
                    <IconTrash size={14} stroke={1.75} />
                  </button>
                )}
              </div>
            ) : isDownloading ? (
              <button
                onClick={() => handleCancelDownload(model.id)}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-muted text-foreground hover:bg-muted/80 border border-border transition-colors cursor-pointer shrink-0 whitespace-nowrap"
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
          <div className="mt-3 space-y-1.5 p-2 rounded-xl bg-muted border border-border">
            <div className="w-full bg-border h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-foreground h-full transition-all duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono">
              <span>Downloading model files... {progress.toFixed(0)}%</span>
              <button
                onClick={() => handleCancelDownload(model.id)}
                className="inline-flex items-center gap-1 text-[11px] text-destructive font-medium px-1.5 py-0.5 rounded hover:bg-muted/60 transition-colors cursor-pointer"
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
  };

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">
            Speech Models
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Local ONNX & GGML models &bull; Zero network latency during dictation
          </p>
        </div>
        <button
          onClick={fetchModels}
          disabled={loading || !!downloadingId}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium disabled:opacity-50 cursor-pointer shrink-0 whitespace-nowrap"
        >
          <IconRefresh size={13} stroke={1.75} className={loading ? "animate-spin" : ""} />
          <span className="whitespace-nowrap">Refresh</span>
        </button>
      </div>

      {/* Top Filter Bar */}
      <div className="p-2.5 rounded-2xl border border-border bg-card shadow-xs flex flex-wrap items-center gap-2">
        {/* Search input */}
        <div className="relative flex-1 min-w-[180px]">
          <IconSearch
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search models..."
            className="w-full text-xs pl-8 pr-7 py-1.5 rounded-xl bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-normal"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <IconX size={12} stroke={2} />
            </button>
          )}
        </div>

        {/* Streaming-only toggle */}
        <button
          onClick={() => setStreamingOnly((prev) => !prev)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer shrink-0 ${
            streamingOnly
              ? "bg-muted text-foreground border-border font-semibold shadow-xs"
              : "bg-transparent text-muted-foreground hover:text-foreground border-border/60 hover:border-border"
          }`}
          title="Show only models supporting live streaming"
        >
          <IconWaveSine size={14} stroke={streamingOnly ? 2 : 1.75} />
          <span>Streaming only</span>
        </button>

        {/* Language selector */}
        <div className="shrink-0">
          <select
            value={languageFilter}
            onChange={(e) => setLanguageFilter(e.target.value as "all" | "en" | "multilingual")}
            className="text-xs bg-muted border border-border rounded-xl px-2.5 py-1.5 text-foreground font-medium focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
          >
            <option value="all">All Languages</option>
            <option value="en">English only</option>
            <option value="multilingual">Multilingual</option>
          </select>
        </div>

        {/* Clear filters shortcut button if any active */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-[11px] text-muted-foreground hover:text-foreground underline cursor-pointer px-1 py-1 shrink-0 font-medium"
          >
            Reset
          </button>
        )}
      </div>

      {errorMessage && (
        <div className="p-2.5 rounded-lg bg-muted border border-border text-xs text-destructive break-words font-medium">
          {errorMessage}
        </div>
      )}

      {loading && models.length === 0 ? (
        <div className="p-6 text-center text-xs text-muted-foreground">
          Loading models...
        </div>
      ) : filteredModels.length === 0 ? (
        <div className="p-8 text-center rounded-2xl border border-dashed border-border text-xs text-muted-foreground space-y-2">
          <p>No models match your current search or filters.</p>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-foreground font-medium underline cursor-pointer"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Section: Downloaded Models */}
          {downloadedModels.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between px-0.5">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Downloaded Models
                  </h3>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-medium bg-muted text-foreground border border-border">
                    {downloadedModels.length}
                  </span>
                </div>
              </div>
              <div className="space-y-3">
                {downloadedModels.map(renderModelCard)}
              </div>
            </div>
          )}

          {/* Section: Available to Download */}
          {availableModels.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between px-0.5">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Available to Download
                  </h3>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-medium bg-muted text-muted-foreground border border-border">
                    {availableModels.length}
                  </span>
                </div>
              </div>
              <div className="space-y-3">
                {availableModels.map(renderModelCard)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
