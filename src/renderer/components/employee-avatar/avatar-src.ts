import { toImbFileUrl } from "@shared/imb-file";
import assistantAvatar from "../../assets/assistant.avif";
import userAvatar from "../../assets/boss.avif";

/** Bundled avatar for the current user (boss), who is not an employee. */
export const USER_AVATAR = userAvatar;

/**
 * Effective avatar image for an employee: an `imb-file:` URL for their stored
 * on-disk avatar, or the bundled assistant image when the built-in assistant
 * (id 0) has no avatar yet.
 */
export function employeeAvatarSrc(employee: {
  id: number;
  avatar: string | null;
  avatarVersion: number | null;
}): string | null {
  // The path is written by `saveAvatar` and is always absolute; main rejects a
  // non-absolute one, and the `<img>` error handler then falls back to the
  // letter. `avatarVersion` (the file mtime) busts the image cache when the same
  // path is re-written.
  if (employee.avatar !== null && employee.avatar.length > 0) {
    return toImbFileUrl(employee.avatar, employee.avatarVersion);
  }
  return employee.id === 0 ? assistantAvatar : null;
}
