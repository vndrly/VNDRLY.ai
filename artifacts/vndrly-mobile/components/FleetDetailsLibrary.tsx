import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import {
  FleetDetailPageSchema,
  FleetRigPackagePageSchema,
  FleetDetailSchema,
  FleetRigPackageSchema,
  FleetComplianceAssessmentsSchema,
  fleetResourceComplianceSubjects,
  fleetResourceReadinessIndex,
  type FleetDetail,
  type FleetOverview,
  type FleetResources,
  type FleetRigPackage,
} from "@workspace/api-zod";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import { FleetDetailBuilder, FleetRigPackageBuilder } from "./FleetDetails";
import FleetChoiceField from "./FleetChoiceField";
import TogglePillButton from "./TogglePillButton";
import { useFleetCopy } from "@/lib/fleet-copy";
type Data = {
  overview: FleetOverview;
  resources: FleetResources;
  details: ReturnType<typeof FleetDetailPageSchema.parse>;
  rigs: ReturnType<typeof FleetRigPackagePageSchema.parse>;
};
export default function FleetDetailsLibrary() {
  const copy = useFleetCopy();
  const colors = useColors(),
    scope = useRef(captureAuthScope()),
    alive = useRef(true),
    generation = useRef(0),
    loading = useRef(false);
  const [data, setData] = useState<Data | null>(null),
    [group, setGroup] = useState(""),
    [edit, setEdit] = useState<FleetDetail | undefined>(),
    [rigView, setRigView] = useState(false),
    [editRig, setEditRig] = useState<FleetRigPackage | undefined>(),
    [error, setError] = useState("");
  const [assessments, setAssessments] = useState<
    Record<string, { status: "green" | "red"; label: string }>
  >({});
  useEffect(() => {
    const resources = data?.resources;
    let cancelled = false,
      sequence = 0;
    async function refresh() {
      const attempt = ++sequence;
      setAssessments({});
      if (!resources) return;
      try {
        const subjects = fleetResourceComplianceSubjects(resources),
          summaries = [];
        for (let offset = 0; offset < subjects.length; offset += 100) {
          const page = FleetComplianceAssessmentsSchema.parse(
            await apiFetch<unknown>(
              "/api/fleet/compliance/assessments",
              {
                method: "POST",
                body: JSON.stringify({
                  subjects: subjects.slice(offset, offset + 100),
                }),
              },
              scope.current,
            ),
          );
          summaries.push(...page.summaries);
        }
        if (!cancelled && attempt === sequence && current())
          setAssessments(
            Object.fromEntries(
              Object.entries(
                fleetResourceReadinessIndex(subjects, summaries),
              ).map(([id, value]) => [
                id,
                {
                  status: value.status,
                  label: value.reasons.length
                    ? value.reasons.map((reason) => copy(reason)).join(", ")
                    : copy("Current reviewed evidence"),
                },
              ]),
            ),
          );
      } catch {
        if (!cancelled && attempt === sequence && current()) setAssessments({});
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [data?.resources, copy]);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  const request = <T,>(path: string, body?: unknown) =>
    apiFetch<T>(
      `/api/fleet${path}`,
      body ? { method: "POST", body: JSON.stringify(body) } : {},
      scope.current,
    );
  async function load() {
    const revision = ++generation.current;
    try {
      const [overview, resources, detailValue, rigValue] = await Promise.all([
        request<FleetOverview>("/overview"),
        request<FleetResources>("/resources"),
        request<unknown>("/details"),
        request<unknown>("/rig-packages"),
      ]);
      if (current() && revision === generation.current) {
        setData({
          overview,
          resources,
          details: FleetDetailPageSchema.parse(detailValue),
          rigs: FleetRigPackagePageSchema.parse(rigValue),
        });
        setError("");
      }
    } catch (error) {
      if (current() && revision === generation.current)
        setError(
          error instanceof Error ? error.message : "Details unavailable.",
        );
      throw error;
    }
  }
  useEffect(() => {
    alive.current = true;
    void load().catch(() => undefined);
    return () => {
      alive.current = false;
    };
  }, []);
  async function more(kind: "details" | "rigs") {
    if (!data || loading.current) return;
    const after =
      kind === "details" ? data.details.nextCursor : data.rigs.nextCursor;
    if (!after) return;
    loading.current = true;
    try {
      const raw = await request<unknown>(
        `/${kind === "details" ? "details" : "rig-packages"}?after=${encodeURIComponent(after)}`,
      );
      if (!current()) return;
      if (kind === "details") {
        const next = FleetDetailPageSchema.parse(raw);
        setData((prior) =>
          prior
            ? {
                ...prior,
                details: {
                  ...next,
                  details: [
                    ...new Map(
                      [...prior.details.details, ...next.details].map(
                        (item) => [item.id, item],
                      ),
                    ).values(),
                  ],
                },
              }
            : prior,
        );
      } else {
        const next = FleetRigPackagePageSchema.parse(raw);
        setData((prior) =>
          prior
            ? {
                ...prior,
                rigs: {
                  ...next,
                  rigPackages: [
                    ...new Map(
                      [...prior.rigs.rigPackages, ...next.rigPackages].map(
                        (item) => [item.id, item],
                      ),
                    ).values(),
                  ],
                },
              }
            : prior,
        );
      }
    } catch (error) {
      if (current()) setError((error as Error).message);
    } finally {
      loading.current = false;
    }
  }
  if (!data)
    return (
      <View>
        {error ? (
          <Text accessibilityRole="alert">{error}</Text>
        ) : (
          <Text>Loading Details…</Text>
        )}
        <TogglePillButton onPress={() => void load().catch(() => undefined)}>
          Refresh Details
        </TogglePillButton>
      </View>
    );
  const text = { color: colors.text },
    selectedGroup = group || data.overview.fleets[0]?.id;
  return (
    <View style={{ gap: 16 }}>
      <Text style={[text, { fontWeight: "700", fontSize: 20 }]}>
        Reusable Details
      </Text>
      <Text style={text}>
        Canonical truck, optional rig package and driver. Inventory custody is
        unchanged.
      </Text>
      {error && (
        <Text accessibilityRole="alert" style={text}>
          {error}
        </Text>
      )}
      {data.details.canManage && (
        <>
          <TogglePillButton onPress={() => setRigView(!rigView)}>
            {rigView ? "Build Detail" : "Rig packages"}
          </TogglePillButton>
          {rigView ? (
            <FleetRigPackageBuilder
              key={`${editRig?.id ?? "new"}:${editRig?.version ?? 0}`}
              companyId={data.overview.companyId}
              equipment={data.resources.equipment}
              initialPackage={editRig}
              onSave={async (input) => {
                if (!current()) throw new Error("Account context changed.");
                const saved = FleetRigPackageSchema.parse(
                  await request("/rig-packages", input),
                );
                if (
                  saved.id !== input.package.id ||
                  saved.version !== input.package.version
                )
                  throw new Error("Saved package needs verification.");
                if (current()) {
                  setEditRig(undefined);
                  await load();
                }
              }}
            />
          ) : (
            <>
              <FleetChoiceField
                label="Dispatch access"
                value={selectedGroup ?? ""}
                options={data.overview.fleets.map((item) => ({
                  id: item.id,
                  label: item.name,
                }))}
                onChange={setGroup}
              />
              <FleetDetailBuilder
                key={`${edit?.id ?? "new"}:${selectedGroup}`}
                companyId={data.overview.companyId}
                accessGroupIds={
                  edit?.accessGroupIds ?? (selectedGroup ? [selectedGroup] : [])
                }
                resources={data.resources}
                rigPackages={data.rigs.rigPackages}
                assessments={assessments}
                initialDetail={edit}
                onSave={async (input) => {
                  if (!current()) throw new Error("Account context changed.");
                  const saved = FleetDetailSchema.parse(
                    await request("/details", input),
                  );
                  if (
                    saved.id !== input.detail.id ||
                    saved.version !== input.detail.version
                  )
                    throw new Error("Saved Detail needs verification.");
                  if (current()) {
                    setEdit(undefined);
                    await load();
                  }
                }}
              />
            </>
          )}
        </>
      )}
      {rigView &&
        data.rigs.rigPackages.map((item) => (
          <View
            key={item.id}
            style={{
              borderWidth: 2,
              borderColor: colors.primary,
              padding: 16,
              borderRadius: 12,
              gap: 10,
              backgroundColor: colors.card,
            }}
          >
            <Text style={text}>
              {item.name} · revision {item.version} · {item.components.length}{" "}
              components
            </Text>
            {data.details.canManage && (
              <TogglePillButton onPress={() => setEditRig(item)}>
                Edit {item.name}
              </TogglePillButton>
            )}
          </View>
        ))}
      {data.details.details.map((item) => (
        <View
          key={item.id}
          style={{
            borderWidth: 2,
            borderColor: colors.primary,
            borderRadius: 12,
            padding: 16,
            gap: 10,
            backgroundColor: colors.card,
          }}
        >
          <Text style={[text, { fontWeight: "700" }]}>{item.name}</Text>
          <Text style={text}>
            {data.resources.equipment.find(
              (asset) => asset.id === item.vehicleAssetId,
            )?.name ?? "Truck"}{" "}
            ·{" "}
            {data.resources.drivers.find(
              (driver) => driver.userId === item.driverUserId,
            )?.name ?? "Assigned driver"}{" "}
            · revision {item.version}
          </Text>
          {data.details.canManage && (
            <TogglePillButton onPress={() => setEdit(item)}>
              Edit {item.name}
            </TogglePillButton>
          )}
        </View>
      ))}
      {data.details.nextCursor && (
        <TogglePillButton onPress={() => void more("details")}>
          Load more Details
        </TogglePillButton>
      )}
      {data.rigs.nextCursor && (
        <TogglePillButton onPress={() => void more("rigs")}>
          Load more rig packages
        </TogglePillButton>
      )}
    </View>
  );
}
