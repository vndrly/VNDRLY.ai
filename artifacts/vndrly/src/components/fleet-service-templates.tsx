import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  buildFleetServiceTemplate,
  FLEET_WORK_FAMILIES,
  FleetPricingBasisSchema,
  FleetServiceTemplateSchema,
  FleetWorkCommandSchema,
  fleetServiceTemplateLabels,
  fleetServiceTemplateBasisLabel,
  type FleetServiceTemplate,
  type FleetWorkCommand,
  type FleetOverview,
  type FleetServiceTemplatePageSchema,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { fleetClient } from "@/lib/fleet-client";
import { useFleetWork } from "@/hooks/use-fleet-work";
import { FleetProfileFields } from "./fleet-profile-fields";
import { BrandedCheckbox } from "./branded-checkbox";
import { PngPillButton } from "./png-pill-rollover";
type Page = z.infer<typeof FleetServiceTemplatePageSchema>;
export function FleetServiceTemplates({ identity }: { identity: string }) {
  const { i18n } = useTranslation(),
    c = fleetServiceTemplateLabels(i18n?.language ?? "en"),
    alive = useRef(true),
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
    locked = busy || !!pending.current;
  const current = () => alive.current;
  async function load() {
    const version = ++generation.current;
    try {
      const [page, overview] = await Promise.all([
        fleetClient.serviceTemplates(),
        fleetClient.overview(),
      ]);
      if (current() && version === generation.current)
        setData({ page, overview });
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
    if (!draft || !work.session || busy) return;
    setBusy(true);
    try {
      prepare();
      const command = pending.current;
      if (!command) throw Error(c.unavailable);
      const result = await work.session.execute(command);
      if (!current()) return;
      if (!result.canonicalApplied) {
        setMessage(c.pending);
        return;
      }
      const saved = await fleetClient.serviceTemplate(
        command.payload.template.serviceId,
        command.payload.template.revision,
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
  function prepare() {
    if (!draft || pending.current) return;
    const operationId = crypto.randomUUID();
    const command = FleetWorkCommandSchema.parse({
      version: 2,
      scope: work.session!.scope,
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
    if (command.kind !== "service_template.save") throw Error(c.unavailable);
    pending.current = command;
  }
  return (
    <section className="fleet-panel space-y-4">
      <h2>{c.title}</h2>
      <p>{c.hint}</p>
      <PngPillButton
        disabled={busy || !!pending.current}
        onClick={() => void load()}
      >
        {c.read}
      </PngPillButton>
      {data?.page.services.length === 0 && <p>{c.noServices}</p>}
      <label>
        {c.service}
        <select
          aria-label={c.service}
          disabled={busy}
          value={draft?.serviceId ?? ""}
          onChange={(e) => select(Number(e.target.value))}
        >
          <option value="">{c.choose}</option>
          {data?.page.services.map((row) => (
            <option key={row.serviceId} value={row.serviceId}>
              {row.name}
            </option>
          ))}
        </select>
      </label>
      {draft && (
        <>
          <fieldset
            disabled={locked || !data?.page.canManage}
            className="space-y-3"
          >
            <label>
              {c.family}
              <select
                aria-label={c.family}
                value={draft.family}
                onChange={(e) =>
                  select(draft.serviceId, e.target.value as typeof draft.family)
                }
              >
                {FLEET_WORK_FAMILIES.map((family) => (
                  <option key={family} value={family}>
                    {c.families[family]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {c.name}
              <input
                aria-label={c.name}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              {c.material}
              <textarea
                aria-label={c.material}
                value={materials}
                onChange={(e) => setMaterials(e.target.value)}
              />
            </label>
            <label>
              {c.capabilities}
              <textarea
                aria-label={c.capabilities}
                value={capabilities}
                onChange={(e) => setCapabilities(e.target.value)}
              />
            </label>
            <label>
              {c.basis}
              <select
                aria-label={c.basis}
                value={draft.preferredBasis ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    preferredBasis: e.target.value
                      ? (e.target.value as NonNullable<
                          typeof draft.preferredBasis
                        >)
                      : null,
                  })
                }
              >
                <option value="">{c.choose}</option>
                {FleetPricingBasisSchema.options.map((basis) => (
                  <option key={basis} value={basis}>
                    {fleetServiceTemplateBasisLabel(basis,i18n?.language)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <BrandedCheckbox
                checked={draft.enabled}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, enabled: checked === true })
                }
              />
              {c.enabled}
            </label>
            <FleetProfileFields
              key={`${draft.serviceId}:${draft.family}`}
              value={draft.profile}
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
          </fieldset>
          <PngPillButton
            disabled={busy || !work.session || !data?.page.canManage}
            onClick={() => void save()}
          >
            {pending.current ? c.retry : c.save}
          </PngPillButton>
          {!work.session && <p>{c.connect}</p>}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
