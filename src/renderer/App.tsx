import { useEffect } from "react";
import { useApp, type AppModule } from "./app-store";
import { AppShell } from "./components/app-shell";
import { ChatModule } from "./components/modules/chat/chat-module";
import { EmployeesModule } from "./components/modules/employees/employees-module";
import { GroupChatModule } from "./components/modules/group-chat/group-chat-module";
import { McpModule } from "./components/modules/mcp/mcp-module";
import { MiniAppModule } from "./components/modules/miniapp/miniapp-module";
import { ProvidersModule } from "./components/modules/providers/providers-module";
import { SettingsModule } from "./components/modules/settings/settings-module";
import { SkillsModule } from "./components/modules/skills/skills-module";

const MODULE_VIEWS: Partial<Record<AppModule, () => React.JSX.Element>> = {
  chat: ChatModule,
  providers: ProvidersModule,
  mcp: McpModule,
  skills: SkillsModule,
  employees: EmployeesModule,
  settings: SettingsModule,
};

export default function App(): React.JSX.Element {
  // Subscribe to `locale` so that a language switch re-renders the whole tree
  // and every `t()` call re-evaluates against the new locale. Without this,
  // only components that read `locale` directly (e.g. SettingsGeneral) refresh;
  // the rest of the UI (nav, headers, modules) would wait for a restart.
  const { locale } = useApp();

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <>
      <AppShell />
      <ActiveModule />
      {/* Always mounted so visited mini-app iframes survive module switches. */}
      <MiniAppModule />
    </>
  );
}

function ActiveModule(): React.JSX.Element {
  const { module, activeChatId } = useApp();

  // Group chats opened from `chat`-kind cards render in a dedicated
  // single-pane view; the key resets the view when switching chats.
  if (module === "group-chat" && activeChatId !== null) {
    return <GroupChatModule key={activeChatId} chatId={activeChatId} />;
  }

  // Mini apps are rendered by the persistent `MiniAppModule` host (so their
  // pages are never unmounted); the shell still uses the `single` layout here.
  if (module === "miniapp") return <></>;

  const View = MODULE_VIEWS[module];
  if (View) return <View />;
  return <ChatModule />;
}
