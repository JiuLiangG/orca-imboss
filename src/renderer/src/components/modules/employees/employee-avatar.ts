import assistantAvatar from "../../../assets/assistant.avif";

/** Bundled fallback avatar for the built-in assistant when it has no avatar set. */
export const ASSISTANT_AVATAR = assistantAvatar;

/**
 * Effective avatar image for an employee: their stored avatar data URL, or the
 * bundled assistant image when the built-in assistant (id 0) has no avatar yet.
 */
export function employeeAvatarSrc(employee: {
  id: number;
  avatarUrl: string | null;
}): string | null {
  if (employee.avatarUrl) return employee.avatarUrl;
  return employee.id === 0 ? ASSISTANT_AVATAR : null;
}
