import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import EmployeeAccessEditor from "./employee-access-editor";

vi.mock("@/components/png-pill-chrome", () => ({
  PillColorLayer: () => <span />,
}));

afterEach(cleanup);

describe("EmployeeAccessEditor", () => {
  it("allows several operational roles at once", () => {
    const onChange = vi.fn();
    render(
      <EmployeeAccessEditor
        isAdmin={false}
        operationalRoles={["office", "gatekeeper"]}
        siteLocationIds={[22]}
        eligibleSites={[{ id: 22, name: "Big C's Deep" }]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Gate Supervisor" }));
    expect(onChange).toHaveBeenCalledWith({
      operationalRoles: ["office", "gatekeeper", "gate_supervisor"],
      siteLocationIds: [22],
    });
  });

  it("shows inherited access and disables site editing for admins", () => {
    render(
      <EmployeeAccessEditor
        isAdmin
        operationalRoles={["gate_supervisor"]}
        siteLocationIds={[]}
        eligibleSites={[{ id: 22, name: "Big C's Deep" }]}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText("All authorized sites")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Big C's Deep" })).toBeNull();
  });
});
