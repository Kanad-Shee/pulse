import React, { useEffect, useState } from "react";
import { getStoredTheme, setStoredTheme, type Theme } from "../lib/theme";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  getOverlayTextStyle,
  setOverlayTextStyle,
  type OverlayTextStyle,
} from "../lib/tauri";
import { IconSun, IconMoon, IconDeviceDesktop } from "@tabler/icons-react";

export default function GeneralTab() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme());
  const [autostart, setAutostart] = useState<boolean>(false);
  const [autostartLoading, setAutostartLoading] = useState<boolean>(false);
  const [textStyle, setTextStyle] = useState<OverlayTextStyle>("normal");

  useEffect(() => {
    isEnabled()
      .then((enabled) => setAutostart(enabled))
      .catch((err) => console.warn("Failed to check autostart status:", err));

    getOverlayTextStyle()
      .then((s) => setTextStyle(s))
      .catch((err) => console.warn("Failed to check overlay text style:", err));
  }, []);

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme);
    setStoredTheme(newTheme);
  };

  const handleTextStyleChange = async (newStyle: OverlayTextStyle) => {
    setTextStyle(newStyle);
    try {
      await setOverlayTextStyle(newStyle);
    } catch (err) {
      console.error("Failed to update overlay text style:", err);
    }
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
        <h2 className="text-base font-semibold text-foreground">
          General Preferences
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Appearance, startup behavior, and application details.
        </p>
      </div>

      {/* Theme Switcher */}
      <div className="bg-card rounded-2xl border border-border p-4.5 space-y-3 shadow-xs">
        <div>
          <h3 className="text-sm font-medium text-card-foreground">
            Appearance
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Select your preferred visual style or sync with Windows.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 bg-muted p-1 rounded-xl border border-border">
          {themeOptions.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleThemeChange(item.id)}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer shrink-0 whitespace-nowrap ${
                theme === item.id
                  ? "bg-card text-foreground border border-border shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/40"
              }`}
            >
              <span className={theme === item.id ? "text-foreground" : "text-muted-foreground"}>
                {item.icon}
              </span>
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Overlay Text Style */}
      <div className="bg-card rounded-2xl border border-border p-4.5 space-y-3 shadow-xs">
        <div>
          <h3 className="text-sm font-medium text-card-foreground">
            Overlay Text Style
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose whether dictated preview text appears normal upright or italicized.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 bg-muted p-1 rounded-xl border border-border">
          <button
            type="button"
            onClick={() => handleTextStyleChange("normal")}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer shrink-0 whitespace-nowrap ${
              textStyle === "normal"
                ? "bg-card text-foreground border border-border shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-card/40"
            }`}
          >
            <span className="not-italic font-normal">Normal</span>
          </button>
          <button
            type="button"
            onClick={() => handleTextStyleChange("italic")}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer shrink-0 whitespace-nowrap ${
              textStyle === "italic"
                ? "bg-card text-foreground border border-border shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-card/40"
            }`}
          >
            <span className="italic font-normal">Italic</span>
          </button>
        </div>
      </div>

      {/* Start at Login */}
      <div className="bg-card rounded-2xl border border-border p-4.5 shadow-xs flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-card-foreground">
            Start at Login
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
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
            autostart ? "bg-foreground" : "bg-muted-foreground/30"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-sm ring-0 transition duration-200 ease-in-out ${
              autostart ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* About Box */}
      <div className="bg-card rounded-2xl border border-border p-4.5 space-y-2.5 shadow-xs text-xs text-muted-foreground">
        <div className="flex items-center justify-between text-card-foreground font-medium">
          <div className="flex items-center gap-2">
            <img src="/pulse-logo.png" alt="Pulse" className="w-4 h-4 object-contain shrink-0" />
            <span>Pulse for Windows</span>
          </div>
          <span className="font-mono text-muted-foreground">v1.2.0</span>
        </div>
        <p className="leading-relaxed">
          100% on-device speech-to-text dictation. Audio is captured locally and
          never leaves your machine. No telemetry, subscriptions, or cloud keys.
        </p>
      </div>
    </div>
  );
}
