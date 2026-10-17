import React, { useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import {
  FleetDetailSchema,
  FleetRigPackageSchema,
  type FleetDetail,
  type FleetResources,
  type FleetRigPackage,
} from "@workspace/api-zod";
import { useColors } from "@/hooks/useColors";
import TogglePillButton from "./TogglePillButton";
import FleetChoiceField from "./FleetChoiceField";
import FleetCheckbox from "./FleetCheckbox";
import {useFleetCopy} from "@/lib/fleet-copy";
type Save = {
  operationId: string;
  expectedVersion: number;
  detail: FleetDetail;
};
export function FleetDetailBuilder({
  companyId,
  accessGroupIds,
  resources,
  rigPackages,
  initialDetail,
  assessments = {},
  onSave,
}: {
  companyId: number;
  accessGroupIds: string[];
  resources: FleetResources;
  rigPackages: FleetRigPackage[];
  initialDetail?: FleetDetail;
  assessments?: Record<string, { status: "green" | "red"; label: string }>;
  onSave: (input: Save) => Promise<unknown>;
}) {
  const copy=useFleetCopy();
  const colors = useColors(),
    lock = useRef(false);
  const [name, setName] = useState(initialDetail?.name ?? ""),
    [truck, setTruck] = useState(initialDetail?.vehicleAssetId ?? ""),
    [rig, setRig] = useState(initialDetail?.rigPackageId ?? ""),
    [driver, setDriver] = useState(String(initialDetail?.driverUserId ?? "")),
    [attempt, setAttempt] = useState<Save | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const trucks = resources.equipment.filter(
      (item) =>
        ["truck", "vehicle"].includes(item.category) &&
        !["retired", "merged"].includes(item.status),
    ),
    packages = rigPackages.filter((item) => !item.archivedAt),
    chosen = packages.find((item) => item.id === rig);
  const text = { color: colors.text },
    input = {
      color: colors.text,
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 8,
      padding: 12,
    };
  function review() {
    try {
      if (
        !trucks.some((item) => item.id === truck) ||
        !resources.drivers.some((item) => item.userId === Number(driver)) ||
        (rig && !chosen) ||
        !accessGroupIds.length
      )
        throw new Error("Choose an authorized truck, optional rig and driver.");
      const detail = FleetDetailSchema.parse({
        ...initialDetail,
        id: initialDetail?.id ?? Crypto.randomUUID(),
        companyId,
        version: (initialDetail?.version ?? 0) + 1,
        name,
        vehicleAssetId: truck,
        rigPackageId: chosen?.id ?? null,
        rigPackageVersion: chosen?.version ?? null,
        driverUserId: Number(driver),
        accessGroupIds,
        effectiveFrom: initialDetail?.effectiveFrom ?? new Date().toISOString(),
        effectiveUntil: initialDetail?.effectiveUntil ?? null,
        archivedAt: null,
      });
      setAttempt({
        operationId: Crypto.randomUUID(),
        expectedVersion: initialDetail?.version ?? 0,
        detail,
      });
      setMessage("");
    } catch {
      setMessage(
        "Enter a name and choose an authorized truck, optional rig and driver.",
      );
    }
  }
  async function save() {
    if (!attempt || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await onSave(attempt);
      setAttempt(null);
      setMessage("Detail saved. Inventory custody is unchanged.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save. Retry the same request.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderWidth: 2,
        borderColor: colors.primary,
        borderRadius: 12,
        padding: 16,
        gap: 14,
      }}
    >
      <Text style={[text, { fontSize: 20, fontWeight: "700" }]}>
        {initialDetail ? "Edit Detail" : "Build a Detail"}
      </Text>
      <Text style={text}>
        A reusable truck, optional rig package and driver. Run reservations and
        Inventory custody stay separate.
      </Text>
      <TextInput
        accessibilityLabel="Detail name"
        placeholder="Detail name"
        value={name}
        onChangeText={setName}
        editable={!attempt && !busy}
        style={input}
      />
      <FleetChoiceField
        label="Available Trucks"
        value={truck}
        options={trucks.map((item) => ({ id: item.id, label: item.name }))}
        onChange={setTruck}
        disabled={busy || Boolean(attempt)}
      />
      <FleetChoiceField
        label="Available Rig"
        value={rig}
        options={[
          { id: "", label: "No towed package" },
          ...packages.map((item) => ({ id: item.id, label: item.name })),
        ]}
        onChange={setRig}
        disabled={busy || Boolean(attempt)}
      />
      <FleetChoiceField
        label="Driver"
        value={driver}
        options={resources.drivers.map((item) => ({
          id: String(item.userId),
          label: item.name,
        }))}
        onChange={setDriver}
        disabled={busy || Boolean(attempt)}
      />
      <Text style={text}>
        Evidence status is separate from availability and run-specific coverage.
        Document warnings remain selectable; current holds, custody and
        availability are checked at assignment.
      </Text>
      {[
        {
          id: `vehicle:${truck}`,
          label: trucks.find((item) => item.id === truck)?.name,
        },
        ...(chosen?.components.map((component) => ({
          id: `component:${component.assetId}`,
          label:
            resources.equipment.find((asset) => asset.id === component.assetId)
              ?.name ?? component.role,
        })) ?? []),
        {
          id: `driver:${driver}`,
          label: resources.drivers.find(
            (item) => String(item.userId) === driver,
          )?.name,
        },
      ]
        .filter((item) => item.label)
        .map((item) => (
          <View key={item.id} style={{ flexDirection: "row", gap: 6 }}>
            <Text
              accessibilityElementsHidden
              style={{
                color:
                  assessments[item.id]?.status === "green"
                    ? "#15803D"
                    : "#DC2626",
              }}
            >
              ●
            </Text>
            <Text style={text}>
              {item.label} ·{" "}
            {assessments[item.id]?.label ?? copy("Compliance unverified")}
            </Text>
          </View>
        ))}
      {message && (
        <Text accessibilityRole="alert" style={text}>
          {message}
        </Text>
      )}
      {attempt ? (
        <>
          <Text style={text}>
            Review {attempt.detail.name} ·{" "}
            {trucks.find((item) => item.id === truck)?.name} ·{" "}
            {chosen?.name ?? "No towed package"} ·{" "}
            {
              resources.drivers.find((item) => item.userId === Number(driver))
                ?.name
            }
          </Text>
          <TogglePillButton disabled={busy} onPress={() => void save()}>
            Save Detail
          </TogglePillButton>
          <TogglePillButton disabled={busy} onPress={() => setAttempt(null)}>
            Edit selection
          </TogglePillButton>
        </>
      ) : (
        <TogglePillButton onPress={review}>Review Detail</TogglePillButton>
      )}
    </View>
  );
}
export function FleetRigPackageBuilder({
  companyId,
  equipment,
  initialPackage,
  onSave,
}: {
  companyId: number;
  equipment: FleetResources["equipment"];
  initialPackage?: FleetRigPackage;
  onSave: (input: {
    operationId: string;
    expectedVersion: number;
    package: FleetRigPackage;
  }) => Promise<unknown>;
}) {
  const colors = useColors(),
    lock = useRef(false),
    text = { color: colors.text };
  const [name, setName] = useState(initialPackage?.name ?? ""),
    [components, setComponents] = useState<FleetRigPackage["components"]>(
      initialPackage?.components ?? [],
    ),
    [attempt, setAttempt] = useState<{
      operationId: string;
      expectedVersion: number;
      package: FleetRigPackage;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const roles = ["trailer", "dolly", "tank", "pump", "accessory"] as const;
  function review() {
    try {
      setAttempt({
        operationId: Crypto.randomUUID(),
        expectedVersion: initialPackage?.version ?? 0,
        package: FleetRigPackageSchema.parse({
          ...initialPackage,
          id: initialPackage?.id ?? Crypto.randomUUID(),
          companyId,
          version: (initialPackage?.version ?? 0) + 1,
          name,
          components: components.map((item, sequence) => ({
            ...item,
            sequence,
          })),
          effectiveFrom:
            initialPackage?.effectiveFrom ?? new Date().toISOString(),
          effectiveUntil: initialPackage?.effectiveUntil ?? null,
          archivedAt: null,
        }),
      });
      setMessage("");
    } catch {
      setMessage("Enter a package name and choose at least one component.");
    }
  }
  async function save() {
    if (!attempt || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await onSave(attempt);
      setAttempt(null);
      setMessage("Rig package saved.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save. Retry the same request.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <View
      style={{
        borderWidth: 2,
        borderColor: colors.primary,
        borderRadius: 12,
        backgroundColor: colors.card,
        padding: 16,
        gap: 14,
      }}
    >
      <Text style={[text, { fontSize: 20, fontWeight: "700" }]}>
        {initialPackage ? "Edit rig package" : "Build a rig package"}
      </Text>
      <Text style={text}>
        Choose components in coupling order. Cargo is recorded separately on the
        run.
      </Text>
      <TextInput
        accessibilityLabel="Rig package name"
        placeholder="Rig package name"
        value={name}
        onChangeText={setName}
        editable={!busy && !attempt}
        style={{
          color: colors.text,
          borderWidth: 2,
          borderColor: colors.primary,
          borderRadius: 8,
          padding: 12,
        }}
      />
      {equipment
        .filter((item) => !["vehicle", "truck"].includes(item.category))
        .map((item) => {
          const component = components.find((row) => row.assetId === item.id);
          return (
            <View key={item.id} style={{ gap: 10 }}>
              <FleetCheckbox
                label={item.name}
                checked={Boolean(component)}
                disabled={busy || Boolean(attempt)}
                onChange={(checked) =>
                  setComponents(
                    checked
                      ? [
                          ...components,
                          {
                            assetId: item.id,
                            role: roles.includes(
                              item.category as (typeof roles)[number],
                            )
                              ? (item.category as (typeof roles)[number])
                              : "accessory",
                            sequence: components.length,
                          },
                        ]
                      : components.filter((row) => row.assetId !== item.id),
                  )
                }
              />
              {component && (
                <FleetChoiceField
                  label={`Role for ${item.name}`}
                  value={component.role}
                  disabled={busy || Boolean(attempt)}
                  options={roles.map((role) => ({ id: role, label: role }))}
                  onChange={(role) =>
                    setComponents(
                      components.map((row) =>
                        row.assetId === item.id
                          ? { ...row, role: role as (typeof roles)[number] }
                          : row,
                      ),
                    )
                  }
                />
              )}
            </View>
          );
        })}
      <Text style={text}>
        {components
          .map(
            (item, index) =>
              `${index + 1}. ${equipment.find((asset) => asset.id === item.assetId)?.name ?? item.role}`,
          )
          .join(" → ")}
      </Text>
      {message && (
        <Text accessibilityRole="alert" style={text}>
          {message}
        </Text>
      )}
      {attempt ? (
        <>
          <TogglePillButton disabled={busy} onPress={() => void save()}>
            Save rig package
          </TogglePillButton>
          <TogglePillButton disabled={busy} onPress={() => setAttempt(null)}>
            Edit selection
          </TogglePillButton>
        </>
      ) : (
        <TogglePillButton onPress={review}>Review rig package</TogglePillButton>
      )}
    </View>
  );
}
