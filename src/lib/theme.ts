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
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  if (isDark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

// Initialize system color-scheme listener
export function initThemeListener(): () => void {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    if (getStoredTheme() === "system") {
      applyTheme("system");
    }
  };

  mediaQuery.addEventListener("change", handler);
  applyTheme(getStoredTheme());

  return () => {
    mediaQuery.removeEventListener("change", handler);
  };
}
