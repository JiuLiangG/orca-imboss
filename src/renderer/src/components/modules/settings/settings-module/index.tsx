import { useState } from "react";
import { t } from "../../../../../../shared/libs/l10n";
import { ModuleView } from "../../../app-shell";
import { ListPane } from "../../../list-pane";
import { ListRow } from "../../../list-row";
import { SettingsGeneral } from "../settings-general";
import { SettingsTheme } from "../settings-theme";
import { SettingsAbout } from "../settings-about";
import "../../module-common.css";

type SettingsSection = "general" | "theme" | "about";

const SECTIONS: Array<{
  id: SettingsSection;
  labelKey: string;
  descKey: string;
}> = [
  {
    id: "general",
    labelKey: "General",
    descKey: "App language and basic settings",
  },
  { id: "theme", labelKey: "Theme", descKey: "Accent color and theme mode" },
  { id: "about", labelKey: "About", descKey: "Version info" },
];

/** Settings module: list (通用/主题/关于) → section detail. */
export function SettingsModule(): React.JSX.Element {
  const [section, setSection] = useState<SettingsSection>("general");

  const list = (
    <ListPane title={t("Settings")}>
      {SECTIONS.map((item) => (
        <ListRow
          key={item.id}
          active={section === item.id}
          name={t(item.labelKey)}
          sub={t(item.descKey)}
          onClick={() => setSection(item.id)}
        />
      ))}
    </ListPane>
  );

  const detail =
    section === "theme" ? (
      <SettingsTheme />
    ) : section === "about" ? (
      <SettingsAbout />
    ) : (
      <SettingsGeneral />
    );

  return <ModuleView list={list} detail={detail} />;
}
