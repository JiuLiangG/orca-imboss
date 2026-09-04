import { useEffect } from "react";
import { useApp, type AppModule } from "./app-store";
import { AppShell } from "./components/app-shell";
import { ChatModule } from "./components/modules/chat/chat-module";
import { EmployeesModule } from "./components/modules/employees/employees-module";
import { McpModule } from "./components/modules/mcp/mcp-module";
import { ModelsModule } from "./components/modules/models/models-module";
import {
  isPlaceholderModule,
  PlaceholderModule,
} from "./components/modules/placeholder/placeholder-module";
import { SettingsModule } from "./components/modules/settings/settings-module";
import { SkillsModule } from "./components/modules/skills/skills-module";

const MODULE_VIEWS: Partial<Record<AppModule, () => React.JSX.Element>> = {
  chat: ChatModule,
  models: ModelsModule,
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
    </>
  );
}

function ActiveModule(): React.JSX.Element {
  const { module } = useApp();
  const View = MODULE_VIEWS[module];

  if (View) return <View />;
  if (isPlaceholderModule(module)) return <PlaceholderModule />;
  return <ChatModule />;
}
