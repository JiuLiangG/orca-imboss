import { t } from "@shared/l10n";
import { appStore, useApp, type SettingsSection } from "../../../../app-store";
import { ModuleView } from "../../../app-shell";
import { ListPane } from "../../../list-pane";
import { ListRow } from "../../../list-row";
import "../../module-common.css";
import { SettingsAbout } from "../settings-about";
import { SettingsGeneral } from "../settings-general";
import { SettingsIntegrations } from "../settings-integrations";
import { SettingsTheme } from "../settings-theme";

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
  {
    id: "integrations",
    labelKey: "Integrations",
    descKey: "Connect WeChat, QQ and Telegram",
  },
  { id: "about", labelKey: "About", descKey: "Version info" },
];

export function SettingsModule(): React.JSX.Element {
  const { settingsSection } = useApp();

  const list = (
    <ListPane title={t("Settings")}>
      {SECTIONS.map((item) => (
        <ListRow
          key={item.id}
          active={settingsSection === item.id}
          name={t(item.labelKey)}
          sub={t(item.descKey)}
          onClick={() => {
            appStore.settingsSection = item.id;
          }}
        />
      ))}
    </ListPane>
  );

  const detail =
    settingsSection === "theme" ? (
      <SettingsTheme />
    ) : settingsSection === "integrations" ? (
      <SettingsIntegrations />
    ) : settingsSection === "about" ? (
      <SettingsAbout />
    ) : (
      <SettingsGeneral />
    );

  return <ModuleView list={list} detail={detail} />;
}
