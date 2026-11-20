import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import RecordingOverlay from "./components/RecordingOverlay";
import { initThemeListener } from "./lib/theme";
import "./App.css";

const isOverlay = window.location.hash === "#overlay";

if (isOverlay) {
  document.documentElement.classList.add("overlay-window");
  document.body.classList.add("overlay-window");
}

// Initialize light/dark/system theme
initThemeListener();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isOverlay ? <RecordingOverlay /> : <App />}
  </React.StrictMode>,
);
