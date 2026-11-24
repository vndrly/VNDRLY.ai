import { useRef, useState } from "react";
import { Vote } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import MiniCardDialogContent from "@/components/mini-card-dialog-content";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod/v4";
import {
  FormCampaignConfigSchema,
  FormCampaignStateSchema,
  FormCampaignSummarySchema,
  type FormCampaignConfig,
} from "@workspace/api-zod";
import { ProfileActionButton } from "@/components/gate-profile-chrome";
import { Textarea } from "@/components/ui/textarea";
import { isWorkHubAdmin } from "@/lib/work-hub-client";
import { BrandedInput, BrandedSelect } from "./chrome";
import { CampaignEditor, EmployeeForm, OwnerProgress } from "./form-campaigns";
import { useCampaign } from "./form-campaigns/use-campaign";

const PollListSchema = z.object({
  campaigns: z.array(FormCampaignSummarySchema),
});
const PollOptionsSchema = z.object({
  people: z.array(
    z.object({
      userId: z.number(),
      name: z.string().nullable(),
      role: z.string(),
    }),
  ),
});

export type PollSummary = z.infer<typeof FormCampaignSummarySchema>;

export function usePollCampaigns() {
  const api = useCampaign("/form-campaigns", (value) =>
    PollListSchema.parse(value),
  );
  return {
    ...api,
    polls: api.data?.campaigns.filter((campaign) => campaign.kind === "poll" || campaign.kind === "acknowledgement"),
  };
}

type StartPhase = "review" | "publish" | null;

