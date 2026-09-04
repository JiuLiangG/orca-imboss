import "./styles/base.css";
import "./styles/tokens.css";

import { setupL10N } from "@shared/l10n";
import zhCN from "@shared/translations/zhCN.json";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initApp } from "./app-store";

setupL10N(imb.initialLocale, { "zh-CN": zhCN });
initApp();

document.documentElement.dataset.platform = imb.platform;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
