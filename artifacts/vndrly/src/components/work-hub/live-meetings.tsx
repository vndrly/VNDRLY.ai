import { Root as AdmissionSelect } from "@radix-ui/react-select";
import { SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CardHeading } from "@/components/ui/card-heading";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  workHubCommandResultSchema,
  LiveMeetingCommandResourceSchema,
  LiveMeetingLobbySchema,
  LiveMeetingSummarySchema,
  type LiveMeetingSummary,
} from "@workspace/api-zod";
import { z } from "zod/v4";
import { useAuth } from "@/hooks/use-auth";
import {
  commandEnvelope,
  workHubRequest,
  type WorkHubOwner,
} from "@/lib/work-hub-client";
import { WorkHubMiniCardButton } from "./chrome";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
const panel =
  "rounded-xl border-2 border-[color:var(--brand-primary)] bg-card p-4 space-y-3";
function useLiveRequest(identity: string, refresh: () => Promise<unknown>) {
  const attempt = useRef<{
    path: string;
    method: string;
    body: string;
    identity: string;
  } | null>(null);
  useEffect(() => {
    attempt.current = null;
  }, [identity]);
  const mutation = useMutation({
    mutationFn: async (q: {
      path: string;
      owner: WorkHubOwner;
      payload: unknown;
      version?: number;
      method?: string;
    }) => {
      if (!attempt.current)
        attempt.current = {
          path: q.path,
          method: q.method ?? "POST",
          body: JSON.stringify(
            commandEnvelope(q.owner, q.payload, undefined, q.version),
          ),
          identity,
        };
      if (attempt.current.identity !== identity) throw Error("Account changed");
      if (
        attempt.current.path !== q.path ||
        attempt.current.method !== (q.method ?? "POST") ||
        JSON.stringify(JSON.parse(attempt.current.body).payload) !==
          JSON.stringify(q.payload)
      )
        throw Error(
          "Retry the original action first; its result is still uncertain.",
        );
      const a = attempt.current;
      try {
        const result = await workHubRequest<any>(a.path, {
          method: a.method,
          body: a.body,
        });
        const receipt = workHubCommandResultSchema(
          LiveMeetingCommandResourceSchema,
        ).parse(result);
        if (receipt.operationId !== JSON.parse(a.body).operationId)
          throw Error("Meeting response did not match the original action");
        attempt.current = null;
        await refresh();
        return result;
      } catch (e) {
        const status = (
          e as {
            status?: number;
          }
        ).status;
        if (status && status < 500) attempt.current = null;
        throw e;
      }
    },
  });
  return {
    ...mutation,
    retryOriginal: () => {
      const a = attempt.current;
      if (!a) return;
      const e = JSON.parse(a.body);
      mutation.mutate({
        path: a.path,
        method: a.method,
        owner: e.owner,
        payload: e.payload,
        version: e.expectedVersion,
      });
    },
    hasUncertainRequest: !!attempt.current,
  };
}
export function LiveMeetingsPanel({
  owner,
  canManage,
  onOpen,
  headerActions,
}: {
  owner: WorkHubOwner | null;
  canManage: boolean;
  headerActions?: ReactNode;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth(),
    identity = `${user?.userId}:${user?.activeMembershipId}:${owner?.type}:${owner?.id}`;
  const live = useQuery({
    queryKey: ["live-meetings", identity],
    queryFn: async () =>
      z
        .object({ meetings: z.array(LiveMeetingSummarySchema) })
        .parse(await workHubRequest("/live-meetings")),
    enabled: owner?.type === "vendor",
    refetchInterval: () =>
      document.visibilityState === "visible" ? 5000 : false,
    retry: false,
  });
  const command = useLiveRequest(identity, () => live.refetch());
  const [start, setStart] = useState(false),
    [title, setTitle] = useState(""),
    [agenda, setAgenda] = useState(""),
    [mode, setMode] = useState<"company_open" | "host_approval">(
      "host_approval",
    ),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<number[]>([]);
  const people = useQuery({
    queryKey: ["live-meeting-people", identity],
    queryFn: () =>
      workHubRequest<
        {
          id: number;
          displayName: string;
          sameCompany: boolean;
        }[]
      >("/people"),
    enabled: start && !!owner,
  });
  if (owner?.type !== "vendor") return null;
  return (
    <Popover open={start} onOpenChange={setStart}><section className="space-y-3 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-bold text-lg">
          {t("liveMeetings.liveNow", { defaultValue: "Live now" })}
        </h2>
        <div className="ml-auto flex items-center gap-2">
        {headerActions}
        {canManage && (
          <PopoverTrigger asChild><WorkHubMiniCardButton>
            {t("liveMeetings.startNow", { defaultValue: "Start meeting now" })}
          </WorkHubMiniCardButton></PopoverTrigger>
        )}
        </div>
      </div>
      {!live.isError &&
        live.data?.meetings.filter(m=>["live","active"].includes(m.status)).map((m) => (
          <div className={`${panel} hub-meeting-list-row`} key={m.occurrenceId}>
            <p className="text-[color:var(--brand-primary)] font-bold">
              LIVE · {m.connectedCount} connected
            </p>
            <CardHeading as="h3" className="font-bold text-lg">{m.title}</CardHeading>
            <p>
              {m.hostName} ·{" "}
              {m.admissionMode === "company_open"
                ? t("liveMeetings.members", { defaultValue: "Company members" })
                : t("liveMeetings.approval", { defaultValue: "Host approval" })}
            </p>
            <WorkHubMiniCardButton
              onClick={() => onOpen(m.occurrenceId)}
            >
              {m.canManage
                ? t("liveMeetings.openMeeting", {
                    defaultValue: "Open meeting",
                  })
                : m.canEnter
                  ? t("liveMeetings.joinShort", { defaultValue: "Join" })
                  : m.requestedAt
                    ? t("liveMeetings.waitingHost", {
                        defaultValue: "Waiting for host",
                      })
                    : t("liveMeetings.ask", { defaultValue: "Ask to join" })}
            </WorkHubMiniCardButton>
          </div>
        ))}
      {!live.isError && live.data && !live.data.meetings.length && (
        <p className="text-muted-foreground">
          {t("liveMeetings.noLive", {
            defaultValue: "No meetings in progress.",
          })}
        </p>
      )}
      {live.isError && (
        <p role="alert">
          {t("liveMeetings.unavailable", {
            defaultValue: "Live meetings are unavailable right now.",
          })}
        </p>
      )}
      <PopoverContent align="end" collisionPadding={12} className="hub-meeting-flyout w-[min(36rem,calc(100vw-1.5rem))] max-h-[min(80dvh,var(--radix-popover-content-available-height))] overflow-y-auto p-3">
            <div
              className="grid gap-3"
            >
              <CardHeading as="h3" className="font-bold text-xl">
                {t("liveMeetings.startNow", {
                  defaultValue: "Start meeting now",
                })}
              </CardHeading>
              <Input
                aria-label={t("liveMeetings.title", {
                  defaultValue: "Meeting title",
                })}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("liveMeetings.titleHint", {
                  defaultValue: "What are we meeting about?",
                })}
              />
              <fieldset className="rounded-xl border border-[color:var(--brand-primary)] p-3">
                <legend className="px-1 text-sm font-semibold">Agenda</legend>
                <Textarea aria-label="Agenda" value={agenda} onChange={(e) => setAgenda(e.target.value)}
                  placeholder="Type or paste the meeting agenda" rows={5} maxLength={50000} />
              </fieldset>
              <div className="space-y-1">
                <label htmlFor="meeting-admission">Admission</label>
                <AdmissionSelect value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
                  <SelectTrigger id="meeting-admission" aria-label="Meeting admission" className="h-9 rounded-full border-2 border-[color:var(--brand-primary)] bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="host_approval">{t("liveMeetings.approval", { defaultValue: "Host approval" })}</SelectItem>
                    <SelectItem value="company_open">{t("liveMeetings.members", { defaultValue: "Company members" })}</SelectItem>
                  </SelectContent>
                </AdmissionSelect>
              </div>
              <Input
                aria-label={t("liveMeetings.findInvitees", {
                  defaultValue: "Find people to invite",
                })}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("liveMeetings.inviteHint", {
                  defaultValue: "Invite people (optional)",
                })}
              />
              <div aria-label="Choose meeting participants" className="grid h-48 content-start gap-2 overflow-y-auto rounded-xl border-2 border-[var(--brand-primary)] p-3">
                {people.data
                  ?.filter(
                    (p) =>
                      p.sameCompany &&
                      p.displayName
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  )
                  .map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={selected.includes(p.id)} onChange={() => setSelected(ids => ids.includes(p.id) ? ids.filter(id => id !== p.id) : [...ids, p.id])} />
                      <span>{p.displayName}</span>
                    </label>
                  ))}
              </div>
              {command.isError && (
                <p role="alert">
                  {command.error.message}
                  {command.hasUncertainRequest && (
                    <WorkHubMiniCardButton
                      disabled={command.isPending}
                      onClick={command.retryOriginal}
                    >
                      Retry original request
                    </WorkHubMiniCardButton>
                  )}
                </p>
              )}
              <div className="flex items-center gap-2">
              <WorkHubMiniCardButton
                disabled={command.isPending || !title.trim()}
                onClick={() =>
                  command.mutate(
                    {
                      path: "/live-meetings",
                      owner,
                      payload: {
                        title: title.trim(),
                        agenda,
                        admissionMode: mode,
                        participantUserIds: selected,
                      },
                    },
                    {
                      onSuccess: (r) => {
                        setStart(false);
                        onOpen(r.resource.meeting.occurrenceId);
                      },
                    },
                  )
                }
              >
                {command.isPending
                  ? t("liveMeetings.starting", {
                      defaultValue: "Starting\u2026",
                    })
                  : t("liveMeetings.start", { defaultValue: "Start meeting" })}
              </WorkHubMiniCardButton>
              <WorkHubMiniCardButton
                disabled={command.isPending}
                onClick={() => setStart(false)}
              >
                {t("liveMeetings.close", { defaultValue: "Close" })}
              </WorkHubMiniCardButton>
              </div>
            </div>
      </PopoverContent>
    </section></Popover>
  );
}
export function LiveMeetingLobby({
  occurrenceId,
  owner,
  children,
}: {
  occurrenceId: string;
  owner: WorkHubOwner | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { user } = useAuth(),
    identity = `${user?.userId}:${owner?.id}:${occurrenceId}`;
  const live = useQuery({
    queryKey: ["live-lobby", identity],
    queryFn: async () =>
      LiveMeetingLobbySchema.parse(
        await workHubRequest(`/live-meetings/${occurrenceId}`),
      ),
    enabled: owner?.type === "vendor",
    refetchInterval: () =>
      document.visibilityState === "visible" ? 5000 : false,
    retry: false,
  });
  const command = useLiveRequest(identity, () => live.refetch());
  const [panelOpen, setPanelOpen] = useState(false),
    [invite, setInvite] = useState(false),
    [selected, setSelected] = useState<number[]>([]),
    [notice, setNotice] = useState("");
  const seen = useRef(new Set<string>());
  useEffect(() => {
    seen.current.clear();
    setPanelOpen(false);
    setInvite(false);
  }, [identity]);
  useEffect(() => {
    for (const r of live.data?.requests ?? []) {
      const key = `${r.userId}:${r.requestedAt}`;
      if (!seen.current.has(key)) {
        seen.current.add(key);
        setPanelOpen(true);
      }
    }
  }, [live.data?.requests]);
  if (
    live.isError &&
    (live.data || (live.error as { status?: number })?.status !== 404)
  )
    return (
      <p role="alert">Meeting access unavailable. Refresh to check access.</p>
    );
  if (
    owner?.type !== "vendor" ||
    (
      live.error as {
        status?: number;
      }
    )?.status === 404 ||
    live.data?.meeting.admissionMode === null ||
    live.data?.meeting.status === "ended"
  )
    return <>{children}</>;
  if (!live.data)
    return (
      <p role="status">
        {live.isError
          ? "Meeting unavailable in this company."
          : t("liveMeetings.loading", {
              defaultValue: "Loading meeting\u2026",
            })}
      </p>
    );
  const { meeting: m, requests, members } = live.data;
  const act = (suffix: string, payload: unknown, method = "POST") =>
    command.mutate({
      path: `/live-meetings/${occurrenceId}/${suffix}`,
      owner: owner!,
      payload,
      version: m.version,
      method,
    });
  return (
    <div className="space-y-3">
      <section className={panel}>
        <p className="font-bold text-[color:var(--brand-primary)]">
          {["live", "active"].includes(m.status)
            ? t("liveMeetings.live", { defaultValue: "LIVE" })
            : "MEETING"}{" "}
          · {m.connectedCount} connected
        </p>
        <CardHeading as="h2" className="font-bold text-xl">{m.title}</CardHeading>
        <p>
          {t("liveMeetings.hostedBy", { defaultValue: "Hosted by " })}
          {m.hostName}
        </p>
        {m.agenda && <p>{m.agenda}</p>}
        {m.ownAdmissionState !== "admitted" && (
          <WorkHubMiniCardButton
            disabled={
              command.isPending ||
              (!m.canEnter && !m.canRequest) ||
              (!!m.requestedAt && !m.canEnter)
            }
            onClick={() => act("request-admission", {})}
          >
            {m.canEnter
              ? t("liveMeetings.join", { defaultValue: "Join meeting" })
              : m.ownAdmissionState === "declined"
                ? t("liveMeetings.declined", {
                    defaultValue: "Request declined",
                  })
                : m.requestedAt
                  ? t("liveMeetings.waitingHost", {
                      defaultValue: "Waiting for host",
                    })
                  : t("liveMeetings.ask", { defaultValue: "Ask to join" })}
          </WorkHubMiniCardButton>
        )}
        {m.canManage && ["live", "active"].includes(m.status) && (
          <div className="flex flex-wrap gap-2">
            <WorkHubMiniCardButton onClick={() => setPanelOpen(true)}>
              {t("liveMeetings.waiting", {
                defaultValue: "Waiting room \u00B7 ",
              })}
              {requests.length}
            </WorkHubMiniCardButton>
            <WorkHubMiniCardButton onClick={() => setInvite(!invite)}>
              {t("liveMeetings.invite", { defaultValue: "Invite people" })}
            </WorkHubMiniCardButton>
            <WorkHubMiniCardButton
              disabled={command.isPending}
              onClick={() =>
                act(
                  "admission-mode",
                  {
                    admissionMode:
                      m.admissionMode === "company_open"
                        ? "host_approval"
                        : "company_open",
                  },
                  "PATCH",
                )
              }
            >
              {m.admissionMode === "company_open"
                ? t("liveMeetings.switchApproval", {
                    defaultValue: "Use host approval",
                  })
                : t("liveMeetings.switchOpen", {
                    defaultValue: "Open to company",
                  })}
            </WorkHubMiniCardButton>
          </div>
        )}
        <WorkHubMiniCardButton
          onClick={() =>
            void navigator.clipboard
              .writeText(
                `${window.location.origin}/work-hub/meeting/${occurrenceId}`,
              )
              .then(() =>
                setNotice(
                  t("liveMeetings.copied", {
                    defaultValue: "Meeting link copied",
                  }),
                ),
              )
              .catch(() => setNotice("Could not copy meeting link"))
          }
        >
          {t("liveMeetings.copy", { defaultValue: "Copy meeting link" })}
        </WorkHubMiniCardButton>
        {notice && <p>{notice}</p>}
        {command.isError && (
          <div role="alert">
            {command.error.message}
            {command.hasUncertainRequest && (
              <WorkHubMiniCardButton
                disabled={command.isPending}
                onClick={command.retryOriginal}
              >
                Retry original request
              </WorkHubMiniCardButton>
            )}
          </div>
        )}
        {invite && m.canManage && (
          <div className="flex flex-wrap gap-2">
            {members.map((p) => (
              <WorkHubMiniCardButton
                key={p.userId}
                aria-pressed={selected.includes(p.userId)}
                onClick={() =>
                  setSelected((ids) =>
                    ids.includes(p.userId)
                      ? ids.filter((id) => id !== p.userId)
                      : [...ids, p.userId],
                  )
                }
              >
                {selected.includes(p.userId) ? "✓ " : ""}
                {p.name}
              </WorkHubMiniCardButton>
            ))}
            <WorkHubMiniCardButton
              disabled={!selected.length || command.isPending}
              onClick={() =>
                act("invitations", { participantUserIds: selected })
              }
            >
              {t("liveMeetings.sendInvites", {
                defaultValue: "Send live invitations",
              })}
            </WorkHubMiniCardButton>
          </div>
        )}
      </section>
      {panelOpen && m.canManage && (
        <div role="region" aria-label="Waiting room" className={panel}>
          <WorkHubMiniCardButton onClick={() => setPanelOpen(false)}>
            {t("liveMeetings.closeWaiting", {
              defaultValue: "Close waiting room",
            })}
          </WorkHubMiniCardButton>
          {!requests.length && (
            <p>
              {t("liveMeetings.noRequests", {
                defaultValue: "No pending requests.",
              })}
            </p>
          )}
          {requests.map((r) => (
            <div className="flex flex-wrap items-center gap-3" key={r.userId}>
              <strong>{r.name}</strong>
              <span>{new Date(r.requestedAt).toLocaleTimeString()}</span>
              <WorkHubMiniCardButton
                disabled={command.isPending}
                onClick={() =>
                  act(`admission/${r.userId}`, { decision: "admit" })
                }
              >
                {t("liveMeetings.admit", { defaultValue: "Admit" })}
              </WorkHubMiniCardButton>
              <WorkHubMiniCardButton
                disabled={command.isPending}
                onClick={() =>
                  act(`admission/${r.userId}`, { decision: "decline" })
                }
              >
                {t("liveMeetings.decline", { defaultValue: "Decline" })}
              </WorkHubMiniCardButton>
            </div>
          ))}
        </div>
      )}
      {m.ownAdmissionState === "admitted" && children}
    </div>
  );
}

