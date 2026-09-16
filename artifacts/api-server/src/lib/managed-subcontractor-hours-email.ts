import { logger } from "./logger";

export async function sendManagedSubcontractorHoursEmail(input: { recipients: string[]; contractorName: string; subcontractorName: string; start: string; end: string; pdf: Buffer }) {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  const fromEmail = process.env.SENDGRID_FROM_EMAIL?.trim();
  if (!apiKey || !fromEmail) throw new Error("SendGrid is not configured");
  const subject = `${input.subcontractorName} Approved Hours Report`;
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: input.recipients.map((email) => ({ email })) }],
      from: { email: fromEmail, name: process.env.SENDGRID_FROM_NAME?.trim() || "VNDRLY" },
      subject,
      content: [
        { type: "text/plain", value: `${subject} from ${input.contractorName} for ${input.start} through ${input.end} is attached.` },
        { type: "text/html", value: `<p><strong>${subject}</strong></p><p>From ${input.contractorName} for ${input.start} through ${input.end}.</p>` },
      ],
      attachments: [{ content: input.pdf.toString("base64"), type: "application/pdf", filename: "approved-hours-report.pdf", disposition: "attachment" }],
      ...(process.env.SENDGRID_SANDBOX_MODE?.toLowerCase() === "true" ? { mail_settings: { sandbox_mode: { enable: true } } } : {}),
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.error({ status: response.status, body }, "Managed subcontractor hours email failed");
    throw new Error(`SendGrid mail send failed with status ${response.status}`);
  }
  return { messageId: response.headers.get("x-message-id") ?? undefined };
}
