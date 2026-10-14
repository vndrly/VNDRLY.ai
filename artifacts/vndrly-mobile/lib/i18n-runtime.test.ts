import { it, expect, vi } from "vitest";
import i18n from "i18next";
import en from "./locales/en.json";
import es from "./locales/es.json";
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => "en", setItem: async () => {} },
}));
vi.mock("expo-localization", () => ({
  getLocales: () => [{ languageCode: "en" }],
}));
it("refreshes new Work Hub labels when the runtime was already initialized", async () => {
  await i18n.init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: {
        translation: {
          common: { close: "Close" },
          formCampaignLabels: { c001: "Old label" },
        },
      },
      es: { translation: {} },
    },
  });
  await import("./i18n");
  expect(i18n.language).toBe("en");
  expect(i18n.t("formCampaignLabels.c001")).toBe(en.formCampaignLabels.c001);
  expect(i18n.t("formCampaignLabels.c061")).toBe(en.formCampaignLabels.c061);
  expect(i18n.t("meetingScheduling.date")).toBe(en.meetingScheduling.date);
  expect(i18n.t("meetingWorkspace.audio.moveHere")).toBe(
    en.meetingWorkspace.audio.moveHere,
  );
  expect(i18n.t("workHub.title")).toBe(en.workHub.title);
  await i18n.changeLanguage("es");
  expect(i18n.t("formCampaignLabels.c001")).toBe(es.formCampaignLabels.c001);
  expect(i18n.t("meetingScheduling.date")).toBe(es.meetingScheduling.date);
});
