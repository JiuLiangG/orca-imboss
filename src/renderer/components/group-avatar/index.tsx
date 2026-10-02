import { ASSISTANT_ID } from "@shared/constants/employees";
import { cls } from "reactutils";
import { Avatar } from "../avatar";
import { EmployeeAvatar } from "../employee-avatar";
import "./index.css";

export interface GroupAvatarProps {
  /** Participant employee ids (the assistant id 0 is ignored). */
  participants: readonly number[];
  size?: number;
  title?: string;
  className?: string;
}

/** WeChat-style group avatars show at most four members. */
const MAX_MEMBERS = 4;

/**
 * Composite group avatar: up to four member avatars arranged in a rounded
 * square. The built-in assistant (id 0) is never shown — only employees are
 * treated as the group's members. Falls back to a neutral "?" tile when there
 * is no one to show.
 */
export function GroupAvatar({
  participants,
  size = 40,
  title,
  className,
}: GroupAvatarProps): React.JSX.Element {
  const members = [
    ...new Set(participants.filter((id) => id !== ASSISTANT_ID)),
  ].slice(0, MAX_MEMBERS);
  const count = members.length;
  // The tile size only drives the fallback font size; the grid stretches each
  // avatar to its cell.
  const cellSize = count <= 1 ? size : Math.floor(size / 2);
  // Small composites (e.g. the Nav rail) have almost no room per tile, so use a
  // tighter gap and glyphs scaled to the tile instead of the base Avatar's
  // 11px floor, which would otherwise overflow the cell and look cramped.
  const gap = size >= 32 ? 2 : 1;
  const tileFont =
    count <= 1
      ? Math.max(11, Math.round(size * 0.35))
      : Math.max(8, Math.round(cellSize * 0.55));

  return (
    <span
      className={cls("imb-group-avatar", `imb-count-${count}`, className)}
      style={
        {
          width: size,
          height: size,
          borderRadius: Math.max(4, Math.round(size * 0.22)),
          "--imb-group-gap": `${gap}px`,
          "--imb-group-tile-font": `${tileFont}px`,
        } as React.CSSProperties
      }
      title={title}
      aria-hidden={title ? undefined : true}
    >
      {count === 0 ? (
        <Avatar letter="?" size={size} alt />
      ) : (
        members.map((id) => (
          <EmployeeAvatar key={id} employeeId={id} size={cellSize} />
        ))
      )}
    </span>
  );
}
