import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import {
  FleetComplianceRegisterPageSchema,
  type FleetComplianceSubject,
  type FleetComplianceOperationalEntry,
} from "@workspace/api-zod";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import TogglePillButton from "./TogglePillButton";
import FleetChoiceField from "./FleetChoiceField";
import FleetEvidenceReview from "./FleetEvidenceReview";
import FleetComplianceReviewers from "./FleetComplianceReviewers";
import FleetComplianceFacts from "./FleetComplianceFacts";
import FleetComplianceRules from "./FleetComplianceRules";
import FleetComplianceIntake from "./FleetComplianceIntake";

export default function FleetComplianceRegister({companyId}:{companyId?:number}={}) {
  const [rulesOpen,setRulesOpen]=useState(false);
  const [intakeOpen,setIntakeOpen]=useState(false);
  const [renewSource,setRenewSource]=useState<{id:string;revision:number}|undefined>();
  const [factsSubject,setFactsSubject]=useState<FleetComplianceSubject|null>(null);
  const [selected,setSelected]=useState<{id:string;revision:number}|null>(null);
  const copy = useFleetCopy(),
    colors = useColors(),
    scope = useRef(captureAuthScope()),
    alive = useRef(true),
    generation = useRef(0),
    busy = useRef(false);
  const [kind, setKind] = useState<"" | FleetComplianceSubject["kind"]>(""),
    [refresh, setRefresh] = useState(0),
    [entries, setEntries] = useState<FleetComplianceOperationalEntry[]>([]),
    [after, setAfter] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  const labels = {
    carrier: "Carrier & insurance",
    vehicle: "Vehicles",
    component: "Components & tanks",
    driver: "Drivers",
    trip: "Trip documents",
  };
  const statuses = {
    document_received: "Document received",
    reviewed: "Reviewed",
    verified: "Verified",
    revoked: "Revoked",
    failed: "Failed",
  };
  async function load(more = false) {
    if (busy.current || !current()) return;
    busy.current = true;
    setLoading(true);
    setError("");
    const request = generation.current;
    try {
      const params = new URLSearchParams();
      if (kind) params.set("subjectKind", kind);
      if (more && after) params.set("after", after);
      const page = FleetComplianceRegisterPageSchema.parse(
        await apiFetch<unknown>(
          `/api/fleet/compliance?${params}`,
          {},
          scope.current,
        ),
      );
      if (!current() || request !== generation.current) return;
      setEntries((prior) =>
        more
          ? [
              ...new Map(
                [...prior, ...page.entries].map((entry) => [entry.id, entry]),
              ).values(),
            ]
          : page.entries,
      );
      setAfter(page.nextCursor);
    } catch {
      if (current() && request === generation.current) {
        setEntries([]);
        setAfter(null);
        setError("Registers unavailable. Refresh to check access.");
      }
    } finally {
      if (current() && request === generation.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    generation.current++;
    busy.current = false;
    setEntries([]);
    setSelected(null);
    setFactsSubject(null);
    setAfter(null);
    void load();
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, [kind, refresh]);
  const text = { color: colors.text },
    card = {
      borderWidth: 2,
      borderColor: colors.primary,
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      gap: 8,
    };
  if (!isAuthScopeCurrent(scope.current)) return null;
  return (
    <View style={{ gap: 14 }}>
      <Text style={[text, { fontSize: 20, fontWeight: "700" }]}>
        {copy("Compliance registers")}
      </Text>
      <FleetComplianceReviewers onChanged={()=>{setIntakeOpen(false);setRulesOpen(false);setSelected(null);setFactsSubject(null);setRefresh(value=>value+1);}}/>
      <TogglePillButton onPress={()=>{setRenewSource(undefined);setIntakeOpen(true);setSelected(null);setFactsSubject(null);setRulesOpen(false);}}>{copy("Receive evidence")}</TogglePillButton>
      <TogglePillButton onPress={()=>{setIntakeOpen(false);setSelected(null);setFactsSubject(null);setRulesOpen(true);}}>{copy("Requirements and history")}</TogglePillButton>
      {typeof companyId==="number"&&Number.isInteger(companyId)&&companyId>0&&<TogglePillButton onPress={()=>{setIntakeOpen(false);setRulesOpen(false);setSelected(null);setFactsSubject({kind:"carrier",id:companyId});}}>{copy("Carrier applicability")}</TogglePillButton>}
      <View style={card}>
        <Text style={text}>
          {copy(
            "Compliance warnings do not block work or tickets. Evidence status is separate from availability and run-specific coverage.",
          )}
        </Text>
        <Text style={text}>
          {copy(
            "Private documents are restricted to appointed reviewers. Receiving a document does not verify it.",
          )}
        </Text>
      </View>
      <FleetChoiceField
        label={copy("Register")}
        value={kind}
        options={[
          { id: "", label: copy("All authorized registers") },
          ...Object.entries(labels).map(([id, label]) => ({
            id,
            label: copy(label),
          })),
        ]}
        onChange={(value) => {setIntakeOpen(false);setRulesOpen(false);setKind(value as typeof kind);}}
      />
      <TogglePillButton
        disabled={loading}
        onPress={() => {setIntakeOpen(false);setRulesOpen(false);setRefresh((value) => value + 1);}}
      >
        {copy("Refresh compliance")}
      </TogglePillButton>
      {loading && <Text style={text}>{copy("Loading registers…")}</Text>}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {copy(error)}
        </Text>
      )}
      {!loading && !error && !entries.length && (
        <Text style={text}>
          {copy(
            "No evidence recorded in this view. This does not establish compliance.",
          )}
        </Text>
      )}
      {intakeOpen&&!error&&<FleetComplianceIntake existing={renewSource} onClose={()=>setIntakeOpen(false)} onSaved={()=>{setIntakeOpen(false);setRefresh(value=>value+1);}}/>}
      {rulesOpen&&!error&&<FleetComplianceRules onClose={()=>setRulesOpen(false)} onSaved={()=>setRefresh(value=>value+1)}/>}
      {selected&&!error&&<FleetEvidenceReview evidenceId={selected.id} revision={selected.revision} onClose={()=>setSelected(null)} onSaved={()=>{setSelected(null);setRefresh(value=>value+1);}}/>}
      {factsSubject&&!error&&<FleetComplianceFacts subject={factsSubject} onClose={()=>setFactsSubject(null)} onSaved={()=>{setFactsSubject(null);setRefresh(value=>value+1);}}/>}
      {entries.map((entry) => (
        <View key={entry.id} style={card}>
          <Text style={[text, { fontWeight: "700" }]}>
            {copy(labels[entry.subject.kind])} · {String(entry.subject.id)}
          </Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Text
              accessibilityElementsHidden
              style={{
                color: entry.status === "green" ? "#15803D" : "#DC2626",
              }}
            >
              ●
            </Text>
            <Text style={text}>
              {copy(
                entry.status === "green"
                  ? "Configured evidence current"
                  : "Needs review",
              )}
            </Text>
          </View>
          <Text style={text}>{copy(statuses[entry.verification])}</Text>
          {!!entry.maskedIdentifier && (
            <Text style={text}>{entry.maskedIdentifier}</Text>
          )}
          <Text style={text}>
            {entry.requirementId} · {copy("Revision")} {entry.revision}
          </Text>
          {entry.reasons.map((reason) => (
            <Text key={reason} style={text}>
              {copy(reason)}
            </Text>
          ))}
          <Text style={text}>
            {copy("Expires")}:{" "}
            {entry.validUntil
              ? new Date(entry.validUntil).toLocaleString()
              : copy("No reviewed expiry")}
          </Text>
          <Text style={text}>
            {copy("Evaluated")}: {new Date(entry.evaluatedAt).toLocaleString()}
          </Text>
          <TogglePillButton onPress={()=>{setRenewSource({id:entry.id,revision:entry.revision});setIntakeOpen(true);setSelected(null);setRulesOpen(false);setFactsSubject(null);}}>{copy("Renew / correct source")}</TogglePillButton>
          {entry.mayReview&&<TogglePillButton onPress={()=>{setIntakeOpen(false);setRulesOpen(false);setFactsSubject(null);setSelected({id:entry.id,revision:entry.revision});}}>{copy("Review evidence")}</TogglePillButton>}
          <TogglePillButton onPress={()=>{setIntakeOpen(false);setRulesOpen(false);setSelected(null);setFactsSubject(entry.subject);}}>{copy("Applicability facts")}</TogglePillButton>
        </View>
      ))}
      {!!after && !error && (
        <TogglePillButton disabled={loading} onPress={() => void load(true)}>
          {copy("Load more evidence")}
        </TogglePillButton>
      )}
    </View>
  );
}
