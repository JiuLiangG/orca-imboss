import { useEffect, useState } from "react";
import { IS_MAC } from "../../app-store";
import "./index.css";

function WindowButton({
  label,
  onClose,
  className,
  onClick,
  children,
}: {
  label: string;
  /** Marks the close button for the danger hover state. */
  onClose?: boolean;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const cls = ["imb-winbtn", className, onClose ? "imb-close" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={cls}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const stroke = { stroke: "currentColor", strokeWidth: 1.4 } as const;

/**
 * Full-width title bar / drag region (row 1 of `.imb-app`).
 * macOS: empty draggable strip; the native traffic lights sit on its left.
 * Windows/Linux: custom small min/max/close buttons on the right (native
 * controls are hidden via the absence of `titleBarOverlay`).
 */
export function TitleBar(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let alive = true;
    void window.imb.windowControls.isMaximized().then((m) => {
      if (alive) setMaximized(m);
    });
    const un = window.imb.windowControls.onMaximized((m) => {
      if (alive) setMaximized(m);
    });
    return () => {
      alive = false;
      un();
    };
  }, []);

  return (
    <header className="imb-titlebar">
      {!IS_MAC && (
        <div className="imb-winbtns">
          <WindowButton
            label="Minimize"
            onClick={() => void window.imb.windowControls.minimize()}
          >
            <svg className="imb-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 8h10" {...stroke} />
            </svg>
          </WindowButton>
          <WindowButton
            label={maximized ? "Restore" : "Maximize"}
            onClick={() => void window.imb.windowControls.toggleMaximize()}
          >
            {maximized ? (
              <svg className="imb-icon" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="4" y="3" width="9" height="9" fill="none" {...stroke} />
                <rect x="3" y="4" width="9" height="9" fill="none" {...stroke} />
              </svg>
            ) : (
              <svg className="imb-icon" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="3" y="3" width="10" height="10" fill="none" {...stroke} />
              </svg>
            )}
          </WindowButton>
          <WindowButton
            label="Close"
            onClose
            onClick={() => void window.imb.windowControls.close()}
          >
            <svg className="imb-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" {...stroke} />
            </svg>
          </WindowButton>
        </div>
      )}
    </header>
  );
}
