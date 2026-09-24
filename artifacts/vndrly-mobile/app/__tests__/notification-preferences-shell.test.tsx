import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { apiFetchMock, dismissToMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  dismissToMock: vi.fn(),
}));

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#111",
    foreground: "#fff",
    card: "#222",
    border: "#666",
    primary: "#09b6c7",
    mutedForeground: "#aaa",
  }),
}));

vi.mock("expo-router", () => ({
  router: { dismissTo: (...args: unknown[]) => dismissToMock(...args) },
  Stack: { Screen: () => null },
  usePathname: () => "/(tabs)/gate-notification-preferences",
}));

vi.mock("@/components/BrandTitleRow", () => ({ default: () => <div /> }));
vi.mock("@/components/AskVVoiceIndicator", () => ({
  default: () => <div data-testid="preferences-inline-askv" />,
}));
vi.mock("@/components/SphereBackButton", () => ({
  default: ({ onPress, testID }: { onPress: () => void; testID: string }) => (
    <button data-testid={testID} onClick={onPress}>Back</button>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "notifications.preferencesTitle": "Notification settings",
      "notifications.save": "Save preferences",
      "notifications.dnd": "Do Not Disturb",
      "notifications.dndDesc": "Suppress push notifications during these hours.",
      "notifications.dndStart": "Start hour",
      "notifications.dndEnd": "End hour",
    } as Record<string, string>)[key] ?? key,
  }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import NotificationPreferencesScreen from "../notification-preferences";

describe("Notification Preferences iPad shell", () => {
  afterEach(() => cleanup());

  it("uses the standard header, returns to Notifications, and right-aligns Save", async () => {
    apiFetchMock.mockResolvedValue({
      ticketsEnabled: true,
      hotlistEnabled: true,
      complianceEnabled: true,
      crewEnabled: true,
      systemEnabled: true,
      pushEnabled: true,
      dndStartHour: null,
      dndEndHour: null,
      commentsEnabled: true,
      commentMentionEmailEnabled: true,
      commentReplyEmailEnabled: true,
    });

    render(<NotificationPreferencesScreen />);

    await waitFor(() => expect(screen.getByText("Do Not Disturb")).toBeTruthy());
    expect(screen.getByTestId("notification-preferences-standard-header")).toBeTruthy();
    expect(screen.getByTestId("preferences-inline-askv")).toBeTruthy();
    expect(screen.getByTestId("notification-preferences-save-row")).toBeTruthy();

    fireEvent.click(screen.getByTestId("notification-preferences-page-back"));
    expect(dismissToMock).toHaveBeenCalledWith("/(tabs)/gate-notifications");
  });
});
