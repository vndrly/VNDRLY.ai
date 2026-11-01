import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { EquipmentItem } from "@workspace/api-zod";
vi.mock("@expo/vector-icons", () => ({ Feather: () => <span /> }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black", primary: "blue" }) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({}) }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: 1 }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled, accessibilityLabel }: any) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button> }));
import EquipmentMapPicker from "./EquipmentMapPicker";
afterEach(cleanup);
const items = [{ id: "booth", name: "Site booth", profile: { trackOnMap: true, equipmentType: "booth", activity: "working" }, location: null }, { id: "truck", name: "Yard truck", profile: { trackOnMap: true, equipmentType: "truck", activity: "in_yard" }, location: { latitude: 31, longitude: -102, freshness: "last_known" } }, { id: "hidden", name: "Private trailer", profile: { trackOnMap: false, equipmentType: "trailer", activity: "unassigned" }, location: null }] as EquipmentItem[];
it("provides SHOW/HIDE in the picker header and labels missing coordinates", () => {
  const show = vi.fn(), select = vi.fn(); render(<EquipmentMapPicker items={items} shown={false} onShow={show} selectedId={null} onSelect={select} />);
  expect(screen.queryByText("SHOW")).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "Reveal Equipment" }));
  fireEvent.click(screen.getByRole("button", { name: "SHOW" })); expect(show).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "HIDE" })); expect(show).toHaveBeenCalledWith(false); expect(select).toHaveBeenCalledWith(null);
  expect(screen.getByRole("button", { name: /Site booth.*Location unavailable/ })).toBeTruthy(); expect(screen.queryByText(/Private trailer/)).toBeNull();
});
it("filters by equipment type and fits only the selected group", () => {
  const select = vi.fn(); render(<EquipmentMapPicker items={items} shown onShow={vi.fn()} selectedId={null} onSelect={select} />);
  fireEvent.click(screen.getByRole("button", { name: "Reveal Equipment" })); fireEvent.click(screen.getByRole("button", { name: "Truck" }));
  expect(screen.queryByRole("button", { name: /Site booth.*Location unavailable/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Fit selected group" })); expect(select).toHaveBeenCalledWith(null, [items[1]]);
});
