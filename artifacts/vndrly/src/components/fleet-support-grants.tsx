import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { FleetSetup, FleetSupportGrant } from "@workspace/api-zod";
import { fleetCopy } from "@/lib/fleet-copy";
import { PngPillButton } from "@/components/png-pill-rollover";
export function FleetSupportGrants({
  draft,
  onChange,
}: {
  draft: FleetSetup;
  onChange: (grants: FleetSupportGrant[]) => void;
}) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  const [userId, setUserId] = useState("");
  const [expires, setExpires] = useState("");
  const [reason, setReason] = useState("");
  const [fleetIds, setFleets] = useState<string[]>([]);
  const [siteIds, setSites] = useState<number[]>([]);
  const [financeRead, setFinance] = useState(false);
  const sites = draft.sites.filter((site) =>
    draft.fleets.some(
      (fleet) =>
        fleetIds.includes(fleet.id) && fleet.siteIds.includes(site.siteId),
    ),
  );
  const valid =
    Number.isSafeInteger(Number(userId)) &&
    Number(userId) > 0 &&
    reason.trim() &&
    fleetIds.length &&
    siteIds.length &&
    Number.isFinite(Date.parse(expires)) &&
    Date.parse(expires) > Date.now() &&
    Date.parse(expires) <= Date.now() + 7 * 86400000;
  return (
    <section className="space-y-3 rounded border p-3">
      <h3>{c.support}</h3>
      <p>{c.supportGrantScope}</p>
      {(draft.supportGrants ?? []).map((grant, index) => (
        <article key={`${grant.userId}:${index}`}>
          <p>
            {grant.userId} · {grant.reason} ·{" "}
            {new Date(grant.expiresAt).toLocaleString(i18n.language)}
          </p>
          <p>
            {grant.fleetIds
              .map(
                (id) =>
                  draft.fleets.find((fleet) => fleet.id === id)?.name ?? id,
              )
              .join(", ")}{" "}
            ·{" "}
            {grant.siteIds
              .map(
                (id) =>
                  draft.sites.find((site) => site.siteId === id)?.name ?? id,
              )
              .join(", ")}
          </p>
          <PngPillButton
            onClick={() =>
              onChange(
                (draft.supportGrants ?? []).filter((_, i) => i !== index),
              )
            }
          >
            {c.supportRemove}
          </PngPillButton>
        </article>
      ))}
      <label>
        {c.supportAdminId}
        <input
          className="block rounded border p-2"
          type="number"
          min="1"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
        />
      </label>
      <label>
        {c.supportReason}
        <textarea
          className="block rounded border p-2"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <label>
        {c.supportExpiry}
        <input
          className="block rounded border p-2"
          type="datetime-local"
          value={expires}
          onChange={(event) => setExpires(event.target.value)}
        />
      </label>
      <fieldset>
        <legend>{c.fleet}</legend>
        {draft.fleets.map((fleet) => (
          <label className="mr-4" key={fleet.id}>
            <input
              type="checkbox"
              checked={fleetIds.includes(fleet.id)}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...fleetIds, fleet.id]
                  : fleetIds.filter((id) => id !== fleet.id);
                setFleets(next);
                setSites(
                  siteIds.filter((id) =>
                    draft.fleets.some(
                      (item) =>
                        next.includes(item.id) && item.siteIds.includes(id),
                    ),
                  ),
                );
              }}
            />
            {fleet.name}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{c.site}</legend>
        {sites.map((site) => (
          <label className="mr-4" key={site.siteId}>
            <input
              type="checkbox"
              checked={siteIds.includes(site.siteId)}
              onChange={(event) =>
                setSites(
                  event.target.checked
                    ? [...siteIds, site.siteId]
                    : siteIds.filter((id) => id !== site.siteId),
                )
              }
            />
            {site.name}
          </label>
        ))}
      </fieldset>
      <label>
        <input
          type="checkbox"
          checked={financeRead}
          onChange={(event) => setFinance(event.target.checked)}
        />
        {c.supportFinance}
      </label>
      <PngPillButton
        disabled={!valid}
        onClick={() => {
          if (!valid) return;
          onChange([
            ...(draft.supportGrants ?? []),
            {
              userId: Number(userId),
              fleetIds,
              siteIds,
              expiresAt: new Date(expires).toISOString(),
              reason: reason.trim(),
              financeRead,
            },
          ]);
          setUserId("");
          setReason("");
          setFleets([]);
          setSites([]);
          setFinance(false);
        }}
      >
        {c.supportAdd}
      </PngPillButton>
    </section>
  );
}
