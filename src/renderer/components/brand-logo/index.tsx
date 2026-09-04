import { cls } from "reactutils";
import iconUrl from "../../assets/icon.avif";
import "./index.css";

export function BrandLogo({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}): React.JSX.Element {
  return (
    <img
      className={cls("imb-brand-logo", className)}
      style={style}
      src={iconUrl}
      alt="imboss"
    />
  );
}
