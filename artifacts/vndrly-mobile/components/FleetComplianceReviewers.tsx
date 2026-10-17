import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import {
  FleetComplianceConfigurationViewSchema,
  FleetComplianceReviewerSaveSchema,
  type FleetSetup,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import FleetCheckbox from "./FleetCheckbox";
import TogglePillButton from "./TogglePillButton";
type Config = z.infer<typeof FleetComplianceConfigurationViewSchema>;
type Attempt = z.infer<typeof FleetComplianceReviewerSaveSchema>;
type Props = { onChanged: () => void };
export default function FleetComplianceReviewers(props: Props) {
  return <ReviewerForm key={captureAuthScope().generation} {...props} />;
}
function ReviewerForm({ onChanged }: Props) {
  const [refresh, setRefresh] = useState(0);
  const copy = useFleetCopy(),
    colors = useColors(),
    scope = useRef(captureAuthScope()),
    alive = useRef(true),
    request = useRef<Attempt | null>(null),
    lock = useRef(false);
  const [config, setConfig] = useState<Config | null>(null),
    [members, setMembers] = useState<FleetSetup["members"] | null>(null),
    [selected, setSelected] = useState<number[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [prepared, setPrepared] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  const configuration = async () =>
    FleetComplianceConfigurationViewSchema.parse(
      await apiFetch<unknown>(
        "/api/fleet/compliance/configuration",
        {},
        scope.current,
      ),
    );
  useEffect(() => {
    alive.current = true;
    setError("");
    void configuration()
      .then((value) => {
        if (current()) {
          setConfig(value);
          setSelected(value.reviewerUserIds);
        }
      })
      .catch(() => undefined);
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  async function open() {
    if (busy || !current()) return;
    setBusy(true);
    setError("");
    try {
      const directory = await apiFetch<FleetSetup>(
        "/api/fleet/setup",
        {},
        scope.current,
      );
      if (current()) setMembers(directory.members);
    } catch {
      if (current())
        setError("Company members unavailable. Reload before changing access.");
    } finally {
      if (current()) setBusy(false);
    }
  }
  function prepare() {
    if (!config || !current()) return;
    try {
      request.current = FleetComplianceReviewerSaveSchema.parse({
        operationId: Crypto.randomUUID(),
        expectedVersion: config.version,
        reviewerUserIds: selected,
      });
      setPrepared(true);
      setError("");
    } catch {
      setError("Review the selected members.");
    }
  }
  async function save() {
    if (!request.current || lock.current || !current()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt = FleetComplianceConfigurationViewSchema.pick({
          version: true,
          reviewerUserIds: true,
        }).parse(
          await apiFetch<unknown>(
            "/api/fleet/compliance/reviewers",
            { method: "POST", body: JSON.stringify(request.current) },
            scope.current,
          ),
        ),
        updated = await configuration();
      if (!current()) return;
      const same = (a: number[], b: number[]) =>
        JSON.stringify([...a].sort((x, y) => x - y)) ===
        JSON.stringify([...b].sort((x, y) => x - y));
      if (
        !updated.mayAppointReviewers ||
        updated.version < receipt.version ||
        !same(receipt.reviewerUserIds, request.current.reviewerUserIds) ||
        !same(updated.reviewerUserIds, receipt.reviewerUserIds)
      ) {
        request.current = null;
        setMembers(null);
        setPrepared(false);
        setConfig(null);
        setError(
          "Reviewer access changed again. Reload the current configuration.",
        );
        return;
      }
      request.current = null;
      setConfig(updated);
      setSelected(updated.reviewerUserIds);
      setMembers(null);
      setPrepared(false);
      setUncertain(false);
      onChanged();
    } catch (cause) {
      if (current()) {
        const status = (cause as { status?: number }).status;
        if (status && status >= 400 && status < 500) {
          request.current = null;
          setMembers(null);
          setPrepared(false);
          setConfig(null);
          setError(
            "Configuration or permissions changed. Reload before trying again.",
          );
        } else {
          setUncertain(true);
          setError(
            "Reviewer access needs verification. Retry the same change.",
          );
        }
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  if (
    !isAuthScopeCurrent(scope.current) ||
    (!config?.mayAppointReviewers && !error)
  )
    return null;
  const directory = members
      ? [
          ...new Map(
            [
              ...members,
              ...selected
                .filter((id) => !members.some((member) => member.userId === id))
                .map((userId) => ({
                  userId,
                  name: `${copy("Former member")} #${userId}`,
                })),
            ].map((member) => [member.userId, member]),
          ).values(),
        ]
      : [],
    text = { color: colors.text };
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderColor: colors.primary,
        borderWidth: 2,
        borderRadius: 12,
        padding: 16,
        gap: 12,
      }}
    >
      <Text style={[text, { fontSize: 18, fontWeight: "700" }]}>
        {copy("Evidence reviewers")}
      </Text>
      <Text style={text}>
        {copy(
          "Appointed reviewers can read and review full licenses and private medical, testing and coverage records. Dispatch and finance keep their separate permissions.",
        )}
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {copy(error)}
        </Text>
      )}
      {!config && !!error && (
        <TogglePillButton
          disabled={busy}
          onPress={() => setRefresh((value) => value + 1)}
        >
          {copy("Reload reviewer access")}
        </TogglePillButton>
      )}
      {config?.mayAppointReviewers && !members && (
        <TogglePillButton disabled={busy} onPress={() => void open()}>
          {copy("Change evidence reviewers")}
        </TogglePillButton>
      )}
      {members && (
        <>
          {directory.map((member) => (
            <FleetCheckbox
              key={member.userId}
              label={member.name}
              disabled={busy || prepared}
              checked={selected.includes(member.userId)}
              onChange={(checked) =>
                setSelected((prior) =>
                  checked
                    ? [...new Set([...prior, member.userId])]
                    : prior.filter((id) => id !== member.userId),
                )
              }
            />
          ))}
          {prepared ? (
            <>
              <Text style={text}>
                {copy(
                  "Review these private-evidence permissions before saving.",
                )}
              </Text>
              <TogglePillButton disabled={busy} onPress={() => void save()}>
                {copy(
                  uncertain
                    ? "Retry the same reviewer change"
                    : "Save reviewer access",
                )}
              </TogglePillButton>
              {!uncertain && (
                <TogglePillButton
                  disabled={busy}
                  onPress={() => {
                    request.current = null;
                    setPrepared(false);
                  }}
                >
                  {copy("Edit reviewer selection")}
                </TogglePillButton>
              )}
            </>
          ) : (
            <TogglePillButton disabled={busy} onPress={prepare}>
              {copy("Review reviewer access")}
            </TogglePillButton>
          )}
        </>
      )}
    </View>
  );
}
