import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiFetch, translate, push } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  translate: (key: string) => key,
  push: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiFetch,
  getApiBase: () => "https://vndrly.example",
}));
vi.mock("@expo/vector-icons", () => ({
  Feather: ({ name }: { name: string }) => <span>{name}</span>,
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({user: {userId:1, vendorId:1}}) }));
vi.mock('@react-native-community/datetimepicker', () => ({default: () => null}));
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
  push.mockReset();
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

it("opens the existing VNDRLY/U program from the picker without fetching a company library", async () => {
  apiFetch.mockResolvedValue([]);
  render(<EmployeeCertificationsPanel employeeId={7} />);
  fireEvent.click(await screen.findByTestId("button-add-certification"));
  fireEvent.click(screen.getByTestId("input-cert-name"));
  fireEvent.change(screen.getByLabelText("employees.certifications.searchTypes"), { target: { value: "H2S Clear" } });
  fireEvent.click(screen.getByRole("link", { name: "VNDRLY/U Cert: VNDRLY/U Atmospheric Safety — Hydrogen Sulfide" }));
  expect(push).toHaveBeenCalledWith('/work-hub/bundle/VUC003');
  expect(apiFetch.mock.calls.every(([url]) => !url.includes('/work-hub/library'))).toBe(true);
  expect(apiFetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

it("selects an exact credential and saves only its typed details", async () => {
  apiFetch.mockResolvedValue([]);
  render(<EmployeeCertificationsPanel employeeId={7} />);
  fireEvent.click(await screen.findByTestId("button-add-certification"));
  fireEvent.click(screen.getByTestId("input-cert-name"));
  fireEvent.change(screen.getByLabelText("employees.certifications.searchTypes"), {
    target: { value: "H₂S Clear™" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Veriforce H2S Clear" }));
  fireEvent.change(screen.getByLabelText("Name on credential"), { target: { value: "Sample Worker" } });
  fireEvent.change(screen.getByTestId("input-cert-number"), { target: { value: "TEST-1" } });
  fireEvent.change(screen.getByLabelText("Training provider"), { target: { value: "Sample Provider" } });
  fireEvent.click(screen.getByRole("button", { name: "common.save" }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/field-employees/7/certifications", {
    method: "POST",
    body: expect.any(String),
  }));
  const [, request] = apiFetch.mock.calls.find(([, options]) => options?.method === "POST")!;
  expect(JSON.parse(request.body)).toMatchObject({
    name: "Veriforce H2S Clear",
    certNumber: "TEST-1",
    qualificationDetails: { "Name on credential": "Sample Worker", "Training provider": "Sample Provider" },
  });
});

it("reopens saved qualification details without renaming the credential", async () => {
  apiFetch.mockResolvedValue([{
    id: 22, name: "Respirator Fit Test", certNumber: null,
    qualificationDetails: { "Name on credential": "Sample Worker", "Test date": "2026-11-01", "Legacy field": "keep" },
  }]);
  render(<EmployeeCertificationsPanel employeeId={7} />);
  fireEvent.click(await screen.findByLabelText("common.edit"));
  expect(screen.getByLabelText("Test date")).toHaveProperty("value", "2026-11-01");
  expect(screen.queryByTestId("input-cert-name")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "common.save" }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/field-employees/7/certifications/22", {
    method: "PATCH",
    body: expect.any(String),
  }));
  const [, request] = apiFetch.mock.calls.find(([, options]) => options?.method === "PATCH")!;
  expect(JSON.parse(request.body)).toMatchObject({
    name: "Respirator Fit Test", certNumber: null,
    qualificationDetails: { "Legacy field": "keep", "Test date": "2026-11-01" },
  });
});
