import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import es from "./locales/es.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "es"],
    // Treat region-tagged browser locales (e.g. "es-MX", "en-GB") as
    // matches for our base supported languages so a Spanish-speaking
    // visitor whose browser reports "es-ES" picks up Spanish on first
    // visit instead of falling through to the English fallback. With
    // load: "languageOnly", i18next strips the region and looks up the
    // "es" / "en" resource bundles we actually ship.
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    interpolation: { escapeValue: false },
    detection: {
      // localStorage is checked first so an explicit choice from the
      // language toggle always wins on subsequent visits; only when no
      // preference is stored do we fall through to the browser's
      // preferred language list (navigator.languages / navigator.language).
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "vndrly_lang",
      caches: ["localStorage"],
    },
  });

export default i18n;
