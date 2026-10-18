import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Crypto from "expo-crypto";
import {
  buildFleetServiceTemplate,
  FLEET_WORK_FAMILIES,
  FleetPricingBasisSchema,
  FleetServiceTemplateSchema,
  FleetServiceTemplatePageSchema,
  FleetWorkCommandSchema,
  fleetServiceTemplateLabels,
  type FleetServiceTemplate,
  type FleetWorkCommand,
  type FleetOverview,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useFleetWork } from "@/hooks/use-fleet-work";
import { useColors } from "@/hooks/useColors";
import FleetProfileEditor from "./FleetProfileEditor";
import FleetChoiceField from "./FleetChoiceField";
import FleetCheckbox from "./FleetCheckbox";
import TogglePillButton from "./TogglePillButton";
type Page = z.infer<typeof FleetServiceTemplatePageSchema>;
export default function FleetServiceTemplates({
  identity,
}: {
  identity: string;
}) {
  const { i18n } = useTranslation(),
    c = fleetServiceTemplateLabels(i18n?.language ?? "en"),
    colors = useColors(),
    alive = useRef(true),
    scope = useRef(captureAuthScope()),
    generation = useRef(0),
    [data, setData] = useState<{ page: Page; overview: FleetOverview } | null>(
      null,
    ),
    [draft, setDraft] = useState<FleetServiceTemplate | null>(null),
    [materials, setMaterials] = useState(""),
    [capabilities, setCapabilities] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const work = useFleetWork(data?.overview.accountScope, []),
    pending = useRef<Extract<
      FleetWorkCommand,
      { kind: "service_template.save" }
    > | null>(null),
    retainedByService = useRef(new Map<number, Extract<FleetWorkCommand, {kind: "service_template.save"}>>()),
    locked = busy || !!pending.current,
    current = () => alive.current && isAuthScopeCurrent(scope.current),
    text = { color: colors.text },
    input = {
      color: colors.text,
      padding: 12,
      borderWidth: 2,
      borderRadius: 8,
      borderColor: colors.primary,
    };
  async function load() {
    const version = ++generation.current;
    try {
      const [value, overview] = await Promise.all([
        apiFetch("/api/fleet/service-templates", {}, scope.current),
        apiFetch<FleetOverview>("/api/fleet/overview", {}, scope.current),
      ]);
      if (current() && version === generation.current)
        setData({
          page: FleetServiceTemplatePageSchema.parse(value),
          overview,
        });
    } catch {
      if (current() && version === generation.current) {
        setData(null);
        setMessage(c.unavailable);
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, [identity]);
  function select(id: number, family?: (typeof FLEET_WORK_FAMILIES)[number]) {
    if (pending.current) retainedByService.current.set(pending.current.payload.template.serviceId, pending.current);
    const row = data?.page.services.find((row) => row.serviceId === id);
    if (!row) return;
    const retained = work.commands.find(
      (
        command,
      ): command is Extract<
        FleetWorkCommand,
        { kind: "service_template.save" }
      > =>
        command.kind === "service_template.save" &&
        command.payload.template.serviceId === id,
    );
    pending.current = retainedByService.current.get(id) ?? retained ?? null;
    const value =
      pending.current?.payload.template ??
      (family
        ? {
            ...buildFleetServiceTemplate({
              family,
              serviceId: id,
              serviceName: row.name.slice(0, 100),
            }),
            revision: row.template?.revision ?? 0,
          }
        : (row.template ??
          buildFleetServiceTemplate({
            family: "vendor_defined",
            serviceId: id,
            serviceName: row.name.slice(0, 100),
          })));
    setDraft(structuredClone(value));
    setMaterials(value.commodities.join("\n"));
    setCapabilities(value.capabilities.join("\n"));
    setMessage(pending.current ? c.pending : "");
  }
  const retainedSignature = JSON.stringify(work.commands);
  useEffect(() => {
    if (!draft || busy || pending.current) return;
    if (work.commands.some(command => command.kind === "service_template.save" && command.payload.template.serviceId === draft.serviceId)) select(draft.serviceId);
  }, [retainedSignature, draft?.serviceId, busy]);
  async function save() {
    if (!draft || !work.session || busy || !current()) return;
    setBusy(true);
    try {
      if (!pending.current) {
        const operationId = Crypto.randomUUID();
        const captured = FleetWorkCommandSchema.parse({
          version: 2,
          scope: work.session.scope,
          operationId,
          kind: "service_template.save",
          capturedAt: new Date().toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          dependencies: [],
          payload: {
            operationId,
            expectedRevision: draft.revision,
            template: {
              ...draft,
              revision: draft.revision + 1,
              commodities: materials
                .split("\n")
                .map((x) => x.trim())
                .filter(Boolean),
              capabilities: capabilities
                .split("\n")
                .map((x) => x.trim())
                .filter(Boolean),
            },
          },
        });
        if (captured.kind !== "service_template.save") throw Error(c.unavailable);
        pending.current = captured;
      }
      const command = pending.current;
      const result = await work.session.execute(command);
      if (!current()) return;
      if (!result.canonicalApplied) {
        setMessage(c.pending);
        return;
      }
      const saved = FleetServiceTemplateSchema.parse(
        await apiFetch(
          `/api/fleet/service-templates/${command.payload.template.serviceId}?revision=${command.payload.template.revision}`,
          {},
          scope.current,
        ),
      );
      if (!current()) return;
      if (JSON.stringify(saved) !== JSON.stringify(command.payload.template))
        throw Error(c.unavailable);
      retainedByService.current.delete(command.payload.template.serviceId);
      pending.current = null;
      setDraft(saved);
      setMessage(c.saved);
      await load();
    } catch (error) {
      if (current())
        setMessage(error instanceof Error ? error.message : c.unavailable);
    } finally {
      if (current()) {
        setBusy(false);
        void work.refresh(false);
      }
    }
  }
  const field = (
    label: string,
    value: string,
    onChangeText: (value: string) => void,
    multiline = false,
  ) => (
    <View>
      <Text style={text}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={!locked && !!data?.page.canManage}
        style={input}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
      />
    </View>
  );
  return (
    <View
      style={{
        padding: 16,
        gap: 12,
        borderWidth: 2,
        borderColor: colors.primary,
        backgroundColor: colors.card,
        borderRadius: 12,
      }}
    >
      <Text accessibilityRole="header" style={text}>
        {c.title}
      </Text>
      <Text style={text}>{c.hint}</Text>
      <TogglePillButton
        disabled={busy || !!pending.current}
        onPress={() => void load()}
      >
        {c.read}
      </TogglePillButton>
      {data?.page.services.length === 0 && (
        <Text style={text}>{c.noServices}</Text>
      )}
      <FleetChoiceField
        label={c.service}
        value={String(draft?.serviceId ?? "")}
        disabled={busy}
        options={
          data?.page.services.map((row) => ({
            id: String(row.serviceId),
            label: row.name,
          })) ?? []
        }
        onChange={(id) => select(Number(id))}
      />
      {draft && (
        <>
          <FleetChoiceField
            label={c.family}
            value={draft.family}
            disabled={locked || !data?.page.canManage}
            options={FLEET_WORK_FAMILIES.map((id) => ({
              id,
              label: c.families[id],
            }))}
            onChange={(family) =>
              select(draft.serviceId, family as typeof draft.family)
            }
          />
          {field(c.name, draft.name, (name) => setDraft({ ...draft, name }))}
          {field(c.material, materials, setMaterials, true)}
          {field(c.capabilities, capabilities, setCapabilities, true)}
          <FleetChoiceField
            label={c.basis}
            value={draft.preferredBasis ?? ""}
            disabled={locked || !data?.page.canManage}
            options={[
              { id: "", label: c.choose },
              ...FleetPricingBasisSchema.options.map((id) => ({
                id,
                label: id.replaceAll("_", " "),
              })),
            ]}
            onChange={(basis) =>
              setDraft({
                ...draft,
                preferredBasis: basis
                  ? (basis as NonNullable<typeof draft.preferredBasis>)
                  : null,
              })
            }
          />
          <FleetCheckbox
            label={c.enabled}
            checked={draft.enabled}
            disabled={locked || !data?.page.canManage}
            onChange={(enabled) => setDraft({ ...draft, enabled })}
          />
          <FleetProfileEditor
            key={`${draft.serviceId}:${draft.family}`}
            profile={draft.profile}
            disabled={locked || !data?.page.canManage}
            onChange={(profile) =>
              setDraft({
                ...draft,
                profile: profile ?? {
                  name: draft.name,
                  inspectionItems: [],
                  manifestFields: [],
                },
              })
            }
          />
          <TogglePillButton
            disabled={busy || !work.session || !data?.page.canManage}
            onPress={() => void save()}
          >
            {pending.current ? c.retry : c.save}
          </TogglePillButton>
          {!work.session && <Text style={text}>{c.connect}</Text>}
        </>
      )}
      {!!message && <Text style={text}>{message}</Text>}
    </View>
  );
}
