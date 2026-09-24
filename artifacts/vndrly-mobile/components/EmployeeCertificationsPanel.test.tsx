import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiFetch, translate } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  translate: (key: string) => key,
}));

vi.mock("@/lib/api", () => ({
  apiFetch,
  getApiBase: () => "https://vndrly.example",
}));
vi.mock("@expo/vector-icons", () => ({
  Feather: ({ name }: { name: string }) => <span>{name}</span>,
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#111111",
    border: "#555555",
    card: "#242426",
    destructive: "#ff3333",
    foreground: "#ffffff",
    mutedForeground: "#aaaaaa",
    primary: "#18b9c7",
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));
vi.mock("@/components/AuthedImage", () => ({
  default: ({ uri, testID }: { uri: string; testID?: string }) => (
    <img src={uri} data-testid={testID} />
  ),
}));

import EmployeeCertificationsPanel from "./EmployeeCertificationsPanel";

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
});

describe("EmployeeCertificationsPanel credential photo viewer", () => {
  it("opens and closes the stored private credential photo", async () => {
    apiFetch.mockResolvedValueOnce([
      {
        id: 91,
        name: "PEC",
        issuer: "Veriforce",
        certNumber: "PEC-123",
        issuedDate: null,
        expirationDate: "2027-01-01",
        documentUrl: "/api/storage/objects/uploads/credential-photo",
        documentPath: "/objects/uploads/credential-photo",
      },
    ]);

    render(<EmployeeCertificationsPanel employeeId={7} />);

    const open = await screen.findByTestId("button-view-cert-photo-91");
    fireEvent.click(open);
    expect(screen.getByTestId("cert-photo-modal")).toBeTruthy();
    expect(screen.getByTestId("cert-photo-image").getAttribute("src")).toContain(
      "/api/storage/objects/uploads/credential-photo",
    );

    fireEvent.click(screen.getByTestId("button-close-cert-photo"));
    await waitFor(() => expect(screen.queryByTestId("cert-photo-image")).toBeNull());
  });
});
