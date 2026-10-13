import React, { useEffect, useRef, useState } from "react";
import { Modal, ScrollView, Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import {
  FleetDestinationSchema,
  type FleetDestination,
} from "@workspace/api-zod";
import TogglePillButton from "./TogglePillButton";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
export type CommercialContext = {
  version: number;
  defaultMode: "batch" | "singles";
  destinations: FleetDestination[];
  sitePolicy: { mode?: "batch" | "singles" } | null;
  canManage: boolean;
  sites: { siteId: number; name: string }[];
};
export function useCommercialScope() {
  const { user, activeMembershipId, activeMembership } = useAuth();
  return `${user?.id}:${activeMembershipId}:${activeMembership?.orgType}:${activeMembership?.orgId}`;
}
export default function FleetDestinationDirectory(props: {
  siteId?: number;
  onChanged?: () => void;
}) {
  const scope = useCommercialScope();
  return <Directory key={`${scope}:${props.siteId}`} {...props} />;
}
function Directory({
  siteId,
  onChanged,
}: {
  siteId?: number;
  onChanged?: () => void;
}) {
  const colors = useColors(),
    alive = useRef(true),
    lock = useRef(false),
    scope = useRef(captureAuthScope());
  const [data, setData] = useState<CommercialContext | null>(null),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [draft, setDraft] = useState<any>(null),
    [attempt, setAttempt] = useState<any>(null),
    [busy, setBusy] = useState(false);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  async function load() {
    try {
      const result = await apiFetch<CommercialContext>(
        `/api/fleet/commercial${siteId ? `?siteId=${siteId}` : ""}`,
        {},
        scope.current,
      );
      if (current()) setData(result);
    } catch (e) {
      if (current()) setError((e as Error).message);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, []);
  const inputStyle = {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 8,
    padding: 10,
    color: colors.text,
  };
  function edit(d?: FleetDestination) {
    setError("");
    setAttempt(null);
    setDraft(
      d
        ? {
            id: d.id,
            name: d.name,
            kind: d.kind,
            address: d.address,
            latitude: String(d.latitude),
            longitude: String(d.longitude),
            materials: d.materials.join(", "),
            hours: d.hours,
            instructions: d.instructions,
            active: d.active,
          }
        : {
            name: "",
            kind: "disposal",
            address: "",
            latitude: "",
            longitude: "",
            materials: "",
            hours: "",
            instructions: "",
            active: true,
          },
    );
  }
  function review() {
    try {
      if (!draft.latitude.trim() || !draft.longitude.trim())
        throw new Error("Enter both coordinates.");
      const destination = {
        ...draft,
        latitude: Number(draft.latitude),
        longitude: Number(draft.longitude),
        materials: draft.materials
          .split(",")
          .map((v: string) => v.trim())
          .filter(Boolean),
      };
      const { id, ...fields } = destination;
      FleetDestinationSchema.omit({
        id: true,
        revision: true,
        ownerType: true,
        ownerId: true,
      }).parse(fields);
      setAttempt({
        operationId: Crypto.randomUUID(),
        expectedVersion: data!.version,
        destination,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function submit(path: string, body: unknown) {
    if (lock.current || !current()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await apiFetch(
        path,
        { method: "POST", body: JSON.stringify(body) },
        scope.current,
      );
      if (current()) {
        setAttempt(null);
        setDraft(null);
        await load();
        onChanged?.();
      }
    } catch (e) {
      if (current()) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.text, fontWeight: "700" }}>
        Destination directory
      </Text>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      <TextInput
        accessibilityLabel="Search destinations"
        placeholder="Search destinations"
        value={search}
        onChangeText={setSearch}
        style={inputStyle}
      />
      {data?.destinations
        .filter((d) =>
          `${d.name} ${d.address} ${d.materials.join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
        .map((d) => (
          <View key={d.id}>
            <Text style={{ color: colors.text }}>
              {d.name} · {d.kind}
              {d.active ? "" : " · Inactive"}
            </Text>
            <Text style={{ color: colors.text }}>
              {d.address} · {d.materials.join(", ")} ·{" "}
              {d.hours || "Hours unconfirmed"} · Capacity unconfirmed
            </Text>
            {data.canManage ? (
              <TogglePillButton compactOnTablet onPress={() => edit(d)}>
                Edit {d.name}
              </TogglePillButton>
            ) : null}
          </View>
        ))}
      {data?.canManage ? (
        <>
          <TogglePillButton compactOnTablet onPress={() => edit()}>
            Add destination
          </TogglePillButton>
          <Text style={{ color: colors.text }}>
            Company default: {data.defaultMode}
          </Text>
          {(["batch", "singles"] as const).map((mode) => (
            <TogglePillButton
              key={mode}
              compactOnTablet
              disabled={busy || data.defaultMode === mode}
              onPress={() =>
                void submit("/api/fleet/commercial/default", {
                  expectedVersion: data.version,
                  mode,
                })
              }
            >
              {mode === "batch" ? "Batch" : "Singles"}
            </TogglePillButton>
          ))}
        </>
      ) : null}
      <Modal
        visible={!!draft}
        transparent
        onRequestClose={() => {
          if (!busy && !attempt) setDraft(null);
        }}
      >
        <View
          style={{ flex: 1, backgroundColor: colors.background, padding: 20 }}
        >
          <ScrollView contentContainerStyle={{ gap: 10 }}>
            {draft ? (
              <>
                <Text style={{ color: colors.text, fontWeight: "700" }}>
                  Reusable destination
                </Text>
                {[
                  "name",
                  "address",
                  "latitude",
                  "longitude",
                  "materials",
                  "hours",
                  "instructions",
                ].map((field) => (
                  <TextInput
                    key={field}
                    accessibilityLabel={field}
                    placeholder={field}
                    value={draft[field]}
                    editable={!attempt && !busy}
                    onChangeText={(value) =>
                      setDraft({ ...draft, [field]: value })
                    }
                    style={inputStyle}
                  />
                ))}
                {["disposal", "delivery", "pickup", "yard"].map((kind) => (
                  <TogglePillButton
                    key={kind}
                    compactOnTablet
                    disabled={!!attempt || busy}
                    onPress={() => setDraft({ ...draft, kind })}
                  >
                    {draft.kind === kind ? "✓ " : ""}
                    {kind}
                  </TogglePillButton>
                ))}
                <TogglePillButton
                  compactOnTablet
                  disabled={!!attempt || busy}
                  onPress={() => setDraft({ ...draft, active: !draft.active })}
                >
                  {draft.active ? "Active" : "Inactive"}
                </TogglePillButton>
                {error ? <Text accessibilityRole="alert">{error}</Text> : null}
                {attempt ? (
                  <>
                    <Text style={{ color: colors.text }}>
                      Confirm {attempt.destination.name} at{" "}
                      {attempt.destination.address},{" "}
                      {attempt.destination.latitude},{" "}
                      {attempt.destination.longitude} ·{" "}
                      {attempt.destination.kind} ·{" "}
                      {attempt.destination.materials.join(", ")} ·{" "}
                      {attempt.destination.hours} ·{" "}
                      {attempt.destination.instructions}
                    </Text>
                    <TogglePillButton
                      compactOnTablet
                      disabled={busy}
                      onPress={() =>
                        void submit("/api/fleet/destinations", attempt)
                      }
                    >
                      Confirm destination
                    </TogglePillButton>
                  </>
                ) : (
                  <TogglePillButton compactOnTablet onPress={review}>
                    Review destination
                  </TogglePillButton>
                )}
                <TogglePillButton
                  compactOnTablet
                  disabled={busy || !!attempt}
                  onPress={() => setDraft(null)}
                >
                  Cancel
                </TogglePillButton>
              </>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
