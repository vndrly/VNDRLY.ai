/** Browser path the client sends so askV can tailor answers to "this page". */
export type AssistantPageContext = {
  path: string;
  entityId?: number | null;
};

/** Parse optional pageContext from the assistant chat POST body. */
export function parsePageContext(
  raw: unknown,
): AssistantPageContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const path = typeof (raw as { path?: unknown }).path === "string"
    ? (raw as { path: string }).path.trim()
    : "";
  if (!path || path.length > 512) return undefined;
  const entityIdRaw = (raw as { entityId?: unknown }).entityId;
  const entityId =
    typeof entityIdRaw === "number" && Number.isFinite(entityIdRaw)
      ? Math.floor(entityIdRaw)
      : undefined;
  return entityId != null ? { path, entityId } : { path };
}
