import { cls } from "reactutils";
import "./index.css";

export interface AvatarProps {
  /** Image URL (data URL from main); falls back to letter when absent. */
  src?: string | null;
  /** Letter/initials shown when there is no image. */
  letter?: string;
  name?: string;
  size?: number;
  /** Muted ("alt") styling for non-employee avatars. */
  alt?: boolean;
  active?: boolean;
  className?: string;
}

export function Avatar({
  src,
  letter = "?",
  name,
  size = 40,
  alt = false,
  active = false,
  className,
}: AvatarProps): React.JSX.Element {
  return (
    <span
      className={cls(
        "imb-avatar",
        alt && "imb-alt",
        active && "imb-is-active",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.35) }}
      title={name}
    >
      {src ? (
        <img src={src} alt={name ?? ""} />
      ) : (
        letter.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
