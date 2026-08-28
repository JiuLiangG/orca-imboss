import { useEffect, useState } from "react";
import { t } from "../../../../../../shared/libs/l10n";
import { BrandLogo } from "../../../brand-logo";
import { DetailBody, DetailHead } from "../../../detail-pane";
import "./index.css";

/** Settings → About: brand logo + app name + version. */
export function SettingsAbout(): React.JSX.Element {
  const [version, setVersion] = useState("");

  useEffect(() => {
    let alive = true;
    void window.imb.getVersion().then((v) => {
      if (alive) setVersion(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <DetailHead eyebrow="About" title="imboss" sub={t("Version info")} />
      <DetailBody>
        <div className="imb-about-brand">
          <BrandLogo className="imb-about-logo" />
          <span className="imb-about-name">imboss</span>
        </div>
        <div className="imb-about-kv">
          <div className="imb-kv">
            <span className="imb-k">{t("App name")}</span>
            <span className="imb-v">imboss</span>
          </div>
          <div className="imb-kv">
            <span className="imb-k">{t("Version")}</span>
            <span className="imb-v">{version ? `v${version}` : "…"}</span>
          </div>
        </div>
      </DetailBody>
    </>
  );
}
