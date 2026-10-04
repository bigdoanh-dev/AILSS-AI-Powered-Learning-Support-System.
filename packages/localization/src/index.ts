import { ENGLISH_MESSAGES } from "./catalog";

export type SupportedLanguage = "vi" | "en";
export type InterfaceMessage =
  | string
  | {
      readonly interfaceMessage: true;
      readonly source: string;
      readonly values: readonly unknown[];
    };
/** Store authored feedback with its values so it follows later language changes. */
export function interfaceMessage(source: string, values: readonly unknown[] = []): InterfaceMessage {
  return { interfaceMessage: true, source, values };
}
export const SUPPORTED_LANGUAGES = ["vi", "en"] as const;
export const LANGUAGE_OPTIONS = [
  { code: "vi" as const, name: "Tiếng Việt", nativeName: "Tiếng Việt", flag: "🇻🇳", shortLabel: "VI" },
  { code: "en" as const, name: "English", nativeName: "English", flag: "🇬🇧", shortLabel: "EN" },
];

export function normalizeLanguage(value: unknown): SupportedLanguage {
  return value === "en" ? "en" : "vi";
}
export function languageLocale(language: SupportedLanguage): "vi-VN" | "en-US" {
  return language === "en" ? "en-US" : "vi-VN";
}

/** Exact-match translation, including surrounding whitespace. Unknown content is preserved. */
export function translateInterface(source: string, language: SupportedLanguage): string {
  const key = source.replace(/\s+/g, " ").trim();
  const translated = language === "en" ? NORMALIZED_ENGLISH_MESSAGES[key] : VIETNAMESE_MESSAGES[key];
  if (typeof translated !== "string" || !translated) return source;
  const leading = source.match(/^\s*/u)?.[0] ?? "";
  const trailing = source.match(/\s*$/u)?.[0] ?? "";
  return leading + translated + trailing;
}
const NORMALIZED_ENGLISH_MESSAGES: Record<string, string> = Object.fromEntries(
  Object.entries(ENGLISH_MESSAGES).map(([vi, en]) => [vi.replace(/\s+/g, " ").trim(), en]),
);
const VIETNAMESE_MESSAGES: Record<string, string> = Object.fromEntries(
  Object.entries(ENGLISH_MESSAGES).map(([vi, en]) => [en.replace(/\s+/g, " ").trim(), vi]),
);

/** Placeholders are replaced after translation, so user values are never translated. */
export function formatInterface(
  message: InterfaceMessage,
  language: SupportedLanguage,
  values: readonly unknown[] = [],
): string {
  const source = typeof message === "string" ? message : message.source;
  const parameters = typeof message === "string" ? values : message.values;
  return translateInterface(source, language).replace(/\{(\d+)\}/g, (placeholder, index: string) =>
    Number(index) < parameters.length ? formatValue(parameters[Number(index)], language) : placeholder,
  );
}
function formatValue(value: unknown, language: SupportedLanguage): string {
  if (
    value &&
    typeof value === "object" &&
    "interfaceMessage" in value &&
    value.interfaceMessage === true &&
    "source" in value &&
    typeof value.source === "string" &&
    "values" in value &&
    Array.isArray(value.values)
  )
    return formatInterface(value as Exclude<InterfaceMessage, string>, language);
  return String(value);
}
