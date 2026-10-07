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
  const preference = overview.preference;
  if (!preference)
    return (
      <p>
        Workspace preference is unavailable. Refresh to load its current
        version.
      </p>
    );
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
      setMessage("Workspace preference saved.");
      await queryClient.invalidateQueries({ queryKey: ["fleet", identity] });
    } catch {
      setMessage(
        "Preference was not confirmed. Refresh and review its current version before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-xl border p-4">
      <h2 className="text-xl font-semibold">Your Fleet workspace</h2>
      <p>
        Choose your default home in this company. This setting does not grant
        access or change assignments.
      </p>
      <label className="block">
        Default home
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
          <option value="standard">Standard company home</option>
          {overview.capabilities.canDispatch && (
            <option value="fleet_desk">Fleet Desk</option>
          )}
          {overview.capabilities.canDrive && (
            <option value="fleet_my_day">Fleet My Day</option>
          )}
        </select>
      </label>
      <label className="block">
        Preferred fleet
        <select
          className="ml-3 rounded border bg-background p-2"
          disabled={busy}
          value={fleetId}
          onChange={(e) => setFleetId(e.target.value)}
        >
          <option value="">All authorized fleets</option>
          {overview.fleets.map((fleet) => (
            <option key={fleet.id} value={fleet.id}>
              {fleet.name}
            </option>
          ))}
        </select>
      </label>
      <PngPillButton disabled={busy} onClick={() => void save()}>
        Save reviewed preference
      </PngPillButton>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
