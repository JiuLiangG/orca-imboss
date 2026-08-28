import { t } from "../../../../../../shared/libs/l10n";
import { useApp, type AppModule } from "../../../../app-store";
import { ModuleView } from "../../../app-shell";
import { DetailBody, DetailHead } from "../../../detail-pane";
import { ListPane } from "../../../list-pane";
import { EmptyState } from "../../../empty-state";

const PLACEHOLDER_TITLES: Partial<
  Record<AppModule, { name: string; titleKey: string }>
> = {
  "miniapp-worldmap": { name: "World Map", titleKey: "World Map" },
  "chat-product": { name: "Website Redesign", titleKey: "Website Redesign" },
};

const PLACEHOLDER_MODULES: AppModule[] = ["miniapp-worldmap", "chat-product"];

/** Placeholder module view for not-yet-open modules (世界地图 / 产品网站改版). */
export function PlaceholderModule(): React.JSX.Element {
  const { module } = useApp();
  const info = PLACEHOLDER_TITLES[module];
  const name = info?.titleKey ? t(info.titleKey) : (info?.name ?? module);

  const list = (
    <ListPane title={name}>
      <EmptyState>
        <div className="imb-placeholder-empty">
          {t("This module is not available yet")}
        </div>
      </EmptyState>
    </ListPane>
  );

  const detail = (
    <>
      <DetailHead eyebrow="Coming Soon" title={name} />
      <DetailBody>
        <p className="imb-placeholder-body">
          {t("This feature is under development. Stay tuned.")}
        </p>
      </DetailBody>
    </>
  );

  return <ModuleView list={list} detail={detail} />;
}

/** Returns true for modules rendered by PlaceholderModule. */
export function isPlaceholderModule(module: AppModule): boolean {
  return PLACEHOLDER_MODULES.includes(module);
}
