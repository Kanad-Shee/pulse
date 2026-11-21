import { emit, listen } from "@tauri-apps/api/event";

export type Theme = "light" | "dark" | "system";

const THEME_KEY = "pulse-theme";

export function getStoredTheme(): Theme {
  const val = localStorage.getItem(THEME_KEY);
  if (val === "light" || val === "dark" || val === "system") {
    return val;
  }
  return "system";
}

export function setStoredTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);

  // Broadcast theme change to all Tauri windows (settings <-> overlay)
  emit("pulse-theme-changed", { theme }).catch((err) => {
    console.warn("Failed to broadcast theme change:", err);
  });
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  if (isDark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

// Initialize light/dark/system theme listener in current window
export function initThemeListener(): () => void {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const systemHandler = () => {
    if (getStoredTheme() === "system") {
      applyTheme("system");
    }
  };

  mediaQuery.addEventListener("change", systemHandler);

  // Cross-tab / same-origin storage listener
  const storageHandler = (e: StorageEvent) => {
    if (e.key === THEME_KEY) {
      applyTheme(getStoredTheme());
    }
  };
  window.addEventListener("storage", storageHandler);

  // Cross-window Tauri event listener
  let unlistenTauri: (() => void) | undefined;
  listen<{ theme: Theme }>("pulse-theme-changed", (event) => {
    localStorage.setItem(THEME_KEY, event.payload.theme);
    applyTheme(event.payload.theme);
  }).then((fn) => {
    unlistenTauri = fn;
  });

  applyTheme(getStoredTheme());

  return () => {
    mediaQuery.removeEventListener("change", systemHandler);
    window.removeEventListener("storage", storageHandler);
    if (unlistenTauri) unlistenTauri();
  };
}
