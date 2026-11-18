import type { VoicePageContext } from "./voice-page-context";
/** A reveal request reports the selected authorized data, never just a changed URL. */
export function waitForGateMapView(target: string, read: () => VoicePageContext | undefined, subscribe: (listener: () => void) => () => void): Promise<{ ok: boolean; message: string }> {
  const params = new URLSearchParams(target.split("?")[1] ?? "");
  const expected = params.has("staffUserId") ? "staff:" + params.get("staffUserId") : params.has("equipmentId") ? "equipment:" + params.get("equipmentId") : params.get("reveal");
  return new Promise(resolve => {
    let unsubscribe = () => {};
    const finish = (ok: boolean, message: string) => { clearTimeout(timer); unsubscribe(); resolve({ ok, message }); };
    const check = () => {
      const page = read(), view = page?.mapView;
      if (!page || !/\/(?:gate\/map|gate-map)$/.test(page.path) || !view || view.target !== expected) return;
      if (view.state === "displayed") finish(true, "The requested authorized location is selected and revealed on Gate Map. Preserve its recorded freshness.");
      else if (view.state === "unavailable") finish(false, "Gate Map opened, but no usable shared or recorded location is available for that target. No location was invented.");
      else if (view.state === "error") finish(false, "Gate Map opened, but its location data could not be loaded.");
    };
    const timer = setTimeout(() => finish(false, "Gate Map was requested; its target is still loading. Do not claim that location is displayed yet."), 5000);
    unsubscribe = subscribe(check); check();
  });
}
