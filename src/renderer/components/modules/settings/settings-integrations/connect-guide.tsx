import {
  INTEGRATION_DOC_URLS,
  INTEGRATION_LABEL_KEYS,
} from "@shared/constants/integrations";
import { t } from "@shared/l10n";
import type { IntegrationPlatform } from "@shared/types";
import { Button } from "../../../button";
import { Modal } from "../../../modal";

export interface ConnectGuideProps {
  /** The platform whose guide is open, or null when closed. */
  platform: IntegrationPlatform | null;
  onClose: () => void;
}

/** Per-platform concise quick-start, opened from a card's help button. */
export function ConnectGuide({
  platform,
  onClose,
}: ConnectGuideProps): React.JSX.Element {
  const steps = platform ? guideSteps(platform) : [];
  return (
    <Modal
      open={platform !== null}
      onClose={onClose}
      title={t("How to connect")}
      sub={platform ? t(INTEGRATION_LABEL_KEYS[platform]) : undefined}
      actions={
        <Button variant="secondary" onClick={onClose}>
          {t("Close")}
        </Button>
      }
    >
      <ol className="imb-guide-steps">
        {steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
      {platform && INTEGRATION_DOC_URLS[platform] && (
        <a
          className="imb-guide-docs"
          href={INTEGRATION_DOC_URLS[platform]}
          target="_blank"
          rel="noreferrer noopener"
        >
          {t("View official docs")}
        </a>
      )}
    </Modal>
  );
}

function guideSteps(platform: IntegrationPlatform): string[] {
  switch (platform) {
    case "wechat":
      return [
        t("Keep the WeChat app on your phone ready to scan QR codes."),
        t("Turn on WeChat below, then click “Log in with QR code”."),
        t("Scan the QR code shown here to authorize this bot account."),
        t(
          "The account that scans becomes the owner; messages it sends to the bot reach your assistant.",
        ),
      ];
    case "qq":
      return [
        t(
          "Register a bot on the QQ 开放平台 (bot.q.qq.com) and create an application.",
        ),
        t("Copy its App ID and App Secret into the fields below."),
        t("Enable the group-and-C2C message event intent for the bot."),
        t(
          "Add your QQ openid (or group id) to the owner list, then turn on QQ.",
        ),
      ];
    case "telegram":
      return [
        t("Open Telegram and start a chat with @BotFather."),
        t("Send /newbot and follow the prompts to create a bot."),
        t("Copy the bot token into the field below."),
        t(
          "Add your Telegram user id (or chat id) to the owner list, then turn on Telegram.",
        ),
      ];
  }
}
