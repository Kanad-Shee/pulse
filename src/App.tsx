import React, { useState } from "react";
import GeneralTab from "./components/GeneralTab";
import HotkeyPicker from "./components/HotkeyPicker";
import PostProcessPanel from "./components/PostProcessPanel";
import ModelManager from "./components/ModelManager";
import MicTester from "./components/MicTester";
import HistoryTab from "./components/HistoryTab";
import { getStoredTheme, setStoredTheme, type Theme } from "./lib/theme";
import {
  IconSettings,
  IconKeyboard,
  IconSparkles,
  IconCpu,
  IconHistory,
  IconSun,
  IconMoon,
  IconDeviceDesktop,
} from "@tabler/icons-react";

type TabId = "general" | "shortcut" | "postprocess" | "models" | "history";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const [currentTheme, setCurrentTheme] = useState<Theme>(getStoredTheme());

  const handleCycleTheme = () => {
    const nextTheme: Theme =
      currentTheme === "system" ? "dark" : currentTheme === "dark" ? "light" : "system";
    setCurrentTheme(nextTheme);
    setStoredTheme(nextTheme);
  };

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "general", label: "General", icon: <IconSettings size={18} stroke={1.75} /> },
    { id: "shortcut", label: "Shortcut", icon: <IconKeyboard size={18} stroke={1.75} /> },
    { id: "postprocess", label: "Post-Process", icon: <IconSparkles size={18} stroke={1.75} /> },
    { id: "models", label: "Models", icon: <IconCpu size={18} stroke={1.75} /> },
    { id: "history", label: "History", icon: <IconHistory size={18} stroke={1.75} /> },
  ];

  const renderThemeIcon = () => {
    switch (currentTheme) {
      case "dark":
        return <IconMoon size={15} stroke={1.75} />;
      case "light":
        return <IconSun size={15} stroke={1.75} />;
      default:
        return <IconDeviceDesktop size={15} stroke={1.75} />;
    }
  };

  return (
    <div className="w-screen h-screen flex bg-slate-50 dark:bg-[#141414] text-slate-800 dark:text-zinc-100 select-none overflow-hidden font-sans">
      {/* Left Sidebar (w-52 fixed) */}
      <aside className="w-52 shrink-0 border-r border-slate-200/90 dark:border-zinc-800/90 flex flex-col justify-between p-3.5 bg-white dark:bg-[#1a1a1a] shadow-2xs">
        <div className="space-y-3">
          {/* App Header (Logo & Name) */}
          <div className="flex items-center space-x-2.5 px-1 py-1">
            <img
              src="/pulse-logo.png"
              alt="Pulse Logo"
              className="w-8 h-8 rounded-xl object-contain shadow-2xs shrink-0"
            />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-slate-900 dark:text-zinc-100 tracking-tight">
                  Pulse
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-medium">
                Local Dictation
              </p>
            </div>
          </div>

          {/* Dashed Separator Line */}
          <div className="border-b border-dashed border-slate-200 dark:border-zinc-800 mx-1" />

          {/* Navigation Tabs (Vertical List) */}
          <nav className="space-y-1">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer shrink-0 whitespace-nowrap ${
                    isActive
                      ? "bg-indigo-50 dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-500/50 shadow-2xs font-semibold"
                      : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 hover:bg-slate-100/70 dark:hover:bg-zinc-800/60 border border-transparent"
                  }`}
                >
                  <span className={isActive ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-zinc-400"}>
                    {tab.icon}
                  </span>
                  <span className="whitespace-nowrap">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom of Sidebar: Theme Toggle */}
        <div className="pt-3 border-t border-slate-100 dark:border-zinc-800">
          <button
            onClick={handleCycleTheme}
            title="Click to toggle theme (System → Dark → Light)"
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200/80 dark:hover:bg-zinc-700/80 text-slate-700 dark:text-zinc-200 border border-slate-200/70 dark:border-zinc-700/60 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
          >
            <span className="flex items-center gap-1.5 text-[11px] whitespace-nowrap">
              <span className="text-slate-600 dark:text-zinc-400 shrink-0">{renderThemeIcon()}</span>
              <span className="capitalize whitespace-nowrap">{currentTheme}</span>
            </span>
            <span className="text-[10px] text-slate-400 dark:text-zinc-500 uppercase tracking-wider font-medium shrink-0 whitespace-nowrap">
              Theme
            </span>
          </button>
        </div>
      </aside>

      {/* Right Main Content Panel */}
      <main className="flex-1 h-full overflow-y-auto p-6 bg-slate-50/60 dark:bg-[#141414]">
        <div className="max-w-2xl mx-auto">
          {activeTab === "general" && <GeneralTab />}
          {activeTab === "shortcut" && <HotkeyPicker />}
          {activeTab === "postprocess" && <PostProcessPanel />}
          {activeTab === "models" && (
            <div className="space-y-6">
              <ModelManager />
              <MicTester />
            </div>
          )}
          {activeTab === "history" && <HistoryTab />}
        </div>
      </main>
    </div>
  );
}
