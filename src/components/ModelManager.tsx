import { useEffect, useState } from "react";
import {
  listModels,
  downloadModel,
  deleteModel,
  setActiveModel,
  onDownloadProgress,
  type ModelInfo,
} from "../lib/tauri";
import {
  IconRefresh,
  IconDownload,
  IconTrash,
  IconCheck,
} from "@tabler/icons-react";

export default function ModelManager() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchModels = async () => {
    try {
      setLoading(true);
      const list = await listModels();
      setModels(list);
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();

    let unlisten: (() => void) | undefined;
    onDownloadProgress((payload) => {
      setProgressMap((prev) => ({
        ...prev,
        [payload.model_id]: Math.min(100, Math.max(0, payload.percent)),
      }));
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
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
      setDownloadingId(null);
      setProgressMap((prev) => {
        const copy = { ...prev };
        delete copy[modelId];
        return copy;
      });
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
        <div className="space-y-2.5">
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
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium text-slate-900 dark:text-zinc-100">
                        {model.name}
                      </span>
                      {model.is_recommended && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                          Recommended
                        </span>
                      )}
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase font-semibold ${
                          model.engine === "parakeet"
                            ? "bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300"
                            : "bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300"
                        }`}
                      >
                        {model.engine}
                      </span>
                      {model.is_active && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-600 text-white">
                          <IconCheck size={11} stroke={2.5} />
                          <span>Active</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-zinc-400">{model.description}</p>
                    <p className="text-[11px] text-slate-400 dark:text-zinc-500">
                      Size: ~{model.size_mb} MB
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
                    {model.is_downloaded ? (
                      <>
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
                      </>
                    ) : (
                      <button
                        onClick={() => handleDownload(model.id)}
                        disabled={isDownloading || !!downloadingId}
                        className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                      >
                        <IconDownload size={13} stroke={1.75} />
                        <span className="whitespace-nowrap">{isDownloading ? "Downloading..." : "Download"}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Download Progress Bar */}
                {isDownloading && (
                  <div className="mt-3 space-y-1">
                    <div className="w-full bg-slate-100 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-indigo-600 h-full transition-all duration-150"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400 dark:text-zinc-500">
                      <span>Downloading from Hugging Face...</span>
                      <span>{progress}%</span>
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
