import React, { useEffect, useState } from "react";
import { getStoredTheme, setStoredTheme, type Theme } from "../lib/theme";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { IconSun, IconMoon, IconDeviceDesktop } from "@tabler/icons-react";

export default function GeneralTab() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme());
  const [autostart, setAutostart] = useState<boolean>(false);
  const [autostartLoading, setAutostartLoading] = useState<boolean>(false);

  useEffect(() => {
    isEnabled()
      .then((enabled) => setAutostart(enabled))
      .catch((err) => console.warn("Failed to check autostart status:", err));
  }, []);

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme);
    setStoredTheme(newTheme);
  };

  const handleToggleAutostart = async () => {
    try {
      setAutostartLoading(true);
      if (autostart) {
        await disable();
        setAutostart(false);
      } else {
        await enable();
        setAutostart(true);
      }
    } catch (err) {
      console.error("Failed to toggle autostart:", err);
    } finally {
      setAutostartLoading(false);
    }
  };

  const themeOptions: { id: Theme; label: string; icon: React.ReactNode }[] = [
    { id: "system", label: "System", icon: <IconDeviceDesktop size={15} stroke={1.75} /> },
    { id: "light", label: "Light", icon: <IconSun size={15} stroke={1.75} /> },
    { id: "dark", label: "Dark", icon: <IconMoon size={15} stroke={1.75} /> },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-zinc-100">
          General Preferences
        </h2>
        <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
          Appearance, startup behavior, and application details.
        </p>
      </div>

      {/* Theme Switcher */}
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-200/90 dark:border-zinc-800/90 p-4.5 space-y-3 shadow-xs">
        <div>
          <h3 className="text-sm font-medium text-slate-900 dark:text-zinc-100">
            Appearance
          </h3>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Select your preferred visual style or sync with Windows.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 bg-slate-100 dark:bg-zinc-900/90 p-1 rounded-xl border border-slate-200/60 dark:border-zinc-800">
          {themeOptions.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleThemeChange(item.id)}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer shrink-0 whitespace-nowrap ${
                theme === item.id
                  ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 border border-slate-200/50 dark:border-indigo-500/40 shadow-xs font-semibold"
                  : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200"
              }`}
            >
              <span className={theme === item.id ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-zinc-400"}>
                {item.icon}
              </span>
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Start at Login */}
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-200/90 dark:border-zinc-800/90 p-4.5 shadow-xs flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-slate-900 dark:text-zinc-100">
            Start at Login
          </h3>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Automatically launch Pulse silently in the system tray when Windows boots.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={autostart}
          disabled={autostartLoading}
          onClick={handleToggleAutostart}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
            autostart ? "bg-indigo-600" : "bg-slate-300 dark:bg-zinc-700"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
              autostart ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* About Box */}
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-200/90 dark:border-zinc-800/90 p-4.5 space-y-2.5 shadow-xs text-xs text-slate-500 dark:text-zinc-400">
        <div className="flex items-center justify-between text-slate-700 dark:text-zinc-300 font-medium">
          <div className="flex items-center gap-2">
            <img src="/pulse-logo.png" alt="Pulse" className="w-4 h-4 rounded-md object-contain shrink-0" />
            <span>Pulse for Windows</span>
          </div>
          <span className="font-mono text-slate-400 dark:text-zinc-500">v1.0.0</span>
        </div>
        <p className="leading-relaxed">
          100% on-device speech-to-text dictation. Audio is captured locally and
          never leaves your machine. No telemetry, subscriptions, or cloud keys.
        </p>
      </div>
    </div>
  );
}
