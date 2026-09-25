import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { routerPush, apiRead } = vi.hoisted(() => ({
  routerPush: vi.fn(),
  apiRead: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ getApiBase: () => "https://vndrly.ai", apiFetch: apiRead }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({}), isAuthScopeCurrent: () => true }));

vi.mock("expo-router", () => ({
  router: { push: routerPush },
}));

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    foreground: "#ffffff",
    primary: "#2563eb",
    muted: "#333333",
  }),
}));

import AssistantMarkdown from "@/components/AssistantMarkdown";

afterEach(() => {
  cleanup();
  routerPush.mockClear();
});

describe("AssistantMarkdown", () => {
  it("refuses an exact Work Hub link when its access has been revoked", async () => {
    apiRead.mockRejectedValueOnce(new Error("Access revoked"));
    render(<AssistantMarkdown text="[Open task](/work-hub/search?type=task&item=7be22c7d-4638-4144-bb18-0d2a66996a43)" />);
    fireEvent.click(screen.getByText("Open task"));
    await waitFor(() => expect(apiRead).toHaveBeenCalled());
    expect(routerPush).not.toHaveBeenCalled();
  });
  it("renders partner catalog link label without raw markdown brackets", () => {
    render(
      <AssistantMarkdown text="[Open Partner Catalog →](VNDRLY-deep-link:partner catalog)" />,
    );
    expect(screen.getByText("Open Partner Catalog →")).toBeTruthy();
    expect(screen.queryByText(/\[Open Partner Catalog/)).toBeNull();
  });

  it("navigates to native ticket screen when ticket link is pressed", () => {
    render(
      <AssistantMarkdown text="[Open ticket #42](/tickets/42)" />,
    );
    fireEvent.click(screen.getByText("Open ticket #42"));
    expect(routerPush).toHaveBeenCalledWith("/ticket/42");
  });

  it("parses bold-wrapped ticket links and navigates on press", () => {
    render(
      <AssistantMarkdown text="**[Open ticket #99](/tickets/99)**" />,
    );
    expect(screen.queryByText(/\*\*/)).toBeNull();
    fireEvent.click(screen.getByText("Open ticket #99"));
    expect(routerPush).toHaveBeenCalledWith("/ticket/99");
  });
});
