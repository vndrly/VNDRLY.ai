/** Realtime retrieves completed audio items before updating its history.
 * Deleting in the completion callback races that required SDK retrieval. */
export function createTranscriptCleanup(send: (event: { type: "conversation.item.delete"; item_id: string }) => void) {
  const pending = new Set<string>();
  return {
    queue(itemId: string) { pending.add(itemId); },
    observe(event: { type: string; item?: { id?: string } }) {
      const itemId = event.type === "conversation.item.retrieved" ? event.item?.id : undefined;
      if (itemId && pending.delete(itemId)) send({ type: "conversation.item.delete", item_id: itemId });
    },
  };
}
