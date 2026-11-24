import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ card: "#242426", primary: "#00b8d8", border: "#444", text: "#ececec" }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("@/lib/use-form-campaigns", () => ({ useFormCampaigns: () => ({ data: { items: [], anonymous: [] }, error: "", reload: vi.fn() }) }));
vi.mock("../NativeRepository", () => ({ NativeRepository: ({ filesOnly }: { filesOnly?: boolean }) => <div>{filesOnly ? "Library files" : "Vendor augmented"}</div> }));
vi.mock("./VndrlyUCatalog", () => ({ default: ({ kind }: { kind: string }) => <div>{kind === "programs" ? "Certification catalog" : "Course catalog"}</div> }));

import LibraryWorkspace from "./LibraryWorkspace";

afterEach(cleanup);

it("starts with the certification catalog and opens library files only in their tab", () => {
  render(<LibraryWorkspace canManage />);
  expect(screen.getByText("Certification catalog")).toBeTruthy();
  expect(screen.queryByText("Library files")).toBeNull();
  expect(screen.getByRole("button", { name: "VNDRLY/U Certifications" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "From Library" }));
  expect(screen.getByText("Library files")).toBeTruthy();
  expect(screen.queryByText("Certification catalog")).toBeNull();
});
