import { useId } from "react";
import "./index.css";

/**
 * Inline SVG crown logo (prototype `nl-*` gradients, verbatim geometry).
 * Gradient ids are unique per instance (nav + about render it twice).
 */
export function BrandLogo({
  className,
}: {
  className?: string;
}): React.JSX.Element {
  const uid = useId().replace(/[:]/g, "");
  const bg = `nl-bg-${uid}`;
  const cr = `nl-cr-${uid}`;
  const bn = `nl-bn-${uid}`;
  const sh = `nl-sh-${uid}`;
  const bd = `nl-bd-${uid}`;
  const gw = `nl-gw-${uid}`;
  const rb = `nl-rb-${uid}`;
  const dm = `nl-dm-${uid}`;
  const em = `nl-em-${uid}`;
  const clip = `nl-clip-${uid}`;

  return (
    <span className={`imb-brand-logo${className ? ` ${className}` : ""}`}>
      <svg
        viewBox="0 0 512 512"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1a1a20" />
            <stop offset="100%" stopColor="#222228" />
          </linearGradient>
          <linearGradient id={cr} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f2e090" />
            <stop offset="22%" stopColor="#e0c878" />
            <stop offset="50%" stopColor="#c9a84c" />
            <stop offset="78%" stopColor="#a07c2c" />
            <stop offset="100%" stopColor="#806018" />
          </linearGradient>
          <linearGradient id={bn} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d4b85c" />
            <stop offset="100%" stopColor="#906820" />
          </linearGradient>
          <linearGradient id={sh} x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.25)" />
            <stop offset="40%" stopColor="rgba(255,255,255,0.08)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
          <linearGradient id={bd} x1="0.5" y1="0" x2="0.5" y2="1">
            <stop offset="0%" stopColor="#f5f0e8" />
            <stop offset="100%" stopColor="#e8e0d4" />
          </linearGradient>
          <radialGradient id={gw} cx="0.5" cy="0.32" r="0.42">
            <stop offset="0%" stopColor="rgba(201,168,76,0.28)" />
            <stop offset="50%" stopColor="rgba(201,168,76,0.10)" />
            <stop offset="100%" stopColor="rgba(201,168,76,0)" />
          </radialGradient>
          <radialGradient id={rb} cx="0.4" cy="0.35" r="0.6">
            <stop offset="0%" stopColor="#ff6060" />
            <stop offset="50%" stopColor="#d42030" />
            <stop offset="100%" stopColor="#901020" />
          </radialGradient>
          <radialGradient id={dm} cx="0.4" cy="0.35" r="0.6">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="40%" stopColor="#f0ead8" />
            <stop offset="100%" stopColor="#d0c8a8" />
          </radialGradient>
          <radialGradient id={em} cx="0.4" cy="0.35" r="0.6">
            <stop offset="0%" stopColor="#80e0a0" />
            <stop offset="50%" stopColor="#30b060" />
            <stop offset="100%" stopColor="#108040" />
          </radialGradient>
          <clipPath id={clip}>
            <rect width="512" height="512" rx="108" ry="108" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clip})`}>
          <rect width="512" height="512" fill={`url(#${bg})`} />
          <rect width="512" height="512" fill={`url(#${gw})`} />
          <g transform="translate(256,220)">
            <path
              d="M-132,-4 L-124,-105 L-82,-28 L-52,-148 L-16,-35 L0,-178 L16,-35 L52,-148 L82,-28 L124,-105 L132,-4 Z"
              fill={`url(#${cr})`}
            />
            <path
              d="M-132,-4 L-124,-105 L-82,-28 L-52,-148 L-16,-35 L0,-178 L16,-35 L52,-148 L82,-28 L124,-105 L132,-4 Z"
              fill={`url(#${sh})`}
            />
            <rect
              x="-136"
              y="-4"
              width="272"
              height="42"
              rx="8"
              fill={`url(#${bn})`}
            />
            <circle cx="-124" cy="-110" r="7" fill={`url(#${cr})`} />
            <circle cx="-52" cy="-153" r="7" fill={`url(#${cr})`} />
            <circle cx="0" cy="-183" r="9" fill={`url(#${cr})`} />
            <circle cx="52" cy="-153" r="7" fill={`url(#${cr})`} />
            <circle cx="124" cy="-110" r="7" fill={`url(#${cr})`} />
            <circle cx="0" cy="17" r="13" fill={`url(#${rb})`} />
            <circle cx="-3" cy="13" r="3.5" fill="rgba(255,255,255,0.45)" />
            <circle cx="-68" cy="17" r="9" fill={`url(#${dm})`} />
            <circle cx="-70" cy="14" r="2.5" fill="rgba(255,255,255,0.6)" />
            <circle cx="68" cy="17" r="9" fill={`url(#${dm})`} />
            <circle cx="66" cy="14" r="2.5" fill="rgba(255,255,255,0.6)" />
            <circle cx="-108" cy="17" r="7" fill={`url(#${em})`} />
            <circle cx="108" cy="17" r="7" fill={`url(#${em})`} />
            <circle cx="-52" cy="-142" r="5" fill="#f5e6a0" opacity="0.85" />
            <circle cx="0" cy="-168" r="6" fill="#f5e6a0" opacity="0.9" />
            <circle cx="52" cy="-142" r="5" fill="#f5e6a0" opacity="0.85" />
          </g>
          <rect
            x="228"
            y="270"
            width="56"
            height="186"
            rx="28"
            ry="28"
            fill={`url(#${bd})`}
          />
          <rect
            x="250"
            y="292"
            width="3.5"
            height="140"
            rx="1.75"
            fill="rgba(255,255,255,0.10)"
          />
        </g>
      </svg>
    </span>
  );
}
