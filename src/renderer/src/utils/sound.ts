import notifySound from "../assets/notify.wav";

let lastPlay = 0;

/**
 * Play a short notification beep. Throttled so a burst of inbound messages
 * (e.g. several agents replying at once) does not produce overlapping audio.
 * Any playback failure is ignored — a missing audio device must never break
 * the chat UI.
 */
export function playNotificationSound(): void {
  const now = Date.now();
  if (now - lastPlay < 1000) return;
  lastPlay = now;
  try {
    void new Audio(notifySound).play().catch(() => {});
  } catch {
    // Ignore audio failures.
  }
}
