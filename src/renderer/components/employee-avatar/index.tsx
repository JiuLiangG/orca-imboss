import { useEffect } from "react";
import { appStore, useApp } from "../../app-store";
import { Avatar } from "../avatar";
import { employeeAvatarSrc, USER_AVATAR } from "./avatar-src";

export interface EmployeeAvatarProps {
  /** Employee id; `null` renders the current user (boss) avatar. */
  employeeId: number | null;
  size?: number;
  alt?: boolean;
  active?: boolean;
  className?: string;
}

/**
 * Avatar that resolves an employee's image from the centralized appStore.
 * `employeeId = null` renders the current user (boss)'s bundled avatar; an
 * unknown/disabled employee id falls back to the base `Avatar` letter "?".
 */
export function EmployeeAvatar({
  employeeId,
  size,
  alt,
  active,
  className,
}: EmployeeAvatarProps): React.JSX.Element {
  const { data } = useApp();

  // Idempotent, best-effort: the chat module renders employee avatars but does
  // not otherwise load the employee collection.
  useEffect(() => {
    appStore.ensureEmployees();
  }, []);

  if (employeeId === null) {
    return (
      <Avatar
        src={USER_AVATAR}
        name="User"
        size={size}
        alt={alt}
        active={active}
        className={className}
      />
    );
  }

  const employee = data.employees.items.find((e) => e.id === employeeId);
  return (
    <Avatar
      src={employee ? employeeAvatarSrc(employee) : null}
      letter={employee?.name.slice(0, 1)}
      name={employee?.name}
      size={size}
      alt={alt}
      active={active}
      className={className}
    />
  );
}
