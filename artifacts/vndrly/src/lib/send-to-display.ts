import type { SendToGroupId, SendToRecipient } from "@/lib/ticket-send-to-api";

export function sendToRowKey(group: SendToGroupId, userId: number): string {
  return `${group}:${userId}`;
}

export function parseSendToRowKey(rowKey: string): { group: SendToGroupId; userId: number } | null {
  const sep = rowKey.indexOf(":");
  if (sep <= 0) return null;
  const group = rowKey.slice(0, sep) as SendToGroupId;
  const userId = Number(rowKey.slice(sep + 1));
  if (!Number.isInteger(userId) || userId < 1) return null;
  return { group, userId };
}

export function recipientHeadline(recipient: SendToRecipient): string {
  return recipient.headline?.trim() || recipient.roleLabel?.trim() || recipient.displayName;
}

export function recipientDetail(recipient: SendToRecipient): string {
  return recipient.detail?.trim() || recipient.roleLabel?.trim() || "";
}

export function selectedRecipientUserIds(selectedRowKeys: Iterable<string>): number[] {
  const ids = new Set<number>();
  for (const rowKey of selectedRowKeys) {
    const parsed = parseSendToRowKey(rowKey);
    if (parsed) ids.add(parsed.userId);
  }
  return [...ids];
}
