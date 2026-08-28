import type { SVGProps } from "react";

/**
 * Hand-drawn inline SVG icons (prototype-parity). Stroke-based, `currentColor`.
 * No icon library — these stay in the bundle.
 */

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps): IconProps {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    ...props,
  };
}

export function IconChat(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.35-4.2-1L3 20l1.5-4.3A8.5 8.5 0 1 1 21 11.5Z" />
    </svg>
  );
}

export function IconModels(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M12 3 3.5 7.5 12 12l8.5-4.5L12 3Z" />
      <path d="M3.5 12 12 16.5 20.5 12" />
      <path d="M3.5 16.5 12 21l8.5-4.5" />
    </svg>
  );
}

export function IconMcp(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M14.5 6.5a4.5 4.5 0 0 1 5.5-4.4L16.5 5.6l2 2 3.4-3.6a4.5 4.5 0 0 1-5.5 4.4L8 17l-1.5 3 3-1.5L14.5 6.5Z" />
      <path d="M6 8 4 6M18 18l2 2" />
    </svg>
  );
}

export function IconSkills(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20V5.5Z" />
      <path d="M4 20a2.5 2.5 0 0 1 2.5-2.5H20M8 7h8M8 10h5" />
    </svg>
  );
}

export function IconEmployees(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <circle cx="17.5" cy="9.5" r="2.6" />
      <path d="M15.5 14.5a4.5 4.5 0 0 1 5 4.6" />
    </svg>
  );
}

export function IconWorld(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.5 4 5.5 4 9s-1.5 6.5-4 9" />
      <path d="M12 3c-2.5 2.5-4 5.5-4 9s1.5 6.5 4 9" />
      <path d="M5 6.5h14" />
      <path d="M5 17.5h14" />
    </svg>
  );
}

export function IconChatProduct(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M3 6h11a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H8l-2.5 2.5V14H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" />
      <path
        d="M8 11h10a2 2 0 0 1 2 2v4a1 1 0 0 1-1 1h-2.5L14 20.5V18H8a2 2 0 0 1-2-2v-.5"
        opacity="0.45"
      />
    </svg>
  );
}

export function IconGear(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7.1 5l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </svg>
  );
}

export function IconCollapse(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export function IconSearch(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </svg>
  );
}

export function IconPlus(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)} strokeWidth={2}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function IconSend(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)} strokeWidth={2.2}>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

export function IconAttach(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)} strokeWidth={2}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function IconImage(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)} strokeWidth={1.8}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

export function IconFile(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)} strokeWidth={1.8}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

export function IconCamera(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)} strokeWidth={1.8}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

export function IconTrash(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)} strokeWidth={1.8}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

export function IconCheck(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)} strokeWidth={2}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function IconChevronDown(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)} strokeWidth={1.8}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function IconX(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)} strokeWidth={1.8}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function IconKey(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)} strokeWidth={1.8}>
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

export function IconCopy(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)} strokeWidth={1.8}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
