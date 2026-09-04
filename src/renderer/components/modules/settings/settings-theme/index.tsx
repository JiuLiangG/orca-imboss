import { t } from "@shared/l10n";
import type { ThemeMode } from "@shared/types";
import { cls } from "reactutils";
import { useApp } from "../../../../app-store";
import { THEME_COLORS } from "../../../../theme";
import { DetailBody, DetailHead } from "../../../detail-pane";
import { SegmentedControl } from "../../../segmented-control";
import "./index.css";

/** Settings → Theme: 18 accent swatches + light/dark/system mode. */
export function SettingsTheme(): React.JSX.Element {
  const { theme, setTheme } = useApp();

  const activeColor = THEME_COLORS.find(
    (c) => c.hex.toLowerCase() === theme.color.toLowerCase(),
  )?.id;

  return (
    <>
      <DetailHead
        eyebrow="Theme"
        title={t("Theme")}
        sub={t("Accent color and theme mode")}
      />
      <DetailBody>
        <div className="imb-theme-section">
          <label>{t("Accent color")}</label>
          <div
            className="imb-theme-grid"
            role="radiogroup"
            aria-label={t("Accent color")}
          >
            {THEME_COLORS.map((color) => (
              <div className="imb-theme-item" key={color.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={
                    color.hex.toLowerCase() === theme.color.toLowerCase()
                  }
                  title={t(color.id)}
                  aria-label={t(color.id)}
                  className={cls(
                    "imb-theme-swatch",
                    activeColor === color.id && "imb-is-active",
                  )}
                  style={{ background: color.hex }}
                  onClick={() => void setTheme({ color: color.hex })}
                />
                <span className="imb-theme-name">{t(color.id)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="imb-theme-section">
          <label>{t("Theme mode")}</label>
          <SegmentedControl<ThemeMode>
            value={theme.mode}
            onChange={(mode) => void setTheme({ mode })}
            options={[
              { value: "light", label: t("Light") },
              { value: "dark", label: t("Dark") },
              { value: "system", label: t("System") },
            ]}
          />
        </div>
      </DetailBody>
    </>
  );
}
