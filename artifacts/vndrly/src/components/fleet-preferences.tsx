import { useTranslation } from "react-i18next";
import { fleetCopy } from "@/lib/fleet-copy";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  FleetOverview,
  FleetWorkspacePreference,
} from "@workspace/api-zod";
import { fleetClient } from "@/lib/fleet-client";
import { PngPillButton } from "@/components/png-pill-rollover";
export function FleetPreferences({
  overview,
  identity,
}: {
  overview: FleetOverview;
  identity: string;
}) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  const preference = overview.preference;
  if (!preference) return <p>{c.preferenceUnavailable}</p>;
  return (
    <PreferenceForm
      key={preference.version}
      preference={preference}
      overview={overview}
      identity={identity}
    />
  );
}
function PreferenceForm({
  preference,
  overview,
  identity,
}: {
  preference: FleetWorkspacePreference;
  overview: FleetOverview;
  identity: string;
}) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  const queryClient = useQueryClient();
  const [workspace, setWorkspace] = useState(preference.defaultWorkspace);
  const [fleetId, setFleetId] = useState(preference.selectedFleetId ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      await fleetClient.savePreference({
        expectedVersion: preference.version,
        defaultWorkspace: workspace,
        selectedFleetId: fleetId || null,
      });
      setMessage(c.preferenceSaved);
      await queryClient.invalidateQueries({ queryKey: ["fleet", identity] });
    } catch {
      setMessage(c.preferenceFailed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-xl border p-4">
      <h2 className="text-xl font-semibold">{c.preferenceHeading}</h2>
      <p>{c.preferenceExplanation}</p>
      <label className="block">
        {c.defaultHome}
        <select
          className="ml-3 rounded border bg-background p-2"
          disabled={busy}
          value={workspace}
          onChange={(e) =>
            setWorkspace(
              e.target.value as FleetWorkspacePreference["defaultWorkspace"],
            )
          }
        >
          <option value="standard">{c.standardHome}</option>
          {overview.capabilities.canDispatch && (
            <option value="fleet_desk">{c.desk}</option>
          )}
          {overview.capabilities.canDrive && (
            <option value="fleet_my_day">{c.myDay}</option>
          )}
        </select>
      </label>
      <label className="block">
        {c.preferredFleet}
        <select
          className="ml-3 rounded border bg-background p-2"
          disabled={busy}
          value={fleetId}
          onChange={(e) => setFleetId(e.target.value)}
        >
          <option value="">{c.allFleets}</option>
          {overview.fleets.map((fleet) => (
            <option key={fleet.id} value={fleet.id}>
              {fleet.name}
            </option>
          ))}
        </select>
      </label>
      <PngPillButton disabled={busy} onClick={() => void save()}>
        {c.savePreference}
      </PngPillButton>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
