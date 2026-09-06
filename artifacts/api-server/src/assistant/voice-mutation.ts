const REFRESH: Record<string, string[]> = {
  confirm_visitor_check_in: ["gate", "visits"],
  confirm_visitor_check_out: ["gate", "visits"],
  set_ticket_lifecycle: ["tickets", "crew-map"],
  close_ticket_for_review: ["tickets", "crew-map"],
  post_ticket_comment: ["tickets", "crew-map"],
  mark_notifications_read: ["notifications"],
};
export function voiceMutationHint(
  name: string,
  input: Record<string, unknown>,
  output: string,
  success: boolean,
  replayed: boolean,
) {
  if (!success || !REFRESH[name]) return undefined;
  let result: Record<string, unknown> = {};
  try {
    result = JSON.parse(output);
  } catch {
    /* IDs remain available from the validated input. */
  }
  const ids = Object.fromEntries(
    ["ticketId", "visitId", "siteLocationId"].flatMap((key) => {
      const value = result?.[key] ?? input[key];
      return typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value > 0
        ? [[key, value]]
        : [];
    }),
  );
  return { name, refresh: REFRESH[name], ...ids, replayed };
}
