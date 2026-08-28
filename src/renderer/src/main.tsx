import "./styles/tokens.css";
import "./styles/base.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setupL10N } from "../../shared/libs/l10n";
import zhCN from "../../shared/translations/zhCN.json";
import App from "./App";
import { initApp } from "./app-store";

setupL10N(window.imb.locale, { "zh-CN": zhCN });
initApp();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
