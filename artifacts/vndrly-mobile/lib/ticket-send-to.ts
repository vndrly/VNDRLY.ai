import { apiFetch } from "@/lib/api";

export type SendToGroupId =
  | "on_ticket"
  | "vendor_poc_field"
  | "vendor_poc_office"
  | "vendor_office"
  | "partner_poc_operations"
  | "partner_poc_ap"
  | "partner_office"
  | "field_crew"
  | "vndrly_office";

export type SendToRecipient = {
  userId: number;
  displayName: string;
  email: string | null;
  group: SendToGroupId;
  roleLabel: string;
  headline?: string;
  detail?: string;
};

export type SendToRecipientGroups = {
  id: SendToGroupId;
  recipients: SendToRecipient[];
}[];

export const SEND_TO_GROUP_LABEL_KEYS: Record<SendToGroupId, string> = {
  on_ticket: "notifications.sendToGroups.onTicket",
  vendor_poc_field: "notifications.sendToGroups.vendorPocField",
  vendor_poc_office: "notifications.sendToGroups.vendorPocOffice",
  vendor_office: "notifications.sendToGroups.vendorOffice",
  partner_poc_operations: "notifications.sendToGroups.partnerPocOperations",
  partner_poc_ap: "notifications.sendToGroups.partnerPocAp",
  partner_office: "notifications.sendToGroups.partnerOffice",
  field_crew: "notifications.sendToGroups.fieldCrew",
  vndrly_office: "notifications.sendToGroups.vndrlyOffice",
};

export function sendToRowKey(group: SendToGroupId, userId: number): string {
  return `${group}:${userId}`;
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
    const sep = rowKey.indexOf(":");
    if (sep <= 0) continue;
    const userId = Number(rowKey.slice(sep + 1));
    if (Number.isInteger(userId) && userId > 0) ids.add(userId);
  }
  return [...ids];
}

export async function fetchSendToRecipients(notificationId: number) {
  return apiFetch<{ ticketId: number; groups: SendToRecipientGroups }>(
    `/api/notifications/${notificationId}/send-to-recipients`,
  );
}

export async function sendNotificationToRecipients(
  notificationId: number,
  body: { recipientUserIds: number[]; message?: string | null },
) {
  return apiFetch<{ ok: true; notifiedCount: number; trackingNumber: string; ticketId: number }>(
    `/api/notifications/${notificationId}/send-to`,
    { method: "POST", body: JSON.stringify(body) },
  );
}
