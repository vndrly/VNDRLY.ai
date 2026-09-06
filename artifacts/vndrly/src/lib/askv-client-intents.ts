export type AskVClientIntent = {
  name: string;
  arguments?: Record<string, unknown>;
};

export function parseAskVClientIntent(output: string): AskVClientIntent | null {
  try {
    const parsed = JSON.parse(output) as { execution?: string; intent?: AskVClientIntent };
    if (parsed.execution !== "client" || !parsed.intent?.name) return null;
    return parsed.intent;
  } catch {
    return null;
  }
}

let safetyDraft: Record<string, unknown> | null = null;
export function readAskVSafetyDraft() { return safetyDraft; }
export function clearAskVClientDrafts() { safetyDraft = null; }

export function applyAskVClientIntent(intent: AskVClientIntent): { ok: boolean; message: string } {
  const args = intent.arguments ?? {};
  const navigate = (path: unknown) => {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return false;
    const url = new URL(path, window.location.origin);
    if (url.origin !== window.location.origin) return false;
    window.history.pushState({}, '', `${import.meta.env.BASE_URL.replace(/\/$/, '')}${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.dispatchEvent(new CustomEvent('askv:client-intent', { detail: intent }));
    return true;
  };
  if (intent.name === 'prefill_draft' && args.form === 'safety-report') {
    let values: Record<string, unknown>;
    try { values = typeof args.values === 'string' ? JSON.parse(args.values) : args.values as Record<string, unknown>; }
    catch { return { ok: false, message: 'The safety draft was invalid.' }; }
    if (!values || Array.isArray(values) || typeof values !== 'object') return { ok: false, message: 'No safety draft facts were provided.' };
    safetyDraft = Object.fromEntries(Object.entries(values).filter(([key]) => ['title', 'description', 'eventType', 'siteLocationId', 'ticketId'].includes(key)));
    return { ok: navigate(args.path ?? '/safety-report'), message: 'Safety draft prepared for review. It has not been submitted.' };
  }
  if (intent.name === 'open_screen' || intent.name === 'start_ticket_entry') {
    const ok = navigate(args.path);
    return { ok, message: ok ? 'Requested screen opened. The form still requires review and completion.' : 'That screen is unavailable.' };
  }
  if (intent.name === 'launch_scanner') return { ok: navigate('/field/scan'), message: 'Scanner flow opened. Complete the scan on screen.' };
  if (intent.name === 'focus_control') {
    const controlId = String(args.controlId ?? '');
    const control = document.getElementById(controlId) ?? document.querySelector(`[data-testid="${CSS.escape(controlId)}"]`);
    if (!(control instanceof HTMLElement)) return { ok: false, message: 'That control is not on this screen.' };
    control.focus(); control.scrollIntoView?.({ block: 'center' });
    return { ok: true, message: 'Control highlighted. Nothing has been submitted.' };
  }
  if (intent.name === 'launch_camera') {
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept*="image"]');
    if (!input) return { ok: false, message: 'Open the relevant ticket or Gate photo form first, then use its camera control.' };
    input.click(); return { ok: true, message: 'Photo picker requested. Select or take a photo on screen; nothing has been attached yet.' };
  }
  if (intent.name === 'launch_maps') {
    const coordinates = typeof args.latitude === 'number' && Number.isFinite(args.latitude) && Math.abs(args.latitude) <= 90
      && typeof args.longitude === 'number' && Number.isFinite(args.longitude) && Math.abs(args.longitude) <= 180;
    const destination = coordinates ? `${args.latitude},${args.longitude}` : typeof args.query === 'string' ? args.query.trim() : '';
    if (!destination) return { ok: false, message: 'Choose a map destination first.' };
    const opened = window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`, '_blank', 'noopener,noreferrer');
    return { ok: Boolean(opened), message: opened ? 'Maps opened.' : 'Allow the maps popup or open the location link on screen.' };
  }
  return { ok: false, message: 'This client capability is unavailable here.' };
}
