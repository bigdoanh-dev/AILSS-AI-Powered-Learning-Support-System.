import React, { useState, useRef, useEffect } from "react";
import { useLanguage, type SupportedLanguage } from "../lib/i18n";

export function LanguageSwitcher() {
  const { language, setLanguage, currentOption, languages, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    const index = languages.findIndex((option) => option.code === language);
    setActiveIndex(index);
    optionsRef.current[index]?.focus();
  }, [open, language, languages]);

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
    triggerRef.current?.focus();
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
        ref={triggerRef}
        type="button"
        className="language-switcher-button"
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
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
        <ul className="language-dropdown-menu" role="listbox" aria-label={t("header.selectLanguage")}>
          {languages.map((lang, index) => {
            const isSelected = lang.code === language;
            return (
              <li
                key={lang.code}
                ref={(node) => {
                  optionsRef.current[index] = node;
                }}
                role="option"
                tabIndex={activeIndex === index ? 0 : -1}
                aria-selected={isSelected}
                className={`language-option-item ${isSelected ? "selected" : ""}`}
                onClick={() => handleSelect(lang.code)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleSelect(lang.code);
                  } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                    event.preventDefault();
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? languages.length - 1
                          : (index + (event.key === "ArrowDown" ? 1 : -1) + languages.length) %
                            languages.length;
                    setActiveIndex(next);
                    optionsRef.current[next]?.focus();
                  } else if (event.key === "Tab") setOpen(false);
                }}
              >
                <span className="option-flag" aria-hidden="true">
                  {lang.flag}
                </span>
                <div className="option-text">
                  <span className="option-name">{lang.nativeName}</span>
                  {lang.nativeName !== lang.name && <span className="option-sub">({lang.name})</span>}
                </div>
                {isSelected && (
                  <span className="option-check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
