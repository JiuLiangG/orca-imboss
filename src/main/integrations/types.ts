import type {
  IntegrationConnectionState,
  IntegrationContactKind,
  IntegrationPlatform,
} from "@shared/types";

/** Media attached to an inbound platform message (lazily downloaded). */
export interface InboundMedia {
  kind: "image" | "file" | "voice" | "video";
  fileName: string;
  mime: string;
  /**
   * Download/decrypt and write the file into `targetDir`, returning the
   * absolute path + byte size, or null when the media is unavailable.
   * Implemented by each adapter (platform-specific fetch/crypto).
   */
  save(targetDir: string): Promise<{ path: string; size: number } | null>;
}

/** One inbound platform message, normalized across adapters. */
export interface InboundMessage {
  /** Stable platform conversation id (e.g. iLink `from_user_id`). */
  sessionId: string;
  /** Platform sender id (used for the owner whitelist). */
  senderId: string;
  /** Display name used for a newly created chat's title. */
  senderName: string;
  /** Text body (may be empty when the message is media-only). */
  text: string;
  /** Per-conversation reply credential (e.g. iLink `context_token`). */
  replyContext?: string;
  /** Whether this arrived in a 1:1 or a group conversation. */
  kind: IntegrationContactKind;
  /** Media items (downloads happen later, after authorization). */
  media: InboundMedia[];
}

/** Addressing info the manager passes back to an adapter when sending. */
export interface AdapterSession {
  sessionId: string;
  replyContext?: string;
}

/** Callbacks an adapter uses to talk to the manager. */
export interface AdapterCallbacks {
  /** Deliver a normalized inbound message. */
  onMessage(message: InboundMessage): void;
  /** Report a connection state change (drives the Settings status). */
  onState(state: IntegrationConnectionState, detail?: string | null): void;
  /** WeChat only: emit a QR payload while login is pending. */
  onQr?(image: string, status: string): void;
  /** Mark the in-memory platform config dirty (manager persists, debounced). */
  onConfigDirty(): void;
}

/** Uniform adapter contract implemented by every platform. */
export interface IntegrationAdapter {
  readonly platform: IntegrationPlatform;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendText(session: AdapterSession, text: string): Promise<void>;
  /**
   * Send a local file as native platform media when supported; adapters that
   * cannot send a given type fall back to a text note.
   */
  sendMedia(
    session: AdapterSession,
    filePath: string,
    caption?: string,
  ): Promise<void>;
  /** WeChat only: run the interactive QR login flow. */
  login?(): Promise<void>;
  /** WeChat only: forget stored credentials. */
  logout?(): Promise<void>;
}
