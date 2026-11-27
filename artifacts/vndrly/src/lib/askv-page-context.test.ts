import { afterEach, expect, it } from "vitest";
import { readAskVPageContext } from "./askv-page-context";

afterEach(() => { document.body.innerHTML = ""; });
it("identifies the current Add user dialog and entered-field status without exposing field values", () => {
  document.body.innerHTML = `<main><h1>Workforce</h1></main><section role="dialog" aria-labelledby="editor"><h2 id="editor">Add user</h2><form><label for="name">Name</label><input id="name" value="Bob Smith" required><label for="email">Email</label><input id="email" type="email" value="bob@example.test"><label for="password">Password</label><input id="password" type="password" value="private-secret"><button>Create user</button></form></section>`;
  const page = readAskVPageContext("/employees");
  expect(page).toMatchObject({ path: "/employees", title: "Workforce", activity: { title: "Add user", kind: "dialog", fields: [{ label: "Name", filled: true, required: true }, { label: "Email", filled: true }] } });
  expect(JSON.stringify(page)).not.toMatch(/Bob Smith|bob@example|private-secret/);
});
it("tracks a new activity instead of retaining the previous dialog or treating the V panel as the task", () => {
  document.body.innerHTML = `<main><h1>Payroll</h1><form aria-label="Run payroll"><label for="period">Pay period</label><input id="period" required><button>Preview payroll</button></form></main><div data-testid="askv-pane"><form><input aria-label="Message AskV" value="private conversation"></form></div>`;
  document.querySelector<HTMLInputElement>("[aria-label='Message AskV']")!.focus();
  expect(readAskVPageContext("/payroll")).toMatchObject({ title: "Payroll", activity: { title: "Run payroll", kind: "form", fields: [{ label: "Pay period", filled: false, required: true }], controls: [{ label: "Preview payroll", disabled: false }] } });
  expect(JSON.stringify(readAskVPageContext("/payroll"))).not.toContain("Message AskV");
});
it("reports the numbers shown on the Gate activity card, and nothing before they load", () => {
  document.body.innerHTML = `<main><h1>Gate Dashboard</h1><div id="gate-activity-native-slot" data-activity-window="" data-scope-label=""></div></main>`;
  expect(readAskVPageContext("/gate/change-over").activityView).toBeUndefined();
  document.body.innerHTML = `<main><h1>Gate Dashboard</h1><div id="gate-activity-native-slot" data-activity-window="" data-scope-label="" data-check-ins="8" data-check-outs="5" data-pending-admission="0" data-items-to-review="2" data-since="2026-11-20T16:07:00.000Z"></div></main>`;
  expect(readAskVPageContext("/gate/change-over").activityView).toEqual({ window: "current_watch", since: "2026-11-20T16:07:00.000Z", checkIns: 8, checkOuts: 5, awaitingAdmission: 0, itemsToReview: 2 });
  document.body.innerHTML = `<main><h1>Gate Dashboard</h1><div id="gate-activity-native-slot" data-activity-window="24h" data-scope-label="All gates" data-check-ins="0" data-check-outs="0" data-pending-admission="0" data-items-to-review="0"></div></main>`;
  expect(readAskVPageContext("/gate/change-over").activityView).toEqual({ scope: "All gates", window: "24h", checkIns: 0, checkOuts: 0, awaitingAdmission: 0, itemsToReview: 0 });
});
it("retains the active ticket form when the user moves focus to the top AskV interface", () => {
  document.body.innerHTML = `<main><h1>Tickets</h1><form aria-label="Search tickets"><input aria-label="Search"></form><form aria-label="Start ticket"><input id="work" aria-label="Work type" value="Maintenance"></form></main><div data-testid="askv-pane"><input id="askv" aria-label="Message AskV"></div>`;
  document.getElementById("work")!.focus();
  expect(readAskVPageContext("/tickets")).toMatchObject({ activity: { title: "Start ticket" } });
  document.getElementById("askv")!.focus();
  expect(readAskVPageContext("/tickets")).toMatchObject({ activity: { title: "Start ticket", fields: [{ label: "Work type", filled: true }] } });
});
