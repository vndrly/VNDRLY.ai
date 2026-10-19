import { useFleetResourceCopy } from "@/lib/fleet-resource-copy";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FleetDestinationInputSchema,
  FleetDestinationSaveSchema,
  type FleetDestination,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { fleetClient } from "@/lib/fleet-client";
import PageBackButton from "./page-back-button";
import { PngPillButton } from "./png-pill-rollover";
import { BrandedCheckbox } from "./branded-checkbox";
import "@/pages/fleet.css";
type Draft = {
  id?: string;
  name: string;
  kind: FleetDestination["kind"];
  address: string;
  latitude: string;
  longitude: string;
  instructions: string;
  hours: string;
  active: boolean;
  timeZone: string;
};
export function FleetDestinationsPage({ identity }: { identity: string }) {
  const copy = useFleetResourceCopy();
  const query = useQuery({
      queryKey: ["fleet-destinations", identity],
      queryFn: () => fleetClient.commercial(),
      retry: false,
    }),
    cache = useQueryClient();
  const [search, setSearch] = useState(""),
    [draft, setDraft] = useState<Draft | null>(null),
    [original, setOriginal] = useState<FleetDestination | null>(null),
    [attempt, setAttempt] = useState<z.infer<
      typeof FleetDestinationSaveSchema
    > | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const lock = useRef(false);
  function edit(location?: FleetDestination) {
    setOriginal(location ?? null);
    setMessage("");
    setAttempt(null);
    setDraft({
      id: location?.id,
      name: location?.name ?? "",
      kind: location?.kind ?? "pickup",
      address: location?.address ?? "",
      latitude: location?.latitude == null ? "" : String(location.latitude),
      longitude: location?.longitude == null ? "" : String(location.longitude),
      instructions: location?.instructions ?? "",
      hours: location?.hours ?? "",
      active: location?.active ?? true,
      timeZone: location?.timeZone ?? "America/Chicago",
    });
  }
  function review() {
    if (!draft || !query.data) return;
    try {
      const {
        revision: _r,
        ownerId: _o,
        ownerType: _t,
        ...previous
      } = original ?? {};
      const destination = FleetDestinationInputSchema.parse({
        ...previous,
        ...draft,
        latitude: draft.latitude.trim() ? Number(draft.latitude) : null,
        longitude: draft.longitude.trim() ? Number(draft.longitude) : null,
      });
      setAttempt(
        FleetDestinationSaveSchema.parse({
          operationId: crypto.randomUUID(),
          expectedVersion: query.data.version,
          destination,
        }),
      );
      setMessage("");
    } catch {
      setMessage(
        "Enter a name and address. GPS is optional; supply both coordinates if known.",
      );
    }
  }
  async function save() {
    if (!attempt || lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await fleetClient.saveDestination(attempt);
      setDraft(null);
      setAttempt(null);
      await cache.invalidateQueries({
        queryKey: ["fleet-destinations", identity],
      });
      setMessage("Location saved.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save. Retry the same reviewed request.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const rows =
    query.data?.destinations.filter((item) =>
      [item.name, item.address, item.instructions]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  return (
    <main className="fleet-workspace space-y-5 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <PageBackButton fallbackHref="/fleet" />
        <h1 className="text-2xl font-semibold">
          {copy("Origins and Destinations")}
        </h1>
      </header>
      <section className="space-y-3">
        <p>
          {copy(
            " Reusable pickups, terminals, disposal points and bases. Physical locations do not grant billing-site access. ",
          )}
        </p>
        <label>
          {copy(" Search locations ")}
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        {query.data?.canManage && (
          <PngPillButton onClick={() => edit()}>
            {copy("Add location")}
          </PngPillButton>
        )}
      </section>
      {query.isPending && <p>{copy("Loading locations\u2026")}</p>}
      {query.isError && (
        <p role="alert">{copy("Locations unavailable. Refresh to retry.")}</p>
      )}
      {draft && (
        <section className="space-y-4">
          <h2>{draft.id ? copy("Edit location") : copy("Add location")}</h2>
          <fieldset
            disabled={busy || Boolean(attempt)}
            className="fleet-asset-fields"
          >
            {(
              [
                ["Name", "name"],
                ["Address", "address"],
                ["Latitude (optional)", "latitude"],
                ["Longitude (optional)", "longitude"],
                ["Time zone", "timeZone"],
                ["Access hours", "hours"],
                ["Instructions", "instructions"],
              ] as const
            ).map(([label, key]) => (
              <label key={key}>
                {copy(label)}
                <input
                  aria-label={copy(label)}
                  value={draft[key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.value })
                  }
                />
              </label>
            ))}
            <label>
              {copy(" Location type ")}
              <select
                value={draft.kind}
                onChange={(e) =>
                  setDraft({ ...draft, kind: e.target.value as Draft["kind"] })
                }
              >
                <option value="pickup">{copy("Origin / pickup")}</option>
                <option value="delivery">
                  {copy("Destination / terminal")}
                </option>
                <option value="disposal">{copy("Disposal")}</option>
                <option value="yard">{copy("Base / yard")}</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <BrandedCheckbox
                checked={draft.active}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, active: checked === true })
                }
              />
              {copy(" Active location ")}
            </label>
          </fieldset>
          {attempt ? (
            <>
              <p>
                {copy(" Review ")}
                {attempt.destination.name} · {attempt.destination.address}.{" "}
                {attempt.destination.latitude === null
                  ? "GPS unverified; routing estimates unavailable."
                  : "Coordinates supplied."}
              </p>
              <PngPillButton disabled={busy} onClick={() => void save()}>
                {copy(" Save location ")}
              </PngPillButton>
              <PngPillButton disabled={busy} onClick={() => setAttempt(null)}>
                {copy(" Edit selection ")}
              </PngPillButton>
            </>
          ) : (
            <PngPillButton onClick={review}>
              {copy("Review location")}
            </PngPillButton>
          )}
          <PngPillButton
            disabled={busy}
            onClick={() => {
              setDraft(null);
              setAttempt(null);
            }}
          >
            {copy(" Cancel ")}
          </PngPillButton>
        </section>
      )}
      {message && (
        <p role={message === "Location saved." ? "status" : "alert"}>
          {copy(message)}
        </p>
      )}
      <div className="fleet-asset-grid">
        {rows.map((item) => (
          <article key={item.id} className="fleet-detail-group">
            <h2>{item.name}</h2>
            <p>{item.address}</p>
            <p>
              {item.kind} · {item.active ? copy("Active") : copy("Inactive")}
              {copy(" \u00B7 revision")} {item.revision}
            </p>
            <p>
              {item.latitude === null
                ? copy("GPS unverified")
                : `${item.latitude}, ${item.longitude}`}
            </p>
            {item.instructions && <p>{item.instructions}</p>}
            {query.data?.canManage && item.ownerType === "vendor" && (
              <PngPillButton onClick={() => edit(item)}>
                {copy(" Edit ")}
                {item.name}
              </PngPillButton>
            )}
          </article>
        ))}
      </div>
    </main>
  );
}
