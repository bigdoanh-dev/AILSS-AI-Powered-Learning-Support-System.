import React, { useState, useRef, useEffect } from "react";
import { useLanguage, type SupportedLanguage } from "../lib/i18n";

export function LanguageSwitcher() {
  const { language, setLanguage, currentOption, languages, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDownOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handlePointerDownOutside);
      return () => document.removeEventListener("mousedown", handlePointerDownOutside);
    }
  }, [open]);

  const handleSelect = (code: SupportedLanguage) => {
    setLanguage(code);
    setOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className="language-switcher-container"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          containerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
        }
      }}
    >
      <button
        type="button"
        className="language-switcher-button"
        onClick={() => setOpen(!open)}
        aria-label={`${t("header.language")}: ${currentOption.name}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={t("header.selectLanguage")}
      >
        <span className="lang-flag" aria-hidden="true">
          {currentOption.flag}
        </span>
        <span className="lang-code">{currentOption.shortLabel}</span>
        <svg
          className={`lang-caret ${open ? "open" : ""}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <ul
          className="language-dropdown-menu"
          role="listbox"
          aria-label={t("header.selectLanguage")}
        >
          {languages.map((lang) => {
            const isSelected = lang.code === language;
            return (
              <li
                key={lang.code}
                role="option"
                aria-selected={isSelected}
                className={`language-option-item ${isSelected ? "selected" : ""}`}
                onClick={() => handleSelect(lang.code)}
              >
                <span className="option-flag" aria-hidden="true">{lang.flag}</span>
                <div className="option-text">
                  <span className="option-name">{lang.nativeName}</span>
                  {lang.nativeName !== lang.name && (
                    <span className="option-sub">({lang.name})</span>
                  )}
                </div>
                {isSelected && (
                  <span className="option-check" aria-hidden="true">✓</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
