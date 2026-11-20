import { useState } from "react";
import {
  testMicrophone,
  testTranscribe,
  type MicTestResult,
  type TranscribeResult,
} from "../lib/tauri";
import {
  IconChevronDown,
  IconChevronUp,
  IconMicrophone,
  IconPlayerRecord,
} from "@tabler/icons-react";

export default function MicTester() {
  const [isOpen, setIsOpen] = useState(false);
  const [testingMic, setTestingMic] = useState(false);
  const [testingTranscribe, setTestingTranscribe] = useState(false);
  const [micResult, setMicResult] = useState<MicTestResult | null>(null);
  const [transcribeResult, setTranscribeResult] = useState<TranscribeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTestMic = async () => {
    try {
      setTestingMic(true);
      setError(null);
      setMicResult(null);
      const res = await testMicrophone();
      setMicResult(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setTestingMic(false);
    }
  };

  const handleTestTranscribe = async () => {
    try {
      setTestingTranscribe(true);
      setError(null);
      setTranscribeResult(null);
      const res = await testTranscribe();
      setTranscribeResult(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setTestingTranscribe(false);
    }
  };

  const peakPercent = micResult ? Math.min(100, Math.round(micResult.peak_amplitude * 100)) : 0;
  const isHealthyAudio = micResult ? micResult.peak_amplitude > 0.02 : false;
  const isBusy = testingMic || testingTranscribe;

  return (
    <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-4 border border-slate-200/90 dark:border-zinc-800/90 shadow-xs space-y-3">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between cursor-pointer select-none"
      >
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <span>Audio Diagnostics</span>
            <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400">
              {isOpen ? "Hide" : "Show"}
            </span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Test microphone capture and run a 3-second diagnostic transcription.
          </p>
        </div>
        <span className="text-slate-400 dark:text-zinc-500">
          {isOpen ? <IconChevronUp size={16} stroke={1.75} /> : <IconChevronDown size={16} stroke={1.75} />}
        </span>
      </div>

      {isOpen && (
        <div className="pt-3 border-t border-slate-100 dark:border-zinc-800 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleTestMic}
              disabled={isBusy}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
                testingMic
                  ? "bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-200 animate-pulse border border-amber-300"
                  : "bg-indigo-50 dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-zinc-700 border border-indigo-200/60 dark:border-indigo-500/30"
              }`}
            >
              <IconMicrophone size={13} stroke={1.75} />
              <span className="whitespace-nowrap">{testingMic ? "Recording 3s..." : "Test Mic (3s)"}</span>
            </button>

            <button
              onClick={handleTestTranscribe}
              disabled={isBusy}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
                testingTranscribe
                  ? "bg-indigo-600 text-white animate-pulse"
                  : "bg-indigo-600 text-white hover:bg-indigo-700"
              }`}
            >
              <IconPlayerRecord size={13} stroke={1.75} />
              <span className="whitespace-nowrap">{testingTranscribe ? "Listening & Transcribing..." : "Test Transcribe (3s)"}</span>
            </button>
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/40 text-xs text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          {micResult && (
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-900/90 border border-slate-200/80 dark:border-zinc-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-zinc-400">Peak Signal Level</span>
                <span
                  className={`font-semibold ${
                    isHealthyAudio
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {peakPercent}% {isHealthyAudio ? "(Clear)" : "(Low Audio)"}
                </span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-zinc-700 h-2 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    isHealthyAudio ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                  style={{ width: `${peakPercent}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-slate-400 dark:text-zinc-500">
                <span>Samples: {micResult.sample_count.toLocaleString()}</span>
                <span>Duration: {micResult.duration_secs.toFixed(1)}s</span>
              </div>
            </div>
          )}

          {transcribeResult && (
            <div className="p-3 rounded-xl bg-indigo-50/60 dark:bg-zinc-900 border border-indigo-200/80 dark:border-indigo-500/40 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-indigo-700 dark:text-indigo-300 font-medium">
                <span>Recognized Speech:</span>
                <span className="text-slate-400 dark:text-zinc-500">
                  {transcribeResult.duration_secs.toFixed(1)}s audio
                </span>
              </div>
              <p className="text-xs text-slate-800 dark:text-zinc-200 font-medium italic select-text">
                "{transcribeResult.transcript || "(No speech detected)"}"
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
