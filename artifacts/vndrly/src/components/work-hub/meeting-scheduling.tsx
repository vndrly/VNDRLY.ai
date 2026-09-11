import { useAuth } from "@/hooks/use-auth";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Clock, Users } from "lucide-react";
import BrandPillButton from "@/components/brand-pill-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createWorkHubOperationId,
  workHubRequest,
} from "@/lib/work-hub-client";
import { HubError } from "./collaboration";
import { WorkHubCardTitle } from "./chrome";
type MeetingType = {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
  timezone: string;
  visibility: "personal" | "shared";
  active: boolean;
  version: number;
  canManage: boolean;
};
type Window = { startsAt: string; endsAt: string };
const empty = () => ({
  title: "",
  description: "",
  durationMinutes: 30,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  visibility: "personal" as "personal" | "shared",
  active: true,
});
export function MeetingScheduling() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const pendingOperations = useRef(new Map<string, string>());
  const [view, setView] = useState("personal");
  const [selected, setSelected] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("booking"),
  );
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [windowForm, setWindowForm] = useState({ start: "", end: "" });
  const [draftWindows, setDraftWindows] = useState<Window[] | null>(null);
  const [slot, setSlot] = useState("");
  const [note, setNote] = useState("");
  const [booked, setBooked] = useState<string | null>(null);
  const types = useQuery<MeetingType[]>({
    queryKey: ["work-hub", "scheduling-types", user?.userId, user?.activeMembershipId],
    queryFn: () => workHubRequest("/scheduling/types"),
  });
  const current = types.data?.find((t) => t.id === selected);
  const availability = useQuery<{
    windows: Window[];
    slots: string[];
    version: number;
  }>({
    queryKey: ["work-hub", "availability", selected, user?.userId, user?.activeMembershipId],
    queryFn: () => workHubRequest(`/scheduling/types/${selected}/availability`),
    enabled: !!selected,
    refetchInterval: 30000,
  });
  const mutation = useMutation({
    mutationFn: async ({
      path,
      method = "POST",
      data,
    }: {
      path: string;
      method?: string;
      data: Record<string, unknown>;
    }) => {
      const key = `${method}:${path}:${JSON.stringify(data)}`;
      let operationId = pendingOperations.current.get(key);
      if (!operationId) {
        operationId = createWorkHubOperationId();
        pendingOperations.current.set(key, operationId);
      }
      const result = await workHubRequest<any>(path, {
        method,
        body: JSON.stringify({ ...data, operationId }),
      });
      pendingOperations.current.delete(key);
      return result;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-hub"] }),
  });
  function choose(type: MeetingType) {
    setSelected(type.id);
    setSlot("");
    setDraftWindows(null);
    setBooked(null);
  }
  const windows = draftWindows ?? availability.data?.windows ?? [];
  return (
    <section
      data-work-hub-card
      className="mb-6 overflow-hidden rounded-xl border-2 border-[color:var(--brand-primary)] bg-card"
      aria-label="Meeting scheduling pages"
    >
      <header className="flex flex-wrap items-center justify-between gap-4 border-b p-5">
        <div>
          <h2><WorkHubCardTitle icon={CalendarDays} className="text-xl">Meeting scheduling</WorkHubCardTitle></h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Set your availability and let signed-in teammates reserve a time.
          </p>
        </div>
        <BrandPillButton
          tone="blue"
          onClick={() => {
            setCreateOpen(!createOpen);
            setEditId(null);
            setForm(empty());
          }}
        >
          Create meeting type
        </BrandPillButton>
      </header>
      {createOpen && (
        <form
          className="grid gap-3 border-b bg-muted/20 p-5 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            mutation
              .mutateAsync({
                path: editId
                  ? `/scheduling/types/${editId}`
                  : "/scheduling/types",
                method: editId ? "PATCH" : "POST",
                data: {
                  ...form,
                  ...(editId
                    ? {
                        expectedVersion: types.data?.find(
                          (t) => t.id === editId,
                        )?.version,
                      }
                    : {}),
                },
              })
              .then((result) => {
                setSelected(result.id);
                setDraftWindows(null);
                setCreateOpen(false);
                setForm(empty());
              })
              .catch(() => undefined);
          }}
        >
          <label className="grid gap-1 text-sm">
            Meeting title
            <Input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Duration (minutes)
            <Input
              type="number"
              min={5}
              max={480}
              required
              value={form.durationMinutes}
              onChange={(e) =>
                setForm({ ...form, durationMinutes: Number(e.target.value) })
              }
            />
          </label>
          <label className="grid gap-1 text-sm">
            Description
            <Textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm">
              Scheduling page
              <select
                aria-label="Scheduling page"
                className="h-10 rounded border bg-background px-3"
                value={form.visibility}
                onChange={(e) =>
                  setForm({
                    ...form,
                    visibility: e.target.value as typeof form.visibility,
                  })
                }
              >
                <option value="personal">Personal — only you</option>
                <option value="shared">
                  Shared — signed-in company teammates
                </option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Time zone
              <Input
                required
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Accept reservations
            </label>
          </div>
          <BrandPillButton
            tone="blue"
            type="submit"
            disabled={mutation.isPending}
          >
            {editId ? "Save meeting type" : "Create meeting type"}
          </BrandPillButton>
          <BrandPillButton tone="image" onClick={() => setCreateOpen(false)}>
            Cancel
          </BrandPillButton>
        </form>
      )}
      <div className="grid lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-r p-4">
          <div className="mb-4 flex gap-4" role="tablist">
            {["personal", "shared"].map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                className={`pb-2 text-sm capitalize ${view === v ? "border-b-2 border-[var(--brand-primary)] font-semibold" : "text-muted-foreground"}`}
                onClick={() => setView(v)}
              >
                {v === "personal" ? "My pages" : "Shared pages"}
              </button>
            ))}
          </div>
          {types.isLoading && <p role="status">Loading schedules…</p>}
          {types.data
            ?.filter((t) =>
              view === "personal" ? t.canManage : t.visibility === "shared",
            )
            .map((t) => (
              <button
                key={t.id}
                className={`mb-2 w-full rounded-lg border p-4 text-left ${selected === t.id ? "border-[var(--brand-primary)] bg-muted" : ""}`}
                onClick={() => choose(t)}
              >
                <h3 className="font-semibold">{t.title}</h3>
                <p className="mt-2 flex gap-2 text-xs text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {t.durationMinutes} min · {t.active ? t.visibility : "Paused"}
                </p>
              </button>
            ))}
        </aside>
        <div className="min-w-0 p-5">
          {current ? (
            <>
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold">{current.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {current.description}
                  </p>
                  <p className="mt-2 text-xs">
                    {current.durationMinutes} minutes · {current.timezone} ·
                    Internal audio
                  </p>
                </div>
                {current.canManage && (
                  <BrandPillButton
                    tone="blue"
                    onClick={() => {
                      setForm(current);
                      setEditId(current.id);
                      setCreateOpen(true);
                    }}
                  >
                    Edit type
                  </BrandPillButton>
                )}
              </div>
              {current.canManage && (
                <details
                  className="mt-5 rounded-lg border p-4"
                  open={!availability.data?.windows.length || undefined}
                >
                  <summary className="cursor-pointer font-semibold">
                    Manage availability
                  </summary>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Dates below use your device time zone:{" "}
                    {Intl.DateTimeFormat().resolvedOptions().timeZone}. Existing
                    reservations stay on the calendar when availability changes.
                  </p>
                  <div className="my-3 grid gap-2">
                    {windows.map((w, index) => (
                      <div
                        key={`${w.startsAt}-${index}`}
                        className="flex flex-wrap items-center justify-between gap-3 text-sm"
                      >
                        <span>
                          {new Date(w.startsAt).toLocaleString()} —{" "}
                          {new Date(w.endsAt).toLocaleString()}
                        </span>
                        <BrandPillButton
                          tone="red"
                          onClick={() =>
                            setDraftWindows(
                              windows.filter((_, i) => i !== index),
                            )
                          }
                        >
                          Remove window
                        </BrandPillButton>
                      </div>
                    ))}
                  </div>
                  <form
                    className="grid gap-3 md:grid-cols-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setDraftWindows([
                        ...windows,
                        {
                          startsAt: new Date(windowForm.start).toISOString(),
                          endsAt: new Date(windowForm.end).toISOString(),
                        },
                      ]);
                      setWindowForm({ start: "", end: "" });
                    }}
                  >
                    <label className="grid gap-1 text-sm">
                      Available from
                      <Input
                        type="datetime-local"
                        required
                        value={windowForm.start}
                        onChange={(e) =>
                          setWindowForm({
                            ...windowForm,
                            start: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      Available until
                      <Input
                        type="datetime-local"
                        required
                        min={windowForm.start}
                        value={windowForm.end}
                        onChange={(e) =>
                          setWindowForm({ ...windowForm, end: e.target.value })
                        }
                      />
                    </label>
                    <BrandPillButton tone="blue" type="submit">
                      Add window
                    </BrandPillButton>
                  </form>
                  <div className="mt-4">
                    <BrandPillButton
                      tone="blue"
                      disabled={draftWindows === null || mutation.isPending}
                      onClick={() =>
                        mutation
                          .mutateAsync({
                            path: `/scheduling/types/${current.id}/availability`,
                            method: "PUT",
                            data: {
                              windows,
                              expectedVersion:
                                availability.data?.version ?? current.version,
                            },
                          })
                          .then(() => setDraftWindows(null))
                          .catch(() => undefined)
                      }
                    >
                      Save availability
                    </BrandPillButton>
                  </div>
                </details>
              )}
              <section className="mt-6">
                <h4 className="flex items-center gap-2 font-semibold">
                  <CalendarDays className="h-5 w-5" />
                  Choose a time
                </h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  Shown in your device time zone. Your existing meetings and the
                  host’s meetings are excluded.
                </p>
                <div className="my-4 grid max-h-64 gap-2 overflow-auto sm:grid-cols-2 xl:grid-cols-3">
                  {availability.data?.slots.map((time) => (
                    <button
                      key={time}
                      className={`rounded border p-3 text-sm ${slot === time ? "border-[var(--brand-primary)] bg-muted font-semibold" : ""}`}
                      onClick={() => setSlot(time)}
                    >
                      {new Date(time).toLocaleString()}
                    </button>
                  ))}
                </div>
                {!availability.isLoading &&
                  !availability.data?.slots.length && (
                    <p className="py-3 text-sm text-muted-foreground">
                      No available times. The host can add availability or
                      reopen this page.
                    </p>
                  )}
                {slot && (
                  <form
                    className="grid gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      mutation
                        .mutateAsync({
                          path: `/scheduling/types/${current.id}/book`,
                          data: { startsAt: slot, note },
                        })
                        .then((result) => {
                          setBooked(result.occurrence.id);
                          setSlot("");
                          setNote("");
                        })
                        .catch(() => undefined);
                    }}
                  >
                    <label className="grid gap-1 text-sm">
                      Notes for the host
                      <Textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </label>
                    <BrandPillButton
                      tone="green"
                      type="submit"
                      disabled={mutation.isPending}
                    >
                      Reserve {new Date(slot).toLocaleString()}
                    </BrandPillButton>
                  </form>
                )}
                {booked && (
                  <p role="status" className="mt-4 text-sm">
                    Meeting reserved.{" "}
                    <a
                      className="font-semibold underline"
                      href={`/work-hub/meetings?meeting=${booked}`}
                    >
                      Open your meeting
                    </a>
                  </p>
                )}
              </section>
            </>
          ) : (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <Users className="h-10 w-10 text-[var(--brand-primary)] card-icon-drop-shadow" />
              <p>Select a meeting type or create your scheduling page.</p>
            </div>
          )}
        </div>
      </div>
      <HubError error={types.error ?? availability.error ?? mutation.error} />
    </section>
  );
}
