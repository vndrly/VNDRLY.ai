import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Task #484 — field employees can pick their language from the in-app
// toggle on the field-home/profile surface (web). The toggle is the
// existing <LanguageToggle /> component, which writes the chosen
// language to the persistent `users.preferred_language` column via
// `PATCH /api/auth/me/language`. This test pins that contract:
//   1. clicking ES on a logged-in toggle calls the language endpoint
//      with `{ language: "es" }` and credentials included
//   2. clicking the currently-active button is a no-op (no API call)
//   3. for an unauthenticated visitor (no `user`) the toggle still
//      flips i18n locally but does NOT hit the endpoint, so the
//      pre-login login screen / visitor flows do not 401-spam the API
// Without this regression net, a future refactor of the toggle could
// silently stop persisting the preference and field employees would
// be back to asking a vendor admin to flip it for them.
//
// Task #838 — adds confirmation/error toast feedback on top of the
// persistence call. The mock below now provides a `t` function on
// `useTranslation` so the toast titles can be rendered, and we assert
// `useToast` is invoked with the expected title on success and with
// the destructive variant on a failed save.

const setPreferredLanguageMock = vi.fn();
let mockUser: { preferredLanguage: "en" | "es" | null } | null = {
  preferredLanguage: "en",
};
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: mockUser,
    setPreferredLanguage: setPreferredLanguageMock,
  }),
}));

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

const changeLanguageMock = vi.fn();
// Translate language-name keys to readable English so the success
// toast assertion can match a stable string. Any other key is
// returned verbatim, mirroring i18next's "missing key" fallback.
const translate = (key: string, opts?: Record<string, unknown>) => {
  if (key === "languageToggle.spanish") return "Español";
  if (key === "languageToggle.english") return "English";
  if (key === "languageToggle.savedToast") {
    const lang = opts?.language ?? "";
    return `Saved — ${lang}`;
  }
  if (key === "languageToggle.saveFailedToast") {
    return "Couldn't save your language preference. Please try again.";
  }
  return key;
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: translate,
    i18n: {
      language: "en",
      changeLanguage: (lng: string) => {
        changeLanguageMock(lng);
        return Promise.resolve();
      },
    },
  }),
}));

import LanguageToggle from "./language-toggle";

const ORIG_FETCH = global.fetch;

describe("LanguageToggle", () => {
  beforeEach(() => {
    setPreferredLanguageMock.mockReset();
    changeLanguageMock.mockReset();
    toastMock.mockReset();
    mockUser = { preferredLanguage: "en" };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = ORIG_FETCH;
  });

  it("persists the language to PATCH /api/auth/me/language when an authed user picks ES", async () => {
    render(<LanguageToggle />);
    await userEvent.click(screen.getByTestId("lang-es"));

    expect(changeLanguageMock).toHaveBeenCalledWith("es");
    expect(setPreferredLanguageMock).toHaveBeenCalledWith("es");

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/auth\/me\/language$/);
    expect(init.method).toBe("PATCH");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({ language: "es" });
  });

  it("is a no-op when the user clicks the already-active language", async () => {
    render(<LanguageToggle />);
    await userEvent.click(screen.getByTestId("lang-en"));

    expect(changeLanguageMock).not.toHaveBeenCalled();
    expect(setPreferredLanguageMock).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("does not call the persistence endpoint when there is no logged-in user", async () => {
    mockUser = null;
    render(<LanguageToggle />);
    await userEvent.click(screen.getByTestId("lang-es"));

    // i18n still flips so the unauthenticated UI re-renders in Spanish,
    // but we must not poke the protected endpoint without credentials.
    expect(changeLanguageMock).toHaveBeenCalledWith("es");
    expect(setPreferredLanguageMock).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    // No persistence attempt → no save/failed toast either; the
    // visitor flow stays silent.
    expect(toastMock).not.toHaveBeenCalled();
  });

  // Task #838 — confirmation toast on a successful save. Without
  // this assertion, a regression that removed the success branch
  // would land silently and field employees would lose the
  // explicit "your choice was saved" cue.
  it("shows a confirmation toast with the chosen language name on success", async () => {
    render(<LanguageToggle />);
    await userEvent.click(screen.getByTestId("lang-es"));

    // Wait a microtask for the awaited fetch to resolve and the
    // success branch to fire its toast.
    await Promise.resolve();
    await Promise.resolve();

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith({ title: "Saved — Español" });
  });

  // Task #838 — failure toast surfaces the rare network/server
  // failure instead of being silently swallowed. The component
  // both treats a non-OK response and a thrown error as failure.
  it("shows a destructive toast when the persistence call fails", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) }) as unknown as typeof fetch;
    render(<LanguageToggle />);
    await userEvent.click(screen.getByTestId("lang-es"));

    await Promise.resolve();
    await Promise.resolve();

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith({
      variant: "destructive",
      title: "Couldn't save your language preference. Please try again.",
    });
  });

  it("shows a destructive toast when the persistence call rejects", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch;
    render(<LanguageToggle />);
    await userEvent.click(screen.getByTestId("lang-es"));

    await Promise.resolve();
    await Promise.resolve();

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith({
      variant: "destructive",
      title: "Couldn't save your language preference. Please try again.",
    });
  });
});
