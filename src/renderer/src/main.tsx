import "./assets/main.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setupL10N } from "../../shared/libs/l10n";
import zhCN from "../../shared/translations/zhCN.json";
import App from "./App";

setupL10N(imb.locale, { "zh-CN": zhCN });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
