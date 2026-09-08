import { describe, expect, it } from "vitest";
import { buildGateReportPrintDocument } from "./gate-report-print";
describe("complete Gate Log print document", () => {
  it("includes all 120 rows, including other screen pages, without fixed layout ancestors", () => {
    const report = document.createElement("section");
    const table = document.createElement("table"); const body = document.createElement("tbody");
    for (let index = 0; index < 120; index++) {
      const row = body.insertRow(); row.className = index >= 50 ? "hidden print:table-row" : "";
      row.insertCell().textContent = `Record ${index + 1}`;
    }
    table.append(body); report.append(table);
    const pagination = document.createElement("div"); pagination.className = "print:hidden"; pagination.textContent = "Pagination"; report.append(pagination);
    const output = buildGateReportPrintDocument(report, "Gate Report");
    const parsed = new DOMParser().parseFromString(output, "text/html");
    expect(parsed.querySelectorAll("tbody tr")).toHaveLength(120);
    expect(parsed.body.textContent).toContain("Record 120");
    expect(parsed.body.textContent).not.toContain("Pagination");
    expect(output).not.toContain("height:100vh");
  });
  it("keeps entrant text escaped in the separate print document", () => {
    const report = document.createElement("section"); report.textContent = '<script>alert("test")</script>';
    const output = buildGateReportPrintDocument(report, "Gate Report");
    expect(new DOMParser().parseFromString(output, "text/html").querySelector("script")).toBeNull();
  });
});
