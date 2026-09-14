import assistantAvatar from "../../assets/assistant.avif";
import userAvatar from "../../assets/boss.avif";

/** Bundled avatar for the current user (boss), who is not an employee. */
export const USER_AVATAR = userAvatar;

/**
 * Effective avatar image for an employee: their stored avatar data URL, or the
 * bundled assistant image when the built-in assistant (id 0) has no avatar yet.
 */
export function employeeAvatarSrc(employee: {
  id: number;
  avatarUrl: string | null;
}): string | null {
  if (employee.avatarUrl) return employee.avatarUrl;
  return employee.id === 0 ? assistantAvatar : null;
}
