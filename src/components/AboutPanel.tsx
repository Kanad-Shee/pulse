import { useState, useEffect, useRef } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  IconBrandGithub,
  IconRefresh,
  IconCheck,
  IconDownload,
  IconAlertCircle,
  IconInfoCircle,
  IconSparkles,
} from "@tabler/icons-react";
import PrimeButton from "./PrimeButton";

type UpdateState =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "error";

interface FormattedUpdateError {
  title: string;
  message: string;
  isInfo?: boolean;
}

function formatUpdateError(err: unknown): FormattedUpdateError {
  console.error("Update check failed with raw error:", err);

  const raw = (
    err instanceof Error
      ? err.message
      : typeof err === "string"
      ? err
      : JSON.stringify(err)
  ).toLowerCase();

  if (
    raw.includes("valid release json") ||
    raw.includes("404") ||
    raw.includes("not found")
  ) {
    return {
      title: "No Updates Available Yet",
      message:
        "You're running the latest available build. Future updates will appear here automatically.",
      isInfo: true,
    };
  }

  if (
    raw.includes("network") ||
    raw.includes("dns") ||
    raw.includes("connect") ||
    raw.includes("timed out") ||
    raw.includes("offline")
  ) {
    return {
      title: "Couldn't Reach Update Server",
      message: "Please check your internet connection and try again.",
      isInfo: false,
    };
  }

  if (raw.includes("signature") || raw.includes("pubkey")) {
    return {
      title: "Update Verification Failed",
      message:
        "The update package could not be verified. Try downloading directly from GitHub.",
      isInfo: false,
    };
  }

  return {
    title: "Update Check Unavailable",
    message: "Unable to check for updates right now. Please try again later.",
    isInfo: false,
  };
}

