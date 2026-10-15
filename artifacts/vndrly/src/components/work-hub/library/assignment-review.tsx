import OptionSwitch from "./option-switch";
import React, { useEffect, useState, useRef } from "react";
import {
  Paragraph as Text,
  Field as TextInput,
  Frame as View,
  Pill as TogglePillButton,
  usePalette as useColors,
} from "./editor-controls";
import { z } from "zod/v4";
import { useTranslation } from "react-i18next";
import { useLibrary as useFormCampaigns } from "./use-library";
import { workHubRequest } from "@/lib/work-hub-client";
const listSchema = z.object({
  items: z.array(
    z.object({
      itemId: z.uuid(),
      title: z.string(),
      kind: z.string(),
      state: z.string(),
      version: z.number(),
    }),
  ),
});
const optionsSchema = z.object({
  people: z.array(
    z.object({ userId: z.number(), name: z.string().nullable() }),
  ),
  groups: z.array(z.object({ id: z.string(), name: z.string() })),
});
const previewSchema = z.object({
  itemId: z.uuid(),
  version: z.number(),
  title: z.string(),
  people: z.array(
    z.object({ userId: z.number(), name: z.string().nullable() }),
  ),
  items: z.array(
    z.object({ title: z.string(), estimatedDeadline: z.string() }),
  ),
  existingCount: z.number(),
  excluded: z.array(z.number()),
  omitted: z.array(z.object({ title: z.string(), reason: z.string() })),
  previewFingerprint: z.string(),
});
export default function LibraryAssignmentReview({
  kind,
  onSaved,
  initialItemId = "",
}: {
  kind: "form" | "policy" | "training" | "poll" | "bundle";
  initialItemId?: string;
  onSaved: () => Promise<unknown>;
}) {
  const { t } = useTranslation(),
    colors = useColors();
  const library = useFormCampaigns("/api/work-hub/library?published=true", (v) =>
    listSchema.parse(v),
  );
  const options = useFormCampaigns("/api/work-hub/library/options", (v) =>
    optionsSchema.parse(v),
  );
  const [itemId, setItemId] = useState(initialItemId),
    [userIds, setUsers] = useState<number[]>([]),
    [groupIds, setGroups] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [notice, setNotice] = useState(""),
    [review, setReview] = useState<z.infer<typeof previewSchema> | null>(null),
    [reviewing, setReviewing] = useState(false);
  const [renew, setRenew] = useState(false),
    [required, setRequired] = useState(false);
  const context = library.contextKey;
  const current = useRef(context);
  current.current = context;
  const captureAuthScope = () => context,
    isAuthScopeCurrent = (scope: string) => scope === current.current;
  const apiFetch = (path: string, init: RequestInit, _scope: string) =>
    workHubRequest(path.replace(/^\/api\/work-hub/, ""), init);

  useEffect(() => {
    setItemId(initialItemId);
    setUsers([]);
    setGroups([]);
    setReview(null);
    setNotice("");
  }, [kind, context, initialItemId]);
  const selected = library.data?.items.find((i) => i.itemId === itemId);
  const frozen = library.busy || library.uncertain || reviewing;
  const request = {
    itemId,
    audience: { mode: "selected", userIds, groupIds },
    renew,
    requiredBeforeWork: required,
    presentation: "immediate",
  };
  const change = (run: () => void) => {
    if (frozen) return;
    run();
    setReview(null);
  };
  const preview = async () => {
    if (!selected || (!userIds.length && !groupIds.length)) {
      setNotice(t("workHubLibrary.chooseAudience"));
      return;
    }
    const scope = captureAuthScope();
    setReviewing(true);
    setNotice("");
    try {
      const result = previewSchema.parse(
        await apiFetch(
          "/api/work-hub/library/assignment-preview",
          { method: "POST", body: JSON.stringify(request) },
          scope,
        ),
      );
      if (isAuthScopeCurrent(scope) && result.itemId === itemId)
        setReview(result);
    } catch (e) {
      if (isAuthScopeCurrent(scope))
        setNotice(
          e instanceof Error ? e.message : t("workHubLibrary.unavailable"),
        );
    } finally {
      if (isAuthScopeCurrent(scope)) setReviewing(false);
    }
  };
  const assign = async () => {
    try {
      const result = library.uncertain
        ? await library.retryOriginal()
        : await library.send(
            "/api/work-hub/library/assign",
            { ...request, previewFingerprint: review?.previewFingerprint },
            review?.version,
          );
      if (!result.resource.assignmentId)
        throw Error(t("workHubLibrary.unconfirmed"));
      setReview(null);
      setNotice(t("workHubLibrary.assigned"));
      await onSaved();
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : t("workHubLibrary.unconfirmed"),
      );
    }
  };
  const field = {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 10,
    padding: 12,
    color: colors.text,
  };
  const toggle = <T,>(value: T, current: T[], set: (v: T[]) => void) =>
    change(() =>
      set(
        current.includes(value)
          ? current.filter((x) => x !== value)
          : [...current, value],
      ),
    );
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: colors.text }}>
        {t("workHubLibrary.choosePublished")}
      </Text>
      {library.data?.items
        .filter((i) => i.kind === kind && i.state === "published")
        .map((i) => (
          <TogglePillButton
            key={i.itemId}
            color="brand"
            solid={itemId === i.itemId}
            disabled={frozen}
            onPress={() => change(() => setItemId(i.itemId))}
          >
            {i.title}
          </TogglePillButton>
        ))}
      {library.data &&
        !library.data.items.some(
          (i) => i.kind === kind && i.state === "published",
        ) && (
          <Text style={{ color: colors.text }}>
            {t("workHubLibrary.noPublished")}
          </Text>
        )}
      <TextInput
        accessibilityLabel={t("workHubLibrary.searchAudience")}
        placeholder={t("workHubLibrary.searchAudience")}
        value={search}
        onChangeText={setSearch}
        style={field}
      />
      <Text style={{ color: colors.text }}>{t("workHubLibrary.groups")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.data?.groups
          .filter((g) => g.name.toLowerCase().includes(search.toLowerCase()))
          .map((g) => (
            <TogglePillButton
              key={g.id}
              color="brand"
              solid={groupIds.includes(g.id)}
              disabled={frozen}
              onPress={() => toggle(g.id, groupIds, setGroups)}
            >
              {g.name}
            </TogglePillButton>
          ))}
      </View>
      <Text style={{ color: colors.text }}>{t("workHubLibrary.people")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.data?.people
          .filter((p) =>
            (p.name ?? "").toLowerCase().includes(search.toLowerCase()),
          )
          .map((p) => (
            <TogglePillButton
              key={p.userId}
              color="brand"
              solid={userIds.includes(p.userId)}
              disabled={frozen}
              onPress={() => toggle(p.userId, userIds, setUsers)}
            >
              {p.name ?? String(p.userId)}
            </TogglePillButton>
          ))}
      </View>
      <OptionSwitch
        label={t("workHubLibrary.renew")}
        value={renew}
        disabled={frozen}
        onChange={(v) => change(() => setRenew(v))}
      />
      <OptionSwitch
        label={t("workHubLibrary.required")}
        value={required}
        disabled={frozen}
        onChange={(v) => change(() => setRequired(v))}
      />
      {!!(notice || library.error || options.error) && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
          {notice || library.error || options.error}
        </Text>
      )}
      {review && (
        <View
          style={{
            borderWidth: 2,
            borderColor: colors.primary,
            borderRadius: 12,
            padding: 12,
            gap: 8,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "700" }}>
            {t("workHubLibrary.review")}: {review.title}
          </Text>
          <Text style={{ color: colors.text }}>
            {t("workHubLibrary.recipientCount", {
              count: review.people.length,
            })}{" "}
            ·{" "}
            {t("workHubLibrary.existingCount", { count: review.existingCount })}
          </Text>
          <Text style={{ color: colors.text }}>
            {review.people.map((p) => p.name).join(", ")}
          </Text>
          {review.items.map((i, index) => (
            <Text key={index} style={{ color: colors.text }}>
              {i.title} · {new Date(i.estimatedDeadline).toLocaleString()}
            </Text>
          ))}
          {review.omitted.map((i, index) => (
            <Text key={index} style={{ color: colors.text }}>
              {i.title}: {i.reason}
            </Text>
          ))}
        </View>
      )}
      <TogglePillButton
        color="brand"
        disabled={
          library.busy ||
          reviewing ||
          library.loading ||
          options.loading ||
          !!options.error ||
          (!!library.error && !library.uncertain)
        }
        onPress={() =>
          void (review || library.uncertain ? assign() : preview())
        }
      >
        {library.busy || reviewing
          ? t("workHubLibrary.saving")
          : library.uncertain
            ? t("workHubLibrary.retry")
            : review
              ? t("workHubLibrary.confirmAssign")
              : t("workHubLibrary.review")}
      </TogglePillButton>
    </View>
  );
}
