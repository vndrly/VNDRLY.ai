import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import {
  FleetComplianceFactsSchema,
  FleetComplianceFactsSaveSchema,
  FleetComplianceFactsViewSchema,
  FleetComplianceRequirementsViewSchema,
  fleetComplianceSubjectKey,
  type FleetComplianceSubject,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import FleetChoiceField from "./FleetChoiceField";
import FleetCheckbox from "./FleetCheckbox";
import TogglePillButton from "./TogglePillButton";
type Facts = z.infer<typeof FleetComplianceFactsSchema>;
type Attempt = z.infer<typeof FleetComplianceFactsSaveSchema>;
type Props = {
  subject: FleetComplianceSubject;
  onSaved: () => void;
  onClose: () => void;
};
export default function FleetComplianceFacts(props: Props) {
  return (
    <FactsForm
      key={`${captureAuthScope().generation}:${fleetComplianceSubjectKey(props.subject)}`}
      {...props}
    />
  );
}
function FactsForm({ subject, onSaved, onClose }: Props) {
  const copy = useFleetCopy(),
    colors = useColors(),
    scope = useRef(captureAuthScope()),
    alive = useRef(true),
    attempt = useRef<Attempt | null>(null),
    lock = useRef(false);
  const [facts, setFacts] = useState<Facts>({}),
    [version, setVersion] = useState(0),
    [ready, setReady] = useState(false),
    [canEdit, setCanEdit] = useState(false),
    [prepared, setPrepared] = useState(false),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(""),
    [kind, setKind] = useState(""),
    [reference, setReference] = useState(""),
    [url, setUrl] = useState(""),
    [reviewed, setReviewed] = useState(false);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  const readFacts = async (revision?: number) =>
    FleetComplianceFactsViewSchema.nullable().parse(
      await apiFetch<unknown>(
        `/api/fleet/compliance/facts/${subject.kind}/${subject.id}${revision === undefined ? "" : `?revision=${revision}`}`,
        {},
        scope.current,
      ),
    );
  useEffect(() => {
    alive.current = true;
    void Promise.all([
      readFacts(),
      apiFetch<unknown>(
        "/api/fleet/compliance/requirements",
        {},
        scope.current,
      ),
    ])
      .then(([saved, rawRules]) => {
        if (!current()) return;
        const rules = FleetComplianceRequirementsViewSchema.parse(rawRules);
        if (
          saved &&
          fleetComplianceSubjectKey(saved.subject) !==
            fleetComplianceSubjectKey(subject)
        )
          throw new Error("Subject changed");
        setFacts(saved?.facts ?? {});
        setVersion(saved?.version ?? 0);
        setCanEdit(rules.canAdopt);
        setReady(true);
      })
      .catch(() => {
        if (current())
          setError(
            "Applicability facts are unavailable under your current access.",
          );
      });
    return () => {
      alive.current = false;
    };
  }, []);
  const booleanFields = [
    ["interstate", "Interstate commerce"],
    ["forHire", "For-hire operation"],
    ["cmv", "Commercial motor vehicle"],
    ["cdlRequired", "CDL required for this work"],
    ["medicalRequired", "Medical certification required"],
    ["testingRequired", "Testing program required"],
    ["hoursRulesApply", "Hours rules apply"],
    ["tankRequired", "Tank applicability"],
    ["placarded", "Hazardous-material placards required"],
  ] as const;
  const numberFields = [
    ["gvwrLb", "Gross vehicle weight rating (lb)"],
    ["gcwrLb", "Gross combination weight rating (lb)"],
    ["trailerGvwrLb", "Trailer weight rating (lb)"],
    ["passengers", "Passenger capacity"],
  ] as const;
  const textFields = [
    ["state", "State in this assessment"],
    ["cargoCode", "Reviewed cargo classification"],
    ["hazmatClass", "Reviewed hazardous-material class"],
  ] as const;
  const sourceLabels = {
    government_registry: "Government registry",
    qualified_examiner: "Qualified examiner",
    insurer_confirmation: "Insurer confirmation",
    qualified_reviewer: "Designated reviewer",
    employer_record: "Employer record",
    ELD_record: "ELD record",
  };
  function prepare() {
    if (!ready || !canEdit || busy || !current()) return;
    try {
      if (!reviewed) throw new Error("Source review required");
      attempt.current = FleetComplianceFactsSaveSchema.parse({
        operationId: Crypto.randomUUID(),
        expectedVersion: version,
        subject,
        facts,
        source: { kind, reference, url: url.trim() || null },
      });
      setPrepared(true);
      setError("");
    } catch {
      setError(
        "Review the values and confirm a referenced source. Blank fields remain unknown.",
      );
    }
  }
  async function save() {
    if (!attempt.current || lock.current || !current()) return;
    const body = attempt.current;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const raw = await apiFetch<{ version: number }>(
        "/api/fleet/compliance/facts",
        { method: "POST", body: JSON.stringify(body) },
        scope.current,
      );
      if (raw.version !== body.expectedVersion + 1)
        throw new Error("Unexpected revision");
      const saved = FleetComplianceFactsViewSchema.parse(
        await readFacts(raw.version),
      );
      if (
        fleetComplianceSubjectKey(saved.subject) !==
          fleetComplianceSubjectKey(subject) ||
        saved.version !== raw.version ||
        saved.sourceKind !== body.source.kind ||
        JSON.stringify(saved.facts) !== JSON.stringify(body.facts)
      )
        throw new Error("Fact revision needs verification");
      if (current()) {
        attempt.current = null;
        setPrepared(false);
        setUncertain(false);
        onSaved();
      }
    } catch (cause) {
      if (current()) {
        const status = (cause as { status?: number }).status;
        if (status && status >= 400 && status < 500) {
          attempt.current = null;
          setReady(false);
          setCanEdit(false);
          setError(
            "Facts or permissions changed. Close and reload before editing.",
          );
        } else {
          setUncertain(true);
          setError(
            "Applicability save needs verification. Retry the same facts.",
          );
        }
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  const text = { color: colors.text },
    field = {
      color: colors.text,
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 8,
      padding: 12,
    },
    disabled = !canEdit || prepared || busy;
  if (!isAuthScopeCurrent(scope.current)) return null;
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
        {copy("Applicability facts")}
      </Text>
      <Text style={text}>
        {copy(
          "Unknown does not mean a requirement is inapplicable. These operational facts exclude private clinical and test results.",
        )}
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {copy(error)}
        </Text>
      )}
      {ready && (
        <>
          {booleanFields.map(([key, label]) => (
            <FleetChoiceField
              key={key}
              label={copy(label)}
              value={
                facts[key] === true ? "yes" : facts[key] === false ? "no" : ""
              }
              disabled={disabled}
              options={[
                { id: "", label: copy("Unknown") },
                { id: "yes", label: copy("Yes") },
                { id: "no", label: copy("No") },
              ]}
              onChange={(value) =>
                setFacts((prior) => ({
                  ...prior,
                  [key]: value === "" ? null : value === "yes",
                }))
              }
            />
          ))}
          {numberFields.map(([key, label]) => (
            <View key={key}>
              <Text style={text}>{copy(label)}</Text>
              <TextInput
                style={field}
                accessibilityLabel={copy(label)}
                keyboardType="numeric"
                editable={!disabled}
                value={
                  facts[key] === null || facts[key] === undefined
                    ? ""
                    : String(facts[key])
                }
                onChangeText={(value) =>
                  setFacts((prior) => ({
                    ...prior,
                    [key]: value.trim() === "" ? null : Number(value),
                  }))
                }
              />
            </View>
          ))}
          {textFields.map(([key, label]) => (
            <View key={key}>
              <Text style={text}>{copy(label)}</Text>
              <TextInput
                style={field}
                accessibilityLabel={copy(label)}
                editable={!disabled}
                value={facts[key] ?? ""}
                maxLength={key === "state" ? 2 : 500}
                onChangeText={(value) =>
                  setFacts((prior) => ({
                    ...prior,
                    [key]: value.trim()
                      ? key === "state"
                        ? value.toUpperCase()
                        : value
                      : null,
                  }))
                }
              />
            </View>
          ))}
          {canEdit && (
            <>
              <FleetChoiceField
                label={copy("Verification source")}
                value={kind}
                disabled={prepared || busy}
                options={Object.entries(sourceLabels).map(([id, label]) => ({
                  id,
                  label: copy(label),
                }))}
                onChange={setKind}
              />
              <TextInput
                style={field}
                accessibilityLabel={copy("Source reference")}
                placeholder={copy("Source reference")}
                value={reference}
                onChangeText={setReference}
                editable={!prepared && !busy}
                maxLength={500}
              />
              <TextInput
                style={field}
                accessibilityLabel={copy("Source link (optional)")}
                placeholder={copy("Source link (optional)")}
                value={url}
                onChangeText={setUrl}
                editable={!prepared && !busy}
                autoCapitalize="none"
                keyboardType="url"
              />
              <FleetCheckbox
                label={copy("I reviewed these facts against this source")}
                checked={reviewed}
                disabled={prepared || busy}
                onChange={setReviewed}
              />
              {prepared ? (
                <>
                  <TogglePillButton disabled={busy} onPress={() => void save()}>
                    {copy(
                      uncertain
                        ? "Retry the same applicability facts"
                        : "Save applicability facts",
                    )}
                  </TogglePillButton>
                  {!uncertain && (
                    <TogglePillButton
                      disabled={busy}
                      onPress={() => {
                        attempt.current = null;
                        setPrepared(false);
                      }}
                    >
                      {copy("Edit facts")}
                    </TogglePillButton>
                  )}
                </>
              ) : (
                <TogglePillButton disabled={busy} onPress={prepare}>
                  {copy("Prepare applicability facts")}
                </TogglePillButton>
              )}
            </>
          )}
        </>
      )}
      <TogglePillButton disabled={busy} onPress={onClose}>
        {copy("Close applicability facts")}
      </TogglePillButton>
    </View>
  );
}
