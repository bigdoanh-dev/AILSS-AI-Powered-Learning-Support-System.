import { useCallback, useSyncExternalStore } from "react";
import { getSystemSettings, subscribeSystemSettings } from "./settings";
import { getTranslation } from "./i18n";
import { languageLocale, formatInterface, type InterfaceMessage } from "../../../packages/localization/src";
export { interfaceMessage, type InterfaceMessage } from "../../../packages/localization/src";
export function useLanguage() {
  const { language } = useSyncExternalStore(subscribeSystemSettings, getSystemSettings, getSystemSettings);
  return {
    language,
    locale: languageLocale(language),
    t: (source: string) => getTranslation(source, language),
  };
}
export function useUiText() {
  const { language } = useLanguage();
  return useCallback(
    (source: InterfaceMessage, values?: readonly unknown[]) => formatInterface(source, language, values),
    [language],
  );
}
