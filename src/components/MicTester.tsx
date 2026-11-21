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
import PrimeButton from "./PrimeButton";

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
    <div className="bg-card rounded-2xl p-4 border border-border shadow-xs space-y-3">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between cursor-pointer select-none"
      >
        <div>
          <h3 className="text-sm font-semibold text-card-foreground flex items-center gap-2">
            <span>Audio Diagnostics</span>
            <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {isOpen ? "Hide" : "Show"}
            </span>
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 font-normal">
            Test microphone capture and run a 3-second diagnostic transcription.
          </p>
        </div>
        <span className="text-muted-foreground">
          {isOpen ? <IconChevronUp size={16} stroke={1.75} /> : <IconChevronDown size={16} stroke={1.75} />}
        </span>
      </div>

      {isOpen && (
        <div className="pt-3 border-t border-border space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleTestMic}
              disabled={isBusy}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
                testingMic
                  ? "bg-foreground text-background animate-pulse font-semibold"
                  : "bg-muted text-foreground hover:bg-muted/80 border border-border"
              }`}
            >
              <IconMicrophone size={13} stroke={1.75} />
              <span className="whitespace-nowrap">{testingMic ? "Recording 3s..." : "Test Mic (3s)"}</span>
            </button>

            <PrimeButton
              onClick={handleTestTranscribe}
              disabled={isBusy}
              size="sm"
              className={testingTranscribe ? "animate-pulse" : ""}
            >
              <IconPlayerRecord size={13} stroke={1.75} />
              <span className="whitespace-nowrap">
                {testingTranscribe ? "Listening & Transcribing..." : "Test Transcribe (3s)"}
              </span>
            </PrimeButton>
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-muted border border-border text-xs text-destructive font-medium">
              {error}
            </div>
          )}

          {micResult && (
            <div className="p-3 rounded-xl bg-muted border border-border space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Peak Signal Level</span>
                <span
                  className="font-medium text-foreground"
                >
                  {peakPercent}% {isHealthyAudio ? "(Clear)" : "(Low Audio)"}
                </span>
              </div>
              <div className="w-full bg-border h-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-foreground/75 transition-all duration-300"
                  style={{ width: `${peakPercent}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Samples: {micResult.sample_count.toLocaleString()}</span>
                <span>Duration: {micResult.duration_secs.toFixed(1)}s</span>
              </div>
            </div>
          )}

          {transcribeResult && (
            <div className="p-3 rounded-xl bg-muted border border-border space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-foreground font-medium">
                <span>Recognized Speech:</span>
                <span className="text-muted-foreground">
                  {transcribeResult.duration_secs.toFixed(1)}s audio
                </span>
              </div>
              <p className="text-xs text-card-foreground font-medium italic select-text">
                "{transcribeResult.transcript || "(No speech detected)"}"
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
