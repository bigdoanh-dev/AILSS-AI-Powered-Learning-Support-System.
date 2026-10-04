import { useUiText } from "../lib/i18n";
import { Link } from "react-router-dom";
export function Logo() {
  const uiText = useUiText();
  return (
    <Link className="logo" to="/" aria-label={uiText("AILSS — Trang chủ")}>
      <svg viewBox="0 0 64 64" width="44" height="44" aria-hidden="true">
        <path
          d="M8 50V12h8l23 34V12h9l10 10v22L46 54H34L16 28v22"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinejoin="miter"
        />
        <path d="m16 12 18 27 5-8" fill="none" stroke="currentColor" strokeWidth="3" />
      </svg>
      <span>
        <strong>{uiText("AILSS")}</strong>
        <small>{uiText("Học hôm nay. Vững ngày mai.")}</small>
      </span>
    </Link>
  );
}
