import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { WorkspacePanel } from "./workspace-panel";
import { PngPillButton } from "@/components/png-pill-rollover";
import {
  commandEnvelope,
  workHubRequest,
  type WorkHubOwner,
} from "@/lib/work-hub-client";

type MyShift = {
  id: string;
  version: number;
  title: string;
  siteName: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  requested: boolean;
};
export function RequestShiftCoverage({
  owner,
  day,
  userId,
}: {
  owner: WorkHubOwner;
  day: string;
  userId?: number;
}) {
  const [selected, setSelected] = useState<MyShift | null>(null),
    [message, setMessage] = useState(""),
    [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState<ReturnType<
    typeof commandEnvelope
  > | null>(null);
  const query = useQuery({
    queryKey: ["my-shift-coverage", userId, owner.type, owner.id, day],
    retry: false,
    queryFn: () =>
      workHubRequest<{ shifts: MyShift[]; readOnly: boolean }>(
        `/site-shift-plans/my-coverage?from=${day}&through=${day}`,
      ),
  });
  const time = (s: MyShift, value: string) =>
    new Date(value).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: s.timezone,
    });
  async function submit() {
    if (!selected || saving || query.data?.readOnly) return;
    setSaving(true);
    const envelope =
      attempt ??
      commandEnvelope(owner, {
        shiftId: selected.id,
        expectedVersion: selected.version,
      });
    setAttempt(envelope);
    try {
      await workHubRequest("/site-shift-plans/request-coverage", {
        method: "POST",
        body: JSON.stringify(envelope),
      });
      setSelected(null);
      setAttempt(null);
      setMessage(
        "Coverage requested. Your assignment remains in place until a replacement is confirmed.",
      );
      await query.refetch();
    } catch {
      setMessage(
        "Request not confirmed. Retry the same request to avoid duplicates.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <WorkspacePanel
      title="My shift coverage"
      subtitle={`Request a replacement for ${day}`}
      icon={CalendarDays}
    >
      <div className="hub-shift-panel">
        {query.isPending ? (
          <p>Loading your shifts…</p>
        ) : query.isError ? (
          <p role="alert">
            Your shifts could not load.{" "}
            <button onClick={() => void query.refetch()}>Retry</button>
          </p>
        ) : !query.data.shifts.length ? (
          <p>
            No upcoming assigned shifts on this day. Select another day on your
            calendar.
          </p>
        ) : (
          query.data.shifts.map((s) => (
            <div key={s.id}>
              <h4>
                {s.siteName} · {s.title}
              </h4>
              <p>
                {time(s, s.startsAt)}–{time(s, s.endsAt)} · {s.timezone}
              </p>
              {s.requested ? (
                <p>Coverage requested — awaiting replacement</p>
              ) : (
                <PngPillButton
                  color="brand"
                  disabled={saving || Boolean(attempt)}
                  onClick={() => {
                    setSelected(s);
                    setMessage("");
                  }}
                >
                  Request coverage
                </PngPillButton>
              )}
            </div>
          ))
        )}
        {selected && (
          <section aria-label="Review coverage request">
            <h4>Request coverage for {selected.title}?</h4>
            <p>
              This requests cover for this one dated shift. You remain
              responsible until a replacement is confirmed.
            </p>
            <PngPillButton
              color="brand"
              disabled={saving || Boolean(attempt)}
              onClick={() => setSelected(null)}
            >
              Cancel
            </PngPillButton>
            <PngPillButton
              color="brand"
              disabled={saving || query.data?.readOnly}
              onClick={() => void submit()}
            >
              {attempt ? "Retry request" : "Submit coverage request"}
            </PngPillButton>
          </section>
        )}
        {query.data?.readOnly && (
          <p>Local read-only preview: requests are not submitted.</p>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </WorkspacePanel>
  );
}
