import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import es from "./locales/es.json";

// Embedded Gate pages follow Profile's app language, not another browser session's cache.
const embedParams = new URLSearchParams(window.location.search);
const requestedLanguage = embedParams.get("gateLanguage");
export const embeddedLanguage = embedParams.get("gateDashboardEmbed") === "1" &&
  (requestedLanguage === "en" || requestedLanguage === "es") ? requestedLanguage : undefined;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
    fallbackLng: "en",
    lng: embeddedLanguage,
    supportedLngs: ["en", "es"],
    // English is the default; saved Profile choices remain authoritative.
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    interpolation: { escapeValue: false },
    detection: {
      // No browser-language inference. Only a saved explicit preference overrides English.
      order: ["localStorage"],
      lookupLocalStorage: "vndrly_lang",
      caches: embeddedLanguage ? [] : ["localStorage"],
    },
  });

export default i18n;
