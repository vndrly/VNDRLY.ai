import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import en from "@/lib/locales/en.json";
import es from "@/lib/locales/es.json";
import { FilesInventory } from "./FilesInventory";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api, getApiBase: () => "https://example.test" }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: 1 }), isAuthScopeCurrent: () => true, subscribeUser: () => () => {}, subscribeToken: () => () => {} }));
vi.mock("@/lib/work-hub-file-upload", () => ({ uploadWorkHubFile: vi.fn() }));
vi.mock("@/lib/photos", () => ({ captureAndUploadImage: vi.fn() }));
vi.mock("@/lib/meeting-files", () => ({ pickMeetingFile: vi.fn() }));
vi.mock("expo-file-system/legacy", () => ({ cacheDirectory: "file:///cache/", downloadAsync: vi.fn(), deleteAsync: vi.fn() }));
vi.mock("expo-sharing", () => ({ isAvailableAsync: vi.fn(), shareAsync: vi.fn() }));
vi.mock("expo-crypto", () => ({ CryptoDigestAlgorithm: { SHA256: "SHA-256" }, digest: vi.fn() }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#00adb5", name: "MidCon" }) }));
vi.mock("@/hooks/useColors", async () => {
  const { default: palette } = await import("@/constants/colors");
  return { useColors: () => palette.dark };
});

const asset = { id: "asset-1", name: "Radio 4", category: "Radio", status: "checked_out", condition: "good", version: 1, policy: { expectedReturnRequired: true, photosRequiredOnCheckout: false, photosRequiredOnReturn: false, supervisorApprovalRequired: false }, capabilities: { canCheckOut: true, canReturn: false, canVerifyIssued: false } };
const props = {
  owner: { type: "vendor" as const, id: 7 },
  capabilities: { canUploadFile: true, canCreateNote: true, canEditNote: true, canCreateAsset: false, canManageAsset: false, canCheckOutAsset: true, canVerifyIssuedAsset: true, canViewExports: false, allowedExportDatasets: [], canManageGateLocations: false },
  files: [{ id: "file-1", data: { name: "Gate log.pdf", scope: "company", currentFileId: "version-1" }, createdBy: 12 }],
  notes: [], assets: [asset], channels: [{ id: "channel-1", name: "Gate A", ownerOrgType: "vendor" as const, ownerOrgId: 7, contextKind: "organization", contextId: "7" }, { id: "channel-2", name: "Gate B", ownerOrgType: "vendor" as const, ownerOrgId: 7, contextKind: "organization", contextId: "7" }], onRefresh: vi.fn(),
};
async function mount(language = "en") {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng: language, resources: { en: { translation: en }, es: { translation: es } }, interpolation: { escapeValue: false } });
  return render(<I18nextProvider i18n={i18n}><FilesInventory {...props} /></I18nextProvider>);
}
afterEach(() => { cleanup(); mocks.api.mockReset(); });

describe("Files & Inventory accessible localized presentation", () => {
  it("keeps validation text above 4.5:1 contrast on the dark surface", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Check out Radio 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm checkout" }));
    const style = getComputedStyle(await screen.findByRole("alert"));
    const luminance = (css: string) => {
      const [r, g, b] = css.match(/\d+/g)!.slice(0, 3).map(Number).map(n => n / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor === "rgba(0, 0, 0, 0)" ? "rgb(58, 61, 66)" : style.backgroundColor);
    expect((Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
  it.each([
    ["en", "Radio · Checked out · Good", "File · Company · User 12"],
    ["es", "Radio · Retirado · Bueno", "Archivo · Empresa · Usuario 12"],
  ])("translates status, condition, and file scope in %s", async (language, inventory, metadata) => {
    await mount(language);
    expect(screen.getByText(inventory)).toBeTruthy();
    expect(screen.getByText((text) => text.startsWith(metadata))).toBeTruthy();
    expect(screen.queryByText(/checked_out/)).toBeNull();
  });

  it("announces selected groups and condition and disables them during a custody request", async () => {
    mocks.api.mockImplementation(() => new Promise(() => {}));
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "File group Gate A" }));
    expect(screen.getByRole("button", { name: "File group Gate A" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Check out Radio 4" }));
    expect(screen.getByRole("button", { name: "Good" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.change(screen.getByLabelText("Expected return"), { target: { value: "2026-10-01T12:00:00Z" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm checkout" }));
    expect(screen.getByRole("button", { name: "Good" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("button", { name: "File group Gate A" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("focuses an invalid expected-return field and announces its validation error", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Check out Radio 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm checkout" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    const input = screen.getByLabelText("Expected return");
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe("Enter an expected return date and time.");
  });

  it("gives note and custody inputs a 44-point target", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Add Note" }));
    fireEvent.click(screen.getByRole("button", { name: "Check out Radio 4" }));
    for (const label of ["Note title", "Expected return"]) expect(Number.parseFloat(screen.getByLabelText(label).style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it("focuses an empty note title and associates its validation message", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Add Note" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Note" }));
    await screen.findByRole("alert");
    const input = screen.getByLabelText("Note title");
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe("Choose a group and enter a title.");
  });
});
