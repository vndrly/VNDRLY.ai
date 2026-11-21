/** Keep the organizer's multiline agenda with each invitation. */
export function meetingInvitationBody(message: string, agenda?: string | null) {
  return agenda?.trim() ? `${message}\n\nAgenda\n${agenda}` : message;
}
