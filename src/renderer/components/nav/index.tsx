import { SettingKeys } from "@shared/constants/settings";
import { t } from "@shared/l10n";
import { cls } from "reactutils";
import { appStore, useApp, type AppModule } from "../../app-store";
import { BrandLogo } from "../brand-logo";
import {
  IconChat,
  IconChatProduct,
  IconCollapse,
  IconEmployees,
  IconGear,
  IconMcp,
  IconModels,
  IconSkills,
  IconWorld,
} from "../icons";
import { Tooltip } from "../tooltip";
import "./index.css";

interface NavItem {
  module: AppModule;
  labelKey: string;
  icon: (props: { className?: string }) => React.JSX.Element;
  section?: "main" | "miniapp" | "chats" | "bottom";
}

const NAV_ITEMS: NavItem[] = [
  {
    module: "chat",
    labelKey: "Chats",
    icon: IconChat,
    section: "main",
  },
  {
    module: "providers",
    labelKey: "Providers",
    icon: IconModels,
    section: "main",
  },
  { module: "mcp", labelKey: "MCP", icon: IconMcp, section: "main" },
  {
    module: "skills",
    labelKey: "Skills",
    icon: IconSkills,
    section: "main",
  },
  {
    module: "employees",
    labelKey: "Employees",
    icon: IconEmployees,
    section: "main",
  },
  {
    module: "miniapp-worldmap",
    labelKey: "World Map",
    icon: IconWorld,
    section: "miniapp",
  },
  {
    module: "chat-product",
    labelKey: "Website Redesign",
    icon: IconChatProduct,
    section: "chats",
  },
  {
    module: "settings",
    labelKey: "Settings",
    icon: IconGear,
    section: "bottom",
  },
];

export interface NavProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Nav({ collapsed, onToggle }: NavProps): React.JSX.Element {
  const main = NAV_ITEMS.filter((i) => i.section === "main");
  const miniapp = NAV_ITEMS.filter((i) => i.section === "miniapp");
  const chats = NAV_ITEMS.filter((i) => i.section === "chats");
  const bottom = NAV_ITEMS.filter((i) => i.section === "bottom");

  return (
    <nav
      className={cls("imb-nav", collapsed && "imb-is-collapsed")}
      aria-label="Modules"
    >
      <div className="imb-nav-brand">
        <BrandLogo style={{ maxWidth: "41px" }} />
        <span className="imb-nav-brandname">imboss</span>
      </div>
      <div className="imb-nav-items">
        {main.map((item) => (
          <NavButton key={item.module} item={item} collapsed={collapsed} />
        ))}
      </div>
      <div className="imb-nav-divider" />
      <div className="imb-scroll">
        <div className="imb-nav-items">
          {miniapp.map((item) => (
            <NavButton key={item.module} item={item} collapsed={collapsed} />
          ))}
        </div>
        <div className="imb-nav-divider" />
        <div className="imb-nav-items">
          {chats.map((item) => (
            <NavButton key={item.module} item={item} collapsed={collapsed} />
          ))}
        </div>
      </div>
      <div className="imb-nav-spacer" />
      <div className="imb-nav-items imb-nav-bottom">
        <Tooltip
          content={collapsed ? t("Expand") : t("Collapse")}
          placement="right"
          disabled={!collapsed}
        >
          <button
            type="button"
            className="imb-nav-toggle"
            aria-label={collapsed ? t("Expand") : t("Collapse")}
            onClick={onToggle}
          >
            <IconCollapse className="imb-icon" />
            <span>{t("Collapse")}</span>
          </button>
        </Tooltip>
        {bottom.map((item) => (
          <NavButton key={item.module} item={item} collapsed={collapsed} />
        ))}
      </div>
    </nav>
  );
}

type NavButtonProps = {
  item: NavItem;
  collapsed: boolean;
};

function NavButton({ item, collapsed }: NavButtonProps): React.JSX.Element {
  const { module } = useApp();

  async function setModule(value: AppModule): Promise<void> {
    appStore.module = value;
    await imb.settings.set(SettingKeys.Module, value);
  }

  const Icon = item.icon;
  const active = module === item.module;

  return (
    <Tooltip content={t(item.labelKey)} placement="right" disabled={!collapsed}>
      <button
        type="button"
        className={cls("imb-nav-item", active && "imb-is-active")}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? t(item.labelKey) : undefined}
        onClick={() => setModule(item.module)}
      >
        <Icon className="imb-icon" />
        <span>{t(item.labelKey)}</span>
      </button>
    </Tooltip>
  );
}
