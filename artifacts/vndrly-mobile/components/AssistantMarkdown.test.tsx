import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { routerPush } = vi.hoisted(() => ({
  routerPush: vi.fn(),
}));

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
