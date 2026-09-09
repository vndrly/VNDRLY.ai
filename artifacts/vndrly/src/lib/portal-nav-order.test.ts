import { describe, expect, it } from "vitest";
import { orderPortalNavigation } from "./portal-nav-order";

describe("portal navigation priority", () => {
  it.each(["vendor", "partner"])("puts Dashboard, Analytics, Work Hub first without changing %s routes", (role) => {
    const items = [
      { key: "dashboard", href: "/" }, { key: "partners", href: "/partners" },
      { key: "work-hub", href: "/work-hub" }, { key: "employees", href: "/field-employees" },
      { key: "analytics", href: `/analytics/${role}/42` }, { key: "reports", href: "/reports" },
    ];
    expect(orderPortalNavigation(items, role)).toEqual([items[0], items[4], items[2], items[1], items[3], items[5]]);
    expect(items[1].key).toBe("partners");
  });
  it("does not invent Analytics for a role that cannot access it", () => {
    const items = [{ key: "dashboard" }, { key: "partners" }, { key: "work-hub" }];
    expect(orderPortalNavigation(items)).toEqual([items[0], items[2], items[1]]);
  });
  it.each([
    { role: "vendor", keys: ["dashboard", "analytics", "work-hub", "vendors", "partners", "employees"] },
    { role: "partner", keys: ["dashboard", "analytics", "work-hub", "partners", "vendors", "employees"] },
  ])("puts the active $role organization first without changing any link", ({ role, keys }) => {
    const items = [
      { key: "dashboard", href: "/" }, { key: "partners", href: role === "partner" ? "/partners/8" : "/partners" },
      { key: "vendors", href: role === "vendor" ? "/vendors/42" : "/vendors" }, { key: "employees", href: "/field-employees" },
      { key: "work-hub", href: "/work-hub" }, { key: "analytics", href: `/analytics/${role}/42` },
    ];
    const result = orderPortalNavigation(items, role);
    expect(result.map((item) => item.key)).toEqual(keys);
    expect(new Set(result)).toEqual(new Set(items));
  });
  it("leaves non-portal menus alone", () => {
    const items = [{ key: "home" }, { key: "channels" }, { key: "meetings" }];
    expect(orderPortalNavigation(items)).toEqual(items);
  });
});
