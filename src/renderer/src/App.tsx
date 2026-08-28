import { useApp, type AppModule } from "./app-store";
import { AppShell } from "./components/app-shell";
import { ChatModule } from "./components/modules/chat/chat-module";
import { EmployeesModule } from "./components/modules/employees/employees-module";
import { ModelsModule } from "./components/modules/models/models-module";
import { McpModule } from "./components/modules/mcp/mcp-module";
import { SkillsModule } from "./components/modules/skills/skills-module";
import { SettingsModule } from "./components/modules/settings/settings-module";
import {
  isPlaceholderModule,
  PlaceholderModule,
} from "./components/modules/placeholder/placeholder-module";

const MODULE_VIEWS: Partial<Record<AppModule, () => React.JSX.Element>> = {
  chat: ChatModule,
  employees: EmployeesModule,
  models: ModelsModule,
  mcp: McpModule,
  skills: SkillsModule,
  settings: SettingsModule,
};

function ActiveModule(): React.JSX.Element {
  const { module } = useApp();
  const View = MODULE_VIEWS[module];
  if (View) return <View />;
  if (isPlaceholderModule(module)) return <PlaceholderModule />;
  return <ChatModule />;
}

function App(): React.JSX.Element {
  return (
    <>
      <AppShell />
      <ActiveModule />
    </>
  );
}

export default App;
