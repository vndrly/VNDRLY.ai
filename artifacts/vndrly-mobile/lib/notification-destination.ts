import { apiFetch } from "./api";

type WorkKind =
  | "shift"
  | "meeting"
  | "task"
  | "channel"
  | "announcement"
  | "form"
  | "checklist";
export type NotificationTarget =
  | { kind: WorkKind; id: string; messageId?: string }
  | { kind: "credential"; id: string }
  | { kind: "safety"; id: string }
  | { kind: "handoff"; id: string; stationId: string; siteId?: string }
  | { kind: "gate"; id: string; stationId?: string; siteId?: string };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const positiveId = (id: string | null): id is string =>
  !!id && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id));

/** Only destinations with an exact, implemented mobile subject reader are accepted. */
export function parseNotificationTarget(
  href: unknown,
): NotificationTarget | null {
  if (
    typeof href !== "string" ||
    !href.startsWith("/") ||
    href.startsWith("//")
  )
    return null;
  try {
    const decoded = decodeURIComponent(href);
    if (decoded.startsWith("//") || /[\\\s\u0000-\u001f\u007f]/.test(decoded))
      return null;
    if (decoded.split(/[/?#]/).some((part) => part === "." || part === ".."))
      return null;
    const url = new URL(href, "https://notification.invalid");
    if (url.origin !== "https://notification.invalid" || url.hash) return null;
    const path = url.pathname.replace(/^\/\(tabs\)(?=\/)/, "");
    const params = url.searchParams;
    const keys = [...params.keys()];
    if (new Set(keys).size !== keys.length) return null;
    const safetyId = path.match(/^\/safety\/([1-9]\d*)$/)?.[1];
    if (safetyId) return !keys.length && positiveId(safetyId) ? { kind: "safety", id: safetyId } : null;
    if (path === "/profile") {
      const id = params.get("credentialId");
      if (
        keys.some((key) => !["section", "credentialId"].includes(key)) ||
        (params.has("section") && params.get("section") !== "compliance")
      )
        return null;
      return positiveId(id) ? { kind: "credential", id } : null;
    }
    if (["/gate", "/gate-change-over", "/shift-notes"].includes(path)) {
      if (
        keys.some((key) => !["siteId", "stationId", "handoffId"].includes(key))
      )
        return null;
      const siteId = params.get("siteId"),
        stationId = params.get("stationId"),
        handoffId = params.get("handoffId");
      if (
        (siteId && !positiveId(siteId)) ||
        (stationId && !uuid.test(stationId))
      )
        return null;
      if (handoffId)
        return uuid.test(handoffId) && stationId
          ? {
              kind: "handoff",
              id: handoffId,
              stationId,
              ...(siteId ? { siteId } : {}),
            }
          : null;
      if (path === "/shift-notes") return null;
      return stationId || siteId
        ? {
            kind: "gate",
            id: stationId ?? siteId!,
            ...(stationId ? { stationId } : {}),
            ...(siteId ? { siteId } : {}),
          }
        : null;
    }
    if (
      !/^\/work-hub(?:\/(?:channels|tasks|meetings)\/[^/]+|\/calendar|\/tasks)?$/.test(
        path,
      )
    )
      return null;
    if (
      keys.some(
        (key) =>
          ![
            "section",
            "channel",
            "channelId",
            "message",
            "messageId",
            "shift",
            "meeting",
            "task",
            "announcement",
            "form",
            "checklist",
          ].includes(key),
      )
    )
      return null;
    const pathSubject = path.match(
      /^\/work-hub\/(channels|tasks|meetings)\/([^/]+)$/,
    );
    const selectors = [
      "channel",
      "channelId",
      "shift",
      "meeting",
      "task",
      "announcement",
      "form",
      "checklist",
    ].filter((key) => params.has(key));
    if (selectors.length + (pathSubject ? 1 : 0) !== 1) return null;
    const kind = pathSubject
      ? ({ channels: "channel", tasks: "task", meetings: "meeting" } as const)[
          pathSubject[1] as "channels" | "tasks" | "meetings"
        ]
      : selectors[0] === "channelId"
        ? "channel"
        : (selectors[0] as WorkKind);
    const id = pathSubject?.[2] ?? params.get(selectors[0])!;
    const messageId = params.get("messageId") ?? params.get("message");
    if (
      !uuid.test(id) ||
      (params.has("messageId") && params.has("message")) ||
      (messageId && (kind !== "channel" || !uuid.test(messageId)))
    )
      return null;
    return { kind, id, ...(messageId ? { messageId } : {}) };
  } catch {
    return null;
  }
}

type RecordData = Record<string, any>;
export type NotificationDestinationContent = {
  subjectId: string;
  title: string;
  lines: string[];
  kind: NotificationTarget["kind"];
};
function content(
  target: NotificationTarget,
  row: RecordData | undefined | null,
  title?: string,
  extra: string[] = [],
): NotificationDestinationContent {
  if (!row || String(row.id) !== target.id || row.deletedAt || row.withdrawnAt)
    throw new Error("notification.unavailable");
  const lines = [
    row.description,
    row.instructions,
    row.agenda,
    row.body,
    row.notes,
    row.status,
    row.startsAt,
    row.endsAt,
    row.dueAt,
    row.issuer,
    row.certNumber,
    row.expirationDate,
    ...extra,
  ].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return {
    subjectId: target.id,
    title: title ?? row.title ?? row.name ?? "",
    lines,
    kind: target.kind,
  };
}

/** Load actual destination data; never substitute the notification's summary. */
export async function loadNotificationDestination(
  target: NotificationTarget,
): Promise<NotificationDestinationContent> {
  if (target.kind === "safety") {
    const data = await apiFetch<{ data: { event: RecordData } }>(`/api/safety/events/${target.id}`);
    return content(target, data.data?.event);
  }
  if (
    target.kind === "shift" ||
    target.kind === "task" ||
    target.kind === "meeting"
  ) {
    const data = await apiFetch<{ item: RecordData }>(
      `/api/work-hub/calendar/items/${target.kind}/${target.id}`,
    );
    if (target.kind === "meeting")
      return content(
        target,
        data.item?.occurrence && {
          ...data.item.meeting,
          ...data.item.occurrence,
        },
        data.item?.meeting?.title,
      );
    return content(target, data.item);
  }
  if (target.kind === "channel") {
    const endpoint = target.messageId
      ? `/api/work-hub/channels/${target.id}/messages?limit=100`
      : "/api/work-hub/channels?limit=100";
    let before = "";
    const seen = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const rows = await apiFetch<RecordData[]>(
        endpoint + (before ? `&before=${encodeURIComponent(before)}` : ""),
      );
      const match = rows.find(
        (row) => row.id === (target.messageId ?? target.id),
      );
      if (match)
        return content(
          { ...target, id: target.messageId ?? target.id },
          match,
          target.messageId ? undefined : match.name,
        );
      const cursor =
        rows.at(-1)?.[target.messageId ? "createdAt" : "updatedAt"];
      if (rows.length < 100 || typeof cursor !== "string" || seen.has(cursor))
        break;
      seen.add(cursor);
      before = cursor;
    }
    throw new Error("notification.unavailable");
  }
  if (target.kind === "announcement") {
    const data = await apiFetch<{
      announcements: { announcement: RecordData }[];
    }>("/api/work-hub/home");
    return content(
      target,
      data.announcements.find((row) => row.announcement.id === target.id)
        ?.announcement,
    );
  }
  if (target.kind === "form" || target.kind === "checklist") {
    const row = await apiFetch<{ instance: RecordData; template: RecordData }>(
      `/api/work-hub/required-actions/${target.kind}/${target.id}`,
    );
    return content(
      target,
      row?.instance,
      row?.template.name,
      (target.kind === "form"
        ? row?.instance.definitionSnapshot
        : row?.instance.snapshot
      )?.map(
        (field: RecordData) =>
          `${field.label}${row?.instance.responses?.[field.id] == null ? "" : `: ${String(row.instance.responses[field.id])}`}`,
      ),
    );
  }
  if (target.kind === "credential") {
    const me = await apiFetch<{ employeeId: number | null }>("/api/field/me");
    if (!me.employeeId) throw new Error("notification.unavailable");
    const rows = await apiFetch<RecordData[]>(
      `/api/field-employees/${me.employeeId}/certifications`,
    );
    return content(
      target,
      rows.find((row) => String(row.id) === target.id),
    );
  }
  if (target.kind === "handoff") {
    let before = "";
    const seen = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const data = await apiFetch<{
        rows: RecordData[];
        nextBefore: string | null;
      }>(
        `/api/gate-change-over/${target.stationId}/notes?days=3650${before ? `&before=${encodeURIComponent(before)}` : ""}`,
      );
      const row = data.rows.find((row) => row.id === target.id);
      if (row)
        return content(target, row, undefined, [
          row.outgoing_name,
          row.incoming_name,
          row.snapshot?.coverage,
          ...(row.summary?.facts?.map((fact: RecordData) => fact.text) ?? []),
        ]);
      if (!data.nextBefore || seen.has(data.nextBefore)) break;
      seen.add(data.nextBefore);
      before = data.nextBefore;
    }
    throw new Error("notification.unavailable");
  }
  if (target.kind !== "gate") throw new Error("notification.unavailable");
  if (target.stationId) {
    const data = await apiFetch<{
      station: RecordData;
      site: RecordData;
      snapshot?: RecordData;
    }>(`/api/gate-change-over/${target.stationId}/state`);
    if (target.siteId && String(data.site.id) !== target.siteId)
      throw new Error("notification.unavailable");
    return content(target, data.station, undefined, [
      data.site.name,
      data.snapshot?.coverage,
    ]);
  }
  const data = await apiFetch<{ sites: RecordData[] }>(
    "/api/gate-change-over/sites",
  );
  return content(
    target,
    data.sites.find((site) => String(site.id) === target.id),
  );
}
