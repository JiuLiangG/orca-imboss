import { t } from "@shared/l10n";
import { useEffect, useRef } from "react";
import { cls } from "reactutils";
import { EmployeeAvatar } from "../../../../employee-avatar";
import "./index.css";

export interface MentionCandidate {
  readonly id: number;
  readonly name?: string;
  readonly role?: string;
  readonly avatarUrl?: string | null;
}

export interface MentionPopupProps {
  open: boolean;
  employees: readonly MentionCandidate[];
  selectedIndex: number;
  onSelect: (employee: MentionCandidate) => void;
  onHoverIndex?: (index: number) => void;
}

/**
 * 输入框 `@` 提及时的员工候选浮动列表组件，提供键盘高亮导航、过滤与选择回调。
 */
export function MentionPopup({
  open,
  employees,
  selectedIndex,
  onSelect,
  onHoverIndex,
}: MentionPopupProps): React.JSX.Element | null {
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the selected option into view during keyboard navigation.
  useEffect(() => {
    if (!open || selectedIndex < 0 || !listRef.current) return;
    const selectedEl = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }, [open, selectedIndex]);

  if (!open) return null;

  if (employees.length === 0) {
    return (
      <div className="imb-mention-popup" ref={listRef}>
        <div className="imb-mention-empty">{t("No employees found")}</div>
      </div>
    );
  }

  return (
    <div className="imb-mention-popup" ref={listRef} role="listbox">
      {employees.map((emp, index) => {
        const isSelected = index === selectedIndex;
        const displayName = emp.name || emp.role || `#${emp.id}`;

        return (
          <button
            key={emp.id}
            type="button"
            className={cls("imb-mention-item", isSelected && "imb-is-selected")}
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect(emp)}
            onMouseEnter={() => onHoverIndex?.(index)}
          >
            <div className="imb-mention-avatar">
              <EmployeeAvatar employeeId={emp.id} size={28} />
            </div>
            <div className="imb-mention-info">
              <span className="imb-mention-name">{displayName}</span>
              {emp.role && <span className="imb-mention-role">{emp.role}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