export function NewPoll({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel?: () => void }) {
  const api = useCampaign("/form-campaigns/options", (value) =>
    PollOptionsSchema.parse(value),
  );
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"poll" | "acknowledgement">("poll");
  const [policyText, setPolicyText] = useState("");
  const [policyVersion, setPolicyVersion] = useState("1");
  const [description, setDescription] = useState("");
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState("Yes\nNo");
  const [durationHours, setDurationHours] = useState("24");
  const [audienceMode, setAudienceMode] = useState<"all_active" | "selected">(
    "all_active",
  );
  const [userIds, setUserIds] = useState<number[]>([]);
  const [validationError, setValidationError] = useState("");
  const [review, setReview] = useState<z.infer<typeof FormCampaignConfigSchema> | null>(null);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const phase = useRef<StartPhase>(null);
  const pendingCampaignId = useRef<string | null>(null);

  const reset = () => {
    setTitle("");
    setKind("poll");
    setPolicyText("");
    setPolicyVersion("1");
    setDescription("");
    setQuestion("");
    setAnswers("Yes\nNo");
    setDurationHours("24");
    setAudienceMode("all_active");
    setUserIds([]);
    setValidationError("");
    setReview(null);
    setSavedVersion(null);
    phase.current = null;
    pendingCampaignId.current = null;
  };
  const finished = async (campaignId: string) => {
    await queryClient.invalidateQueries({ queryKey: ["form-campaign"] });
    reset();
    onCreated(campaignId);
  };
  const publish = async (campaignId: string, version: number) => {
    phase.current = "publish";
    pendingCampaignId.current = campaignId;
    await api.sendAsync({
      path: `/form-campaigns/${campaignId}/publish`,
      payload: {},
      version,
    });
    await finished(campaignId);
  };
  const start = async () => {
    try {
      const choices = answers
        .split("\n")
        .map((answer) => answer.trim())
        .filter(Boolean)
        .map((label, index) => ({ id: `choice-${index + 1}`, label }));
      const timezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
      const config = FormCampaignConfigSchema.parse({
        kind,
        title,
        description,
        question: kind === "poll" ? question : "",
        policyText: kind === "acknowledgement" ? policyText : "",
        policyVersion,
        choices: kind === "poll" ? choices : [],
        maxSelections: 1,
        audience: { mode: audienceMode, userIds, rolling: false },
        durationHours: Number(durationHours),
        timezone,
      });
      if (kind === "poll" && !question.trim()) throw Error("Enter the poll question");
      if (kind === "acknowledgement" && !policyText.trim()) throw Error("Enter the policy wording");
      phase.current = "review";
      const created = await api.sendAsync({
        path: pendingCampaignId.current ? `/form-campaigns/${pendingCampaignId.current}` : "/form-campaigns",
        payload: config,
        version: savedVersion ?? undefined,
        method: pendingCampaignId.current ? "PATCH" : "POST",
      });
      const campaignId = z.uuid().parse(created.resource.campaignId);
      const state = FormCampaignStateSchema.parse(created.resource.state);
      setValidationError("");
      pendingCampaignId.current = campaignId;
      setSavedVersion(state.version);
      setReview(config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        setValidationError(error.issues.map((issue) => issue.message).join("; "));
      } else if (!api.uncertain) {
        setValidationError(error instanceof Error ? error.message : "Poll could not be started");
      }
    }
  };
  const retry = async () => {
    try {
      const result = await api.retryAsync();
      if (phase.current === "review") {
        const campaignId = z.uuid().parse(result.resource.campaignId);
        const state = FormCampaignStateSchema.parse(result.resource.state);
        pendingCampaignId.current = campaignId;
        setSavedVersion(state.version);
        setReview(FormCampaignConfigSchema.parse(result.resource.config));
      } else if (pendingCampaignId.current) {
        await finished(pendingCampaignId.current);
      }
    } catch {}
  };
  const admin = isWorkHubAdmin(api.user);
  if (!admin) {
    return (
      <p className="text-sm text-muted-foreground">
        A company administrator can create a poll or policy and choose who is notified.
      </p>
    );
  }
  return (
    <div className="grid gap-3" aria-label="New poll or policy controls">
      {review ? <Dialog open onOpenChange={open => { if (!open && !api.mutation.isPending && !api.uncertain) setReview(null); }}><MiniCardDialogContent icon={Vote} label="Review poll or policy" definition="Save for reuse or publish to Communications." iconColor="var(--brand-primary)"><section className="grid gap-3 p-4" aria-label="Poll or policy review">
        <h3 className="font-bold">{review.title}</h3>
        {review.description && <p>{review.description}</p>}
        {review.kind === "poll" ? <><p className="font-semibold">{review.question}</p>{review.choices.map((choice) => <p key={choice.id}>○ {choice.label}</p>)}</> : <><p>Version {review.policyVersion}</p><p className="whitespace-pre-wrap">{review.policyText}</p></>}
        <p>{review.audience.mode === "all_active" ? "All active company members" : `${review.audience.userIds.length} selected people`} · {review.durationHours} hours</p>
        <div className="flex flex-wrap gap-2">
          <ProfileActionButton onClick={() => { if (pendingCampaignId.current) void finished(pendingCampaignId.current); }}>Save</ProfileActionButton>
          <ProfileActionButton color="brand" disabled={api.mutation.isPending || api.uncertain} onClick={() => { if (pendingCampaignId.current && savedVersion !== null) void publish(pendingCampaignId.current, savedVersion).catch(error => setValidationError(error instanceof Error ? error.message : "Could not publish")); }}>Publish</ProfileActionButton>
          <ProfileActionButton onClick={() => setReview(null)}>Edit</ProfileActionButton>
          {onCancel && <ProfileActionButton onClick={onCancel}>Cancel</ProfileActionButton>}
        </div>
        {api.uncertain && <ProfileActionButton onClick={() => void retry()}>Retry pending action</ProfileActionButton>}
        {(validationError || api.mutation.error) && <p role="alert">{validationError || api.mutation.error?.message}</p>}
      </section></MiniCardDialogContent></Dialog> : <>
      <div className="flex gap-2">
        <ProfileActionButton color={kind === "poll" ? "brand" : undefined} onClick={() => setKind("poll")}>Poll</ProfileActionButton>
        <ProfileActionButton color={kind === "acknowledgement" ? "brand" : undefined} onClick={() => setKind("acknowledgement")}>Policy</ProfileActionButton>
      </div>
      <BrandedInput
        aria-label={`${kind === "poll" ? "Poll" : "Policy"} title`}
        placeholder={`${kind === "poll" ? "Poll" : "Policy"} title`}
        maxLength={200}
        value={title}
        disabled={api.mutation.isPending || api.uncertain}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Textarea
        aria-label="Description"
        placeholder="Description (optional)"
        className="min-h-20 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white"
        value={description}
        disabled={api.mutation.isPending || api.uncertain}
        onChange={(event) => setDescription(event.target.value)}
      />
      {kind === "poll" ? <><Textarea
        aria-label="Poll question"
        placeholder="Question"
        className="min-h-20 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white"
        value={question}
        disabled={api.mutation.isPending || api.uncertain}
        onChange={(event) => setQuestion(event.target.value)}
      />
      <Textarea
        aria-label="Poll possible answers"
        placeholder="Possible answers — one per line"
        className="min-h-24 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white"
        value={answers}
        disabled={api.mutation.isPending || api.uncertain}
        onChange={(event) => setAnswers(event.target.value)}
      />
      </> : <><BrandedInput aria-label="Policy version" placeholder="Version" value={policyVersion} onChange={event => setPolicyVersion(event.target.value)} /><Textarea aria-label="Policy wording" placeholder="Policy wording" className="min-h-40 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white" value={policyText} onChange={event => setPolicyText(event.target.value)} /></>}
      <label className="grid gap-1 text-sm font-medium">
        <span>Expires in</span>
        <BrandedSelect
          aria-label="Expiration"
          value={durationHours}
          disabled={api.mutation.isPending || api.uncertain}
          onChange={(event) => setDurationHours(event.target.value)}
        >
          <option value="1">1 hour</option>
          <option value="8">8 hours</option>
          <option value="24">24 hours</option>
          <option value="72">3 days</option>
          <option value="168">1 week</option>
        </BrandedSelect>
      </label>
      <label className="grid gap-1 text-sm font-medium">
        <span>Notify</span>
        <BrandedSelect
          aria-label="Who should be notified"
          value={audienceMode}
          disabled={api.mutation.isPending || api.uncertain}
          onChange={(event) => {
            const mode = event.target.value as "all_active" | "selected";
            setAudienceMode(mode);
            if (mode === "all_active") setUserIds([]);
          }}
        >
          <option value="all_active">All active company members</option>
          <option value="selected">Selected people</option>
        </BrandedSelect>
      </label>
      {(
        <div
          className="grid h-48 content-start gap-x-4 gap-y-1 overflow-y-auto rounded-xl border-2 border-[var(--brand-primary)] bg-[#242426] p-3"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, max(250px, 40%)), 1fr))" }}
          aria-label="Select people to notify"
        >
          {api.data?.people.map((person) => (
            <label key={person.userId} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={audienceMode === "all_active" || userIds.includes(person.userId)}
                disabled={api.mutation.isPending || api.uncertain}
                onChange={() => {
                  const selected = audienceMode === "all_active" ? (api.data?.people.map(person => person.userId) ?? []) : userIds;
                  setAudienceMode("selected");
                  setUserIds(((current) =>
                    current.includes(person.userId)
                      ? current.filter((id) => id !== person.userId)
                      : [...current, person.userId]
                  )(selected));
                }}
              />
              {person.name ?? `User ${person.userId}`}
            </label>
          ))}
        </div>
      )}
      {api.query.isPending && <p role="status">Loading notification choices…</p>}
      <div className="flex items-center justify-between gap-3">
      {api.uncertain ? (
        <ProfileActionButton
          color="brand"
          disabled={api.mutation.isPending}
          onClick={() => void retry()}
        >
          Retry pending poll start
        </ProfileActionButton>
      ) : (
        <ProfileActionButton
          color="brand"
          className="w-fit max-w-full justify-self-start"
          disabled={api.query.isPending || api.query.isError || api.mutation.isPending}
          onClick={() => void start()}
        >
          {api.mutation.isPending ? "Saving…" : "Review"}
        </ProfileActionButton>
      )}
      {onCancel && <ProfileActionButton onClick={onCancel}>Cancel</ProfileActionButton>}
      </div>
      {(validationError || api.query.error || api.mutation.error) && (
        <p role="alert" className="text-sm text-red-500">
          {validationError || api.mutation.error?.message || api.query.error?.message}
        </p>
      )}
      </>}
    </div>
  );
}

export function PollWorkspace({ poll, onSelect, onDeleted }: { poll: PollSummary; onSelect?: (id: string) => void; onDeleted?: () => void }) {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<{config: FormCampaignConfig; id?: string; version?: number} | null>(null);
  return (
    <section aria-label="Selected poll workspace" className="hub-poll-workspace grid gap-4">
      {poll.canManage && <OwnerProgress id={poll.campaignId}
        onEdit={(config, version) => setEditor({ config, id: poll.campaignId, version })}
        onReuse={config => setEditor({ config })}
        onDeleted={() => { void queryClient.invalidateQueries({ queryKey: ["form-campaign"] }); onDeleted?.(); }} />}
      {poll.instanceId && <EmployeeForm id={poll.instanceId} />}
      {!poll.canManage && !poll.instanceId && (
        <p className="text-sm text-muted-foreground">This poll is unavailable.</p>
      )}
      {editor && <CampaignEditor key={`${poll.campaignId}:${editor.id ?? "reuse"}`} initial={editor.config} id={editor.id} version={editor.version} onClose={() => setEditor(null)} onSaved={id => { setEditor(null); void queryClient.invalidateQueries({ queryKey: ["form-campaign"] }); onSelect?.(id); }} />}
    </section>
  );
}
