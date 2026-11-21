import React, { useState } from "react";
import GeneralTab from "./components/GeneralTab";
import HotkeyPicker from "./components/HotkeyPicker";
import PostProcessPanel from "./components/PostProcessPanel";
import ModelManager from "./components/ModelManager";
import MicTester from "./components/MicTester";
import HistoryTab from "./components/HistoryTab";
import AdvancedPanel from "./components/AdvancedPanel";
import AboutPanel from "./components/AboutPanel";
import { getStoredTheme, setStoredTheme, type Theme } from "./lib/theme";
import {
  IconSettings,
  IconKeyboard,
  IconSparkles,
  IconCpu,
  IconHistory,
  IconAdjustments,
  IconInfoCircle,
  IconSun,
  IconMoon,
  IconDeviceDesktop,
} from "@tabler/icons-react";

type TabId = "general" | "shortcut" | "postprocess" | "models" | "history" | "advanced" | "about";

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
    { id: "advanced", label: "Advanced", icon: <IconAdjustments size={18} stroke={1.75} /> },
    { id: "about", label: "About", icon: <IconInfoCircle size={18} stroke={1.75} /> },
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
    <div className="w-screen h-screen flex bg-background text-foreground select-none overflow-hidden font-sans">
      {/* Left Sidebar (w-52 fixed) */}
      <aside className="w-52 shrink-0 border-r border-sidebar-border flex flex-col justify-between p-3.5 bg-sidebar shadow-2xs">
        <div className="space-y-3">
          {/* App Header (Logo & Name) */}
          <div className="flex items-center space-x-2.5 px-1 py-1">
            <img
              src="/pulse-logo.png"
              alt="Pulse Logo"
              className="w-8 h-8 object-contain shrink-0"
            />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-sidebar-foreground tracking-tight">
                  Pulse
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <p className="text-[10px] text-muted-foreground font-medium">
                Local Dictation
              </p>
            </div>
          </div>

          {/* Dashed Separator Line */}
          <div className="border-b border-dashed border-border mx-1" />

          {/* Navigation Tabs (Vertical List) */}
          <nav className="space-y-1">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition-all cursor-pointer shrink-0 whitespace-nowrap ${
                    isActive
                      ? "bg-muted text-foreground border border-border shadow-2xs font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-transparent font-medium"
                  }`}
                >
                  <span className={isActive ? "text-foreground" : "text-muted-foreground"}>
                    {tab.icon}
                  </span>
                  <span className="whitespace-nowrap">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom of Sidebar: Theme Toggle */}
        <div className="pt-3 border-t border-border">
          <button
            onClick={handleCycleTheme}
            title="Click to toggle theme (System → Dark → Light)"
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium bg-muted/80 hover:bg-muted text-foreground border border-border transition-colors cursor-pointer shrink-0 whitespace-nowrap"
          >
            <span className="flex items-center gap-1.5 text-[11px] whitespace-nowrap">
              <span className="text-muted-foreground shrink-0">{renderThemeIcon()}</span>
              <span className="capitalize whitespace-nowrap">{currentTheme}</span>
            </span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium shrink-0 whitespace-nowrap">
              Theme
            </span>
          </button>
        </div>
      </aside>

      {/* Right Main Content Panel */}
      <main className="flex-1 min-w-0 h-full overflow-y-auto p-6 bg-background">
        <div className="w-full max-w-4xl mx-auto space-y-6">
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
          {activeTab === "advanced" && <AdvancedPanel />}
          {activeTab === "about" && <AboutPanel />}
        </div>
      </main>
    </div>
  );
}
