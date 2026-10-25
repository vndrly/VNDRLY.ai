import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod/v4";
import {
  FormCampaignConfigSchema,
  FormCampaignStateSchema,
  FormCampaignSummarySchema,
} from "@workspace/api-zod";
import BrandPillButton from "@/components/brand-pill-button";
import { Textarea } from "@/components/ui/textarea";
import { isWorkHubAdmin } from "@/lib/work-hub-client";
import { BrandedInput, BrandedSelect } from "./chrome";
import { EmployeeForm, OwnerProgress } from "./form-campaigns";
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
    polls: api.data?.campaigns.filter((campaign) => campaign.kind === "poll"),
  };
}

type StartPhase = "create" | "publish" | null;

export function NewPoll({ onCreated }: { onCreated: (id: string) => void }) {
  const api = useCampaign("/form-campaigns/options", (value) =>
    PollOptionsSchema.parse(value),
  );
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState("Yes\nNo");
  const [durationHours, setDurationHours] = useState("24");
  const [audienceMode, setAudienceMode] = useState<"all_active" | "selected">(
    "all_active",
  );
  const [userIds, setUserIds] = useState<number[]>([]);
  const [validationError, setValidationError] = useState("");
  const phase = useRef<StartPhase>(null);
  const pendingCampaignId = useRef<string | null>(null);

  const reset = () => {
    setTitle("");
    setDescription("");
    setQuestion("");
    setAnswers("Yes\nNo");
    setDurationHours("24");
    setAudienceMode("all_active");
    setUserIds([]);
    setValidationError("");
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
        kind: "poll",
        title,
        description,
        question,
        choices,
        maxSelections: 1,
        audience: { mode: audienceMode, userIds, rolling: false },
        durationHours: Number(durationHours),
        timezone,
      });
      if (!question.trim()) throw Error("Enter the poll question");
      phase.current = "create";
      const created = await api.sendAsync({
        path: "/form-campaigns",
        payload: config,
      });
      const campaignId = z.uuid().parse(created.resource.campaignId);
      const state = FormCampaignStateSchema.parse(created.resource.state);
      setValidationError("");
      await publish(campaignId, state.version);
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
      if (phase.current === "create") {
        const campaignId = z.uuid().parse(result.resource.campaignId);
        const state = FormCampaignStateSchema.parse(result.resource.state);
        await publish(campaignId, state.version);
      } else if (pendingCampaignId.current) {
        await finished(pendingCampaignId.current);
      }
    } catch {}
  };
  const admin = isWorkHubAdmin(api.user);
  if (!admin) {
    return (
      <p className="text-sm text-muted-foreground">
        A company administrator can start a poll and choose who is notified.
      </p>
    );
  }
  return (
    <div className="grid gap-3" aria-label="New poll controls">
      <BrandedInput
        aria-label="Poll title"
        placeholder="Poll title"
        maxLength={200}
        value={title}
        disabled={api.mutation.isPending || api.uncertain}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Textarea
        aria-label="Poll description"
        placeholder="Description (optional)"
        className="min-h-20 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white"
        value={description}
        disabled={api.mutation.isPending || api.uncertain}
        onChange={(event) => setDescription(event.target.value)}
      />
      <Textarea
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
      <label className="grid gap-1 text-sm font-medium">
        <span>Expires in</span>
        <BrandedSelect
          aria-label="Poll expiration"
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
      {audienceMode === "selected" && (
        <div
          className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-gray-200 p-2"
          aria-label="Select people to notify"
        >
          {api.data?.people.map((person) => (
            <label key={person.userId} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={userIds.includes(person.userId)}
                disabled={api.mutation.isPending || api.uncertain}
                onChange={() =>
                  setUserIds((current) =>
                    current.includes(person.userId)
                      ? current.filter((id) => id !== person.userId)
                      : [...current, person.userId],
                  )
                }
              />
              {person.name ?? `User ${person.userId}`}
            </label>
          ))}
        </div>
      )}
      {api.query.isPending && <p role="status">Loading notification choices…</p>}
      {api.uncertain ? (
        <BrandPillButton
          tone="brand"
          disabled={api.mutation.isPending}
          onClick={() => void retry()}
        >
          Retry pending poll start
        </BrandPillButton>
      ) : (
        <BrandPillButton
          tone="brand"
          className="w-fit max-w-full justify-self-start"
          disabled={api.query.isPending || api.query.isError || api.mutation.isPending}
          onClick={() => void start()}
        >
          {api.mutation.isPending ? "Starting…" : "Start Poll"}
        </BrandPillButton>
      )}
      {(validationError || api.query.error || api.mutation.error) && (
        <p role="alert" className="text-sm text-red-500">
          {validationError || api.mutation.error?.message || api.query.error?.message}
        </p>
      )}
    </div>
  );
}

export function PollWorkspace({ poll }: { poll: PollSummary }) {
  return (
    <section aria-label="Selected poll workspace" className="hub-poll-workspace grid gap-4">
      {poll.canManage && <OwnerProgress id={poll.campaignId} />}
      {poll.instanceId && <EmployeeForm id={poll.instanceId} />}
      {!poll.canManage && !poll.instanceId && (
        <p className="text-sm text-muted-foreground">This poll is unavailable.</p>
      )}
    </section>
  );
}
