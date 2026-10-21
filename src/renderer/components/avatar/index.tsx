import { useEffect, useState } from "react";
import { cls } from "reactutils";
import "./index.css";

export interface AvatarProps {
  /** Image URL (`imb-file:` or a bundled asset); falls back to letter when absent. */
  src?: string | null;
  /** Letter/initials shown when there is no image. */
  letter?: string;
  name?: string;
  size?: number;
  /** Muted ("alt") styling for non-employee avatars. */
  alt?: boolean;
  active?: boolean;
  showTitle?: boolean;
  className?: string;
}

export function Avatar({
  src,
  letter = "?",
  name,
  size = 40,
  alt = false,
  active = false,
  showTitle = false,
  className,
}: AvatarProps): React.JSX.Element {
  // A moved/deleted avatar file must fall back to the letter rather than show
  // the browser's broken-image placeholder.
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  const showImage = Boolean(src) && !failed;
  const title = showTitle ? { title: name } : undefined;

  return (
    <span
      className={cls(
        "imb-avatar",
        alt && "imb-alt",
        active && "imb-is-active",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.35) }}
      {...title}
    >
      {showImage ? (
        <img src={src ?? ""} alt={name ?? ""} onError={() => setFailed(true)} />
      ) : (
        letter.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
