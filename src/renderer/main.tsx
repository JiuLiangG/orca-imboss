import "./styles/base.css";
import "./styles/tokens.css";

import { setupL10N } from "@shared/l10n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initApp } from "./app-store";
import { TRANSLATIONS } from "./locale";

setupL10N(imb.initialLocale, TRANSLATIONS);
await initApp();

document.documentElement.dataset.platform = imb.platform;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
