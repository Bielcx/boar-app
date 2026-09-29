import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import pt from "./locales/pt.json";

/**
 * UI localization. Entirely local — no network calls. Until the user picks
 * a language (Settings or the setup wizard), LanguageProvider follows the
 * device locale (settings.ts getLanguageId). English is the
 * source of truth; other locales fall back to it for any missing key so a
 * partial translation never renders blank.
 */
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    pt: { translation: pt },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
