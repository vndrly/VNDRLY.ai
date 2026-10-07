import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: (p: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...p} />
  ),
}));
import { FleetProfileFields } from "./fleet-profile-fields";
it("preserves configured evidence requirements when changing the profile name", () => {
  const onChange = vi.fn();
  const value = {
    name: "Hauling",
    inspectionItems: [],
    manifestFields: [],
    evidenceRequirements: [
      {
        id: "scale",
        label: "Scale",
        kind: "scale" as const,
        scope: "each_load" as const,
        required: true,
      },
    ],
  };
  render(<FleetProfileFields value={value} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Profile name"), {
    target: { value: "Updated" },
  });
  expect(onChange).toHaveBeenCalledWith({ ...value, name: "Updated" });
  expect(screen.getByLabelText("Document type")).toHaveProperty(
    "value",
    "scale",
  );
});