export default function AboutPanel() {
  const [version, setVersion] = useState<string>("1.1.0");
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [updateInfo, setUpdateInfo] = useState<Update | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [errorInfo, setErrorInfo] = useState<FormattedUpdateError | null>(null);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    getVersion()
      .then((ver) => {
        if (isMountedRef.current) setVersion(ver);
      })
      .catch((err) => console.warn("Failed to get app version:", err));

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleCheckForUpdates = async () => {
    setUpdateState("checking");
    setErrorInfo(null);
    try {
      const update = await check();
      if (!isMountedRef.current) return;
      if (update) {
        setUpdateInfo(update);
        setUpdateState("available");
      } else {
        setUpdateInfo(null);
        setUpdateState("up-to-date");
      }
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const formatted = formatUpdateError(err);
      setErrorInfo(formatted);
      setUpdateState("error");
    }
  };

  const handleDownloadAndInstall = async () => {
    if (!updateInfo) return;
    setUpdateState("downloading");
    setDownloadProgress(0);
    setErrorInfo(null);

    try {
      let downloaded = 0;
      let total = 0;

      await updateInfo.downloadAndInstall((event) => {
        if (!isMountedRef.current) return;
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) {
            setDownloadProgress(
              Math.min(100, Math.round((downloaded / total) * 100))
            );
          }
        } else if (event.event === "Finished") {
          setDownloadProgress(100);
        }
      });

      if (!isMountedRef.current) return;
      // Relaunch the application after successful install
      await relaunch();
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const formatted = formatUpdateError(err);
      setErrorInfo(formatted);
      setUpdateState("error");
    }
  };

  const handleOpenGitHub = async () => {
    try {
      await openUrl("https://github.com/Kanad-Shee/pulse");
    } catch (err) {
      console.error("Failed to open GitHub URL:", err);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-zinc-100">
          About Pulse
        </h2>
        <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
          Application details, open-source repository, and software updates.
        </p>
      </div>

      {/* App Info Card */}
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-200/90 dark:border-zinc-800/90 p-5 space-y-4 shadow-xs">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <img
              src="/pulse-logo.png"
              alt="Pulse Logo"
              className="w-12 h-12 object-contain shrink-0 rounded-xl"
            />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-zinc-100 tracking-tight">
                  Pulse
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-800/60">
                  v{version}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5 font-medium">
                Pulse for Windows &middot; 64-bit
              </p>
            </div>
          </div>

          <button
            onClick={handleOpenGitHub}
            title="Open Pulse repository on GitHub"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-700 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200/80 dark:hover:bg-zinc-700/80 border border-slate-200/80 dark:border-zinc-700/60 transition-colors cursor-pointer shrink-0"
          >
            <IconBrandGithub size={15} stroke={1.8} />
            <span>View on GitHub</span>
          </button>
        </div>

        <p className="text-xs text-slate-600 dark:text-zinc-300 leading-relaxed">
          100% local, zero-cloud Windows voice-to-text powered by Parakeet,
          Whisper, Canary, Nemotron, and Ollama.
        </p>
      </div>

      {/* Software Updates Card */}
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-200/90 dark:border-zinc-800/90 p-5 space-y-4 shadow-xs">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-slate-900 dark:text-zinc-100">
              Software Updates
            </h3>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
              Automated in-app updates distributed via GitHub Releases.
            </p>
          </div>

          {(updateState === "idle" ||
            updateState === "up-to-date" ||
            updateState === "error") && (
            <PrimeButton
              onClick={handleCheckForUpdates}
              size="default"
            >
              <IconRefresh size={14} stroke={2} />
              <span>Check for Updates</span>
            </PrimeButton>
          )}
        </div>

        {/* State: Checking */}
        {updateState === "checking" && (
          <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200/60 dark:border-zinc-800 text-xs text-slate-600 dark:text-zinc-300">
            <IconRefresh
              size={16}
              stroke={2}
              className="animate-spin text-indigo-600 dark:text-indigo-400 shrink-0"
            />
            <span>Checking for updates from GitHub Releases...</span>
          </div>
        )}

        {/* State: Up to date */}
        {updateState === "up-to-date" && (
          <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/50 text-xs text-emerald-800 dark:text-emerald-300">
            <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/80 flex items-center justify-center shrink-0">
              <IconCheck size={13} stroke={2.5} className="text-emerald-600 dark:text-emerald-400" />
            </span>
            <span className="font-medium">
              You're on the latest version (v{version}).
            </span>
          </div>
        )}

        {/* State: Update Available */}
        {updateState === "available" && updateInfo && (
          <div className="space-y-3 p-4 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200/80 dark:border-indigo-800/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/80 flex items-center justify-center shrink-0 text-indigo-600 dark:text-indigo-400">
                  <IconSparkles size={13} stroke={2.5} />
                </span>
                <span className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                  Update Available: v{updateInfo.version}
                </span>
              </div>

              <PrimeButton
                onClick={handleDownloadAndInstall}
                size="default"
              >
                <IconDownload size={14} stroke={2} />
                <span>Download & Install</span>
              </PrimeButton>
            </div>

            {updateInfo.body && (
              <div className="text-xs text-slate-600 dark:text-zinc-300 bg-white/80 dark:bg-zinc-900/80 p-3 rounded-lg border border-slate-200/60 dark:border-zinc-800 max-h-36 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {updateInfo.body}
              </div>
            )}
          </div>
        )}

        {/* State: Downloading & Installing */}
        {updateState === "downloading" && (
          <div className="space-y-2.5 p-4 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200/60 dark:border-zinc-800">
            <div className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-zinc-200">
              <div className="flex items-center gap-2">
                <IconDownload
                  size={15}
                  stroke={2}
                  className="animate-bounce text-indigo-600 dark:text-indigo-400"
                />
                <span>
                  {downloadProgress >= 100
                    ? "Installing update & restarting..."
                    : "Downloading update package..."}
                </span>
              </div>
              <span className="font-mono tabular-nums font-semibold text-indigo-600 dark:text-indigo-400">
                {downloadProgress}%
              </span>
            </div>

            <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
              <div
                style={{ width: `${downloadProgress}%` }}
                className="h-full bg-indigo-600 dark:bg-indigo-500 rounded-full transition-all duration-150 ease-out"
              />
            </div>
          </div>
        )}

        {/* State: Error / Notice */}
        {updateState === "error" && errorInfo && (
          errorInfo.isInfo ? (
            <div className="flex items-start justify-between gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200/60 dark:border-zinc-800 text-xs text-slate-700 dark:text-zinc-300">
              <div className="flex items-start gap-2.5 min-w-0">
                <IconInfoCircle
                  size={16}
                  stroke={2}
                  className="text-slate-500 dark:text-zinc-400 shrink-0 mt-0.5"
                />
                <div className="min-w-0 break-words">
                  <span className="font-semibold block text-slate-900 dark:text-zinc-100">
                    {errorInfo.title}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-zinc-400 block mt-0.5">
                    {errorInfo.message}
                  </span>
                </div>
              </div>

              <button
                onClick={handleCheckForUpdates}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-200/80 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 transition-colors cursor-pointer shrink-0"
              >
                Check Again
              </button>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3 p-3.5 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/50 text-xs text-amber-900 dark:text-amber-200">
              <div className="flex items-start gap-2 min-w-0">
                <IconAlertCircle
                  size={16}
                  stroke={2}
                  className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
                />
                <div className="min-w-0 break-words">
                  <span className="font-semibold block">
                    {errorInfo.title}
                  </span>
                  <span className="text-[11px] opacity-90 block mt-0.5">
                    {errorInfo.message}
                  </span>
                </div>
              </div>

              <button
                onClick={handleCheckForUpdates}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-200/80 dark:bg-amber-900/80 hover:bg-amber-300 dark:hover:bg-amber-800 text-amber-900 dark:text-amber-100 transition-colors cursor-pointer shrink-0"
              >
                Try Again
              </button>
            </div>
          )
        )}
      </div>
    </div>
  );
}
