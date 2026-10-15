import type { getCampaign } from "./form-campaign-service";
const cell = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
};
export function campaignCsv(data: Awaited<ReturnType<typeof getCampaign>>) {
  const rows: unknown[][] = [
    [
      "record_type",
      "label",
      "value",
      "email",
      "submitted_at",
      "late",
      "excluded",
      "policy_version",
    ],
  ];
  for (const [metric, value] of Object.entries(data.counts))
    rows.push(["progress", metric, value]);
  for (const choice of data.totals ?? [])
    rows.push(["result", choice.label, choice.votes]);
  if (!data.config.anonymous)
    for (const r of data.receipts ?? []) {
      rows.push([
        "receipt",
        r.name,
        r.submittedAt ? "Responded" : "Outstanding",
        r.email,
        r.submittedAt,
        r.late,
        r.excluded,
        data.config.kind === "acknowledgement" ? data.config.policyVersion : "",
      ]);
      if (data.config.kind === "form" && r.values)
        for (const [field, value] of Object.entries(r.values))
          rows.push([
            "answer",
            field,
            JSON.stringify(value),
            r.email,
            r.submittedAt,
            r.late,
            r.excluded,
          ]);
    }
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
