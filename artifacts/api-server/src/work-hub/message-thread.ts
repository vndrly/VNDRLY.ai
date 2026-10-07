import { WorkHubAccessError } from "./context-access";

type Reference = { id: string; channelId: string; parentMessageId: string | null; rootMessageId: string | null };
const MAX_THREAD_ANCESTORS = 64;

/** Parent ancestry is authoritative; historical root hints never override a saved parent. */
export async function resolveMessageThread(
  channelId: string,
  payload: { parentMessageId?: string | null; rootMessageId?: string | null },
  read: (id: string) => Promise<Reference | undefined>,
): Promise<{ parentMessageId: string | null; rootMessageId: string | null }> {
  const parentId = payload.parentMessageId ?? null;
  const suppliedRoot = payload.rootMessageId ?? null;
  if (!parentId && !suppliedRoot) return { parentMessageId: null, rootMessageId: null };
  let nextId = parentId ?? suppliedRoot!;
  const visited = new Set<string>();
  for (let depth = 0; depth < MAX_THREAD_ANCESTORS; depth++) {
    if (visited.has(nextId)) throw new WorkHubAccessError("forbidden");
    visited.add(nextId);
    const saved = await read(nextId);
    if (!saved || saved.id !== nextId || saved.channelId !== channelId) throw new WorkHubAccessError("not_found");
    // Legacy root-only replies remain supported, but an actual parent always wins.
    const ancestor = saved.parentMessageId ?? saved.rootMessageId;
    if (!ancestor) {
      if (suppliedRoot && suppliedRoot !== saved.id) throw new WorkHubAccessError("forbidden");
      return { parentMessageId: parentId, rootMessageId: saved.id };
    }
    nextId = ancestor;
  }
  throw new WorkHubAccessError("forbidden");
}