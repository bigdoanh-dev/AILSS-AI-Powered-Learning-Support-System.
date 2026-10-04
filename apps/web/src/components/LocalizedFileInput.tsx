import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { useUiText } from "../lib/i18n";
import "./localized-file-input.css";

/** Keep the native file picker and FormData; only its visible UI copy is app-owned. */
export function LocalizedFileInput({
  onChange,
  style,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  const uiText = useUiText();
  const [names, setNames] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = inputRef.current?.form;
    const reset = () => setNames([]);
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, []);
  return (
    <span className={`localized-file-input ${props.disabled ? "is-disabled" : ""}`} style={style}>
      <span className="localized-file-input-choice" aria-hidden="true">
        {uiText("Chọn tệp")}
      </span>
      <span className="localized-file-input-name" aria-hidden="true">
        {names.length ? names.join(", ") : uiText("Chưa chọn tệp")}
      </span>
      <input
        {...props}
        ref={inputRef}
        type="file"
        className={className}
        title={props.title ?? uiText("Chọn tệp")}
        onChange={(event) => {
          onChange?.(event);
          // A parent may clear the input immediately after consuming a file.
          setNames(Array.from(event.currentTarget.files ?? [], (file) => file.name));
        }}
      />
    </span>
  );
}
