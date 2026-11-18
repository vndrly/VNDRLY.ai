import { parseVoicePageContext, type VoicePageContext } from "@workspace/gate-booth";
const assistant = "[data-testid='askv-pane'], [data-testid='assistant-panel']";
let lastForm: { path: string; form: HTMLFormElement } | undefined;
const visible = (element: Element) => !element.closest(`${assistant}, [hidden], [aria-hidden='true']`) && getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden";
const name = (element: Element | null): string => {
  if (!element) return "";
  const labelled = element.getAttribute("aria-labelledby")?.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? "").join(" ");
  return (element.getAttribute("aria-label") || labelled || (element as HTMLInputElement).labels?.[0]?.textContent || element.getAttribute("placeholder") || "").trim().slice(0, 100);
};
/** Current rendered activity, not a copy of form values or assistant conversation text. */
export function readAskVPageContext(path: string): VoicePageContext {
  const main = document.querySelector("main") ?? document.body;
  const dialog = [...document.querySelectorAll("[role='dialog']")].filter(visible).at(-1);
  const focused = document.activeElement && visible(document.activeElement) ? document.activeElement : null;
  const focusedForm = focused?.closest("form");
  if (focusedForm) lastForm = { path, form: focusedForm };
  const form = focusedForm ?? (lastForm?.path === path && lastForm.form.isConnected && visible(lastForm.form) ? lastForm.form : undefined) ?? [...main.querySelectorAll("form")].find(visible);
  const scope = dialog ?? form ?? main;
  const title = main.querySelector("h1")?.textContent?.trim().slice(0, 160);
  const activityTitle = name(scope) || scope.querySelector("h1,h2,h3,legend")?.textContent?.trim().slice(0, 160) || title || path;
  const fields = [...scope.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea")]
    .filter(element => visible(element) && !["hidden", "password", "submit", "button"].includes(element.type))
    .map(element => ({ label: name(element), filled: Boolean(element.value.trim()), required: element.required || element.getAttribute("aria-required") === "true", invalid: element.getAttribute("aria-invalid") === "true" })).filter(field => field.label);
  const controls = [...scope.querySelectorAll<HTMLButtonElement>("button,input[type='submit']")].filter(visible)
    .map(element => ({ label: name(element) || element.textContent?.trim().slice(0, 100) || "", disabled: element.disabled }));
  const log = document.querySelector<HTMLElement>("[data-testid='gate-history-page']");
  const map = document.querySelector<HTMLElement>("[data-askv-map]");
  const mapView = map ? { target: map.dataset.mapTarget, state: map.dataset.focusState } : undefined;
  const recordsView = log ? { loading: log.dataset.loading === "true", error: log.dataset.error === "true", page: Number(log.dataset.page), total: Number(log.dataset.recordCount), records: [...log.querySelectorAll<HTMLElement>("[data-testid='gate-history-row']")].map(row => `${row.dataset.person ?? ""} | in ${row.dataset.entry ?? "unknown"} | out ${row.dataset.exit || "not recorded"}`) } : undefined;
  return parseVoicePageContext({ path, title, parameters: Object.fromEntries(new URLSearchParams(window.location.search)), recordsView, mapView, activity: { title: activityTitle, kind: dialog ? "dialog" : form ? "form" : "page", currentField: name(focused), fields, controls } })!;
}
export function subscribeAskVPageContext(listener: () => void): () => void {
  let queued = false, disposed = false;
  const changed = () => { if (!queued) { queued = true; queueMicrotask(() => { queued = false; if (!disposed) listener(); }); } };
  const input = (event: Event) => { if (event.target instanceof Element && !event.target.closest(assistant)) changed(); };
  const observer = new MutationObserver(records => {
    if (records.some(record => record.type === "attributes" && record.target instanceof Element && record.target.matches("[data-testid='gate-history-page'],[data-askv-map]"))) changed();
    if (records.some(record => record.target instanceof Element && !record.target.closest(assistant) &&
      [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches("form,[role='dialog'],h1,h2") || node.querySelector("form,[role='dialog'],h1,h2"))))) changed();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-loading", "data-error", "data-page", "data-record-count", "data-from", "data-to", "data-site-id", "data-station-id", "data-focus-state", "data-map-target"] });
  window.addEventListener("popstate", changed);
  for (const event of ["input", "change", "focusin", "click"]) document.addEventListener(event, input);
  return () => { disposed = true; observer.disconnect(); window.removeEventListener("popstate", changed); for (const event of ["input", "change", "focusin", "click"]) document.removeEventListener(event, input); };
}
