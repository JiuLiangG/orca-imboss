import { SettingKeys } from "@shared/constants/settings";
import { t } from "@shared/l10n";
import { useState } from "react";
import { cls } from "reactutils";
import { appStore, useApp, type AppModule } from "../../app-store";
import { BrandLogo } from "../brand-logo";
import { ContextMenu, type ContextMenuState } from "../context-menu";
import { GroupAvatar } from "../group-avatar";
import {
  IconChat,
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
  section?: "main" | "miniapp" | "bottom";
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

/** Read-only shape of an opened chat (valtio snapshots are deeply readonly). */
interface NavChat {
  readonly id: number;
  readonly title: string;
  readonly participants: readonly number[];
}

export function Nav({ collapsed, onToggle }: NavProps): React.JSX.Element {
  const { openedChats, module, activeChatId } = useApp();
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  const main = NAV_ITEMS.filter((i) => i.section === "main");
  const miniapp = NAV_ITEMS.filter((i) => i.section === "miniapp");
  const bottom = NAV_ITEMS.filter((i) => i.section === "bottom");

  return (
    <>
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
          {miniapp.length > 0 && (
            <div className="imb-nav-items">
              {miniapp.map((item) => (
                <NavButton
                  key={item.module}
                  item={item}
                  collapsed={collapsed}
                />
              ))}
            </div>
          )}
          {openedChats.length > 0 && (
            <>
              {miniapp.length > 0 && <div className="imb-nav-divider" />}
              <div className="imb-nav-items">
                {openedChats.map((chat) => (
                  <NavChatButton
                    key={chat.id}
                    chat={chat}
                    collapsed={collapsed}
                    active={module === "group-chat" && activeChatId === chat.id}
                    onClick={() => appStore.activateChat(chat.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCtxMenu({
                        x: e.clientX,
                        y: e.clientY,
                        items: [
                          {
                            key: "close",
                            label: t("Close"),
                            onSelect: () => appStore.closeChat(chat.id),
                          },
                        ],
                      });
                    }}
                  />
                ))}
              </div>
            </>
          )}
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
      <ContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />
    </>
  );
}

type NavButtonProps = {
  item: NavItem;
  collapsed: boolean;
};

function NavButton({ item, collapsed }: NavButtonProps): React.JSX.Element {
  const { module } = useApp();

  async function setModule(value: AppModule): Promise<void> {
    // Entering Settings via the nav opens its default section; the updater's
    // notification click deep-links to About through `appStore.openSettings`.
    if (value === "settings") appStore.settingsSection = "general";
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
        <span className="imb-nav-label">{t(item.labelKey)}</span>
      </button>
    </Tooltip>
  );
}

type NavChatButtonProps = {
  chat: NavChat;
  collapsed: boolean;
  active: boolean;
  onClick: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
};

/** Nav entry for a group chat opened from a `chat`-kind card. */
function NavChatButton({
  chat,
  collapsed,
  active,
  onClick,
  onContextMenu,
}: NavChatButtonProps): React.JSX.Element {
  return (
    <Tooltip content={chat.title} placement="right">
      <button
        type="button"
        className={cls("imb-nav-item", active && "imb-is-active")}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? chat.title : undefined}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        <GroupAvatar participants={chat.participants} size={24} />
        <span className="imb-nav-label">{chat.title}</span>
      </button>
    </Tooltip>
  );
}
