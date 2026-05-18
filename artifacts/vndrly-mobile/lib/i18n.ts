import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import i18n, { type LanguageDetectorAsyncModule } from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import es from "./locales/es.json";

const STORAGE_KEY = "vndrly.lng";
export const SUPPORTED_LANGUAGES = ["en", "es"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return (
    typeof value === "string" &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}

function pickDeviceLanguage(): SupportedLanguage {
  try {
    const locales = Localization.getLocales();
    for (const locale of locales) {
      const code = locale.languageCode?.toLowerCase();
      if (code && isSupportedLanguage(code)) {
        return code;
      }
    }
  } catch {
    // ignore and fall through
  }
  return "en";
}

const detector: LanguageDetectorAsyncModule = {
  type: "languageDetector",
  async: true,
  init: () => undefined,
  detect: async (): Promise<string> => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) return stored;
    } catch {
      // fall through to device locale
    }
    return pickDeviceLanguage();
  },
  cacheUserLanguage: async (lng: string) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, lng);
    } catch {
      // ignore
    }
  },
};

if (!i18n.isInitialized) {
  i18n
    .use(detector)
    .use(initReactI18next)
    .init({
      fallbackLng: "en",
      compatibilityJSON: "v4",
      interpolation: { escapeValue: false },
      resources: {
        en: { translation: en },
        es: { translation: es },
      },
      react: { useSuspense: false },
    });
}

export async function setLanguage(lng: SupportedLanguage) {
  await i18n.changeLanguage(lng);
  await AsyncStorage.setItem(STORAGE_KEY, lng);
}

export default i18n;
