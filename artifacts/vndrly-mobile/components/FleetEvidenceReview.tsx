import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import {
  FleetComplianceRecordSchema,
  FleetComplianceVerifySchema,
  FleetComplianceRecordReceiptSchema,
  type FleetComplianceRecord,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import TogglePillButton from "./TogglePillButton";
import FleetChoiceField from "./FleetChoiceField";
import FleetCheckbox from "./FleetCheckbox";
type Attempt = z.infer<typeof FleetComplianceVerifySchema>;
type Props = {
  evidenceId: string;
  revision: number;
  onSaved: () => void;
  onClose: () => void;
};
export default function FleetEvidenceReview(props: Props) {
  return (
    <EvidenceReviewForm
      key={`${captureAuthScope().generation}:${props.evidenceId}:${props.revision}`}
      {...props}
    />
  );
}
function EvidenceReviewForm({ evidenceId, revision, onSaved, onClose }: Props) {
  const copy = useFleetCopy(),
    colors = useColors(),
    scope = useRef(captureAuthScope()),
    alive = useRef(true),
    request = useRef<Attempt | null>(null),
    lock = useRef(false);
  const [record, setRecord] = useState<FleetComplianceRecord | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [prepared, setPrepared] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [decision, setDecision] = useState<Attempt["decision"]>("reviewed"),
    [sourceKind, setSourceKind] = useState(""),
    [reference, setReference] = useState(""),
    [url, setUrl] = useState(""),
    [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [scopesReviewed,setScopesReviewed]=useState(false),[followFormReviewed,setFollowFormReviewed]=useState(false),
    [filingStatus,setFilingStatus]=useState<NonNullable<Attempt["coverageReview"]>["filingStatus"]>("unverified"),
    [filingKind,setFilingKind]=useState(""),[filingReference,setFilingReference]=useState(""),[filingURL,setFilingURL]=useState("");
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  const privateRead = async (nextRevision: number) =>
    FleetComplianceRecordSchema.parse(
      await apiFetch<unknown>(
        `/api/fleet/compliance/${evidenceId}/private?revision=${nextRevision}`,
        {},
        scope.current,
      ),
    );
  useEffect(() => {
    alive.current = true;
    void privateRead(revision)
      .then((value) => {
        if (!current()) return;
        if (
          value.evidence.id !== evidenceId ||
          value.evidence.revision !== revision
        )
          throw new Error("Evidence changed.");
        setRecord(value);
      })
      .catch(() => {
        if (current())
          setError(
            "Private evidence is unavailable under your current reviewer access.",
          );
      });
    return () => {
      alive.current = false;
    };
  }, []);
  function prepare() {
    if (!record || busy || !current()) return;
    try {
      if (!checkedAt) throw new Error("Source time required");
      request.current = FleetComplianceVerifySchema.parse({
        operationId: Crypto.randomUUID(),
        evidenceId,
        expectedVersion: revision,
        decision,
        source: { kind: sourceKind, reference, url: url.trim() || null },
        reviewedAt: checkedAt,
        ...(record.attributes.kind==="insurance"?{coverageReview:{scopesReviewed,followFormReviewed,filingStatus,
          filingSource:filingReference.trim()?{kind:filingKind,reference:filingReference,url:filingURL.trim()||null}:null}}:{}),
      });
      setPrepared(true);
      setError("");
    } catch {
      setError(
        "Choose a decision and source, add its reference, and confirm when you checked it.",
      );
    }
  }
  async function save() {
    const attempt = request.current;
    if (!attempt || lock.current || !current()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt = FleetComplianceRecordReceiptSchema.parse(
        await apiFetch<unknown>(
          `/api/fleet/compliance/${evidenceId}/review`,
          { method: "POST", body: JSON.stringify(attempt) },
          scope.current,
        ),
      );
      if (
        receipt.id !== evidenceId ||
        receipt.revision !== attempt.expectedVersion + 1 ||
        receipt.status !== attempt.decision
      )
        throw new Error("Review receipt mismatch");
      const saved = await privateRead(receipt.revision);
      if (
        saved.evidence.id !== evidenceId ||
        saved.evidence.revision !== receipt.revision ||
        saved.evidence.status !== attempt.decision ||
        saved.review?.reportedReviewedAt !== attempt.reviewedAt ||
        JSON.stringify(saved.review?.source) !== JSON.stringify(attempt.source)
      )
        throw new Error("Review needs verification");
      if(attempt.coverageReview){
        const coverage=saved.attributes.kind==="insurance"?saved.attributes.coverage:null;
        if(!coverage||coverage.scopesReviewed!==attempt.coverageReview.scopesReviewed||coverage.followFormReviewed!==attempt.coverageReview.followFormReviewed||coverage.filingStatus!==attempt.coverageReview.filingStatus||JSON.stringify(saved.review?.filingSource)!==JSON.stringify(attempt.coverageReview.filingSource))throw new Error("Coverage review needs verification");
      }
      if (current()) {
        request.current = null;
        setUncertain(false);
        setRecord(null);
        onSaved();
      }
    } catch (cause) {
      if (current()) {
        const status = (cause as { status?: number }).status;
        if (status && status >= 400 && status < 500) {
          request.current = null;
          setRecord(null);
          setPrepared(false);
          setError(
            "Evidence or reviewer access changed. Close and reload before reviewing again.",
          );
        } else {
          setUncertain(true);
          setError(
            "Review outcome needs verification. Retry the same review before making another change.",
          );
        }
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  const attr = record?.attributes;
  const sourceLabels = {
    government_registry: "Government registry",
    qualified_examiner: "Qualified examiner",
    insurer_confirmation: "Insurer confirmation",
    qualified_reviewer: "Designated reviewer",
    employer_record: "Employer record",
    ELD_record: "ELD record",
  };
  const scopeText=(value:readonly (string|number)[]|null)=>value===null?copy("Unknown scope"):value.length?value.join(", "):copy("Unrestricted scope");
  const fields: Array<[string, string | null]> = !attr
    ? []
    : attr.kind === "driver_license"
      ? [
          ["License number", attr.licenseNumber],
          ["Issuing state", attr.issuingState],
          ["Class", attr.licenseClass],
          ["Endorsements", attr.endorsements.join(", ")],
          ["Restrictions", attr.restrictions.join(", ")],
          ["Recorded status", attr.licenseStatus],
        ]
      : attr.kind === "insurance"
        ? [
            ["Policy", attr.coverage.policyNumber],
            ["Insured entity", attr.coverage.insuredLegalEntity],
            ["Coverage type", attr.coverage.coverageType],
            ["USD limit", attr.coverage.limitUSD],
            ["Covered carriers",scopeText(attr.coverage.carrierIds)],
            ["Covered equipment",scopeText(attr.coverage.equipmentIds)],
            ["Underlying policy evidence",attr.coverage.underlyingPolicyId],
            ["Excess attachment USD",attr.coverage.attachmentPointUSD],
            ["Territories", scopeText(attr.coverage.states)],
            ["Cargo", scopeText(attr.coverage.cargoCodes)],
          ]
        : attr.kind === "credential"
          ? [
              ["Credential", attr.credentialType],
              ["Reference", attr.reference ?? "—"],
              ["Issuing authority", attr.issuingAuthority],
            ]
          : attr.kind === "driver_medical"
            ? [
                ["Recorded qualification", attr.qualification],
                ["Examiner reference", attr.examinerReference ?? "—"],
                ["Restrictions", attr.restrictions.join(", ")],
              ]
            : attr.kind === "driver_testing"
              ? [
                  ["Program", attr.program],
                  ["Recorded result", attr.result],
                  ["Query reference", attr.queryReference ?? "—"],
                ]
              : attr.kind === "driver_qualification"
                ? [
                    ["Check", attr.check],
                    ["Recorded result", attr.result],
                    ["Reference", attr.sourceRecordId ?? "—"],
                  ]
                : [
                    ["Duty source", attr.source],
                    ["Duty status", attr.dutyStatus],
                    ["Source time", attr.asOf],
                  ];
  const text = { color: colors.text },
    field = {
      color: colors.text,
      borderColor: colors.primary,
      borderWidth: 2,
      borderRadius: 8,
      padding: 12,
    },
    disabled = busy || prepared;
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
        {copy("Private evidence review")}
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {copy(error)}
        </Text>
      )}
      {record && (
        <>
          {fields.map(([label, value]) => (
            <View key={label}>
              <Text style={[text, { fontWeight: "700" }]}>{copy(label)}</Text>
              <Text style={text}>{value || "—"}</Text>
            </View>
          ))}
          <Text style={text}>
            {copy(
              "Review does not alter the document or establish coverage for every Run.",
            )}
          </Text>
          <FleetChoiceField
            label={copy("Review decision")}
            value={decision}
            disabled={disabled}
            options={["reviewed", "verified", "revoked", "failed"].map(
              (id) => ({ id, label: copy(id) }),
            )}
            onChange={(value) => setDecision(value as Attempt["decision"])}
          />
          <FleetChoiceField
            label={copy("Verification source")}
            value={sourceKind}
            disabled={disabled}
            options={Object.entries(sourceLabels).map(([id, label]) => ({
              id,
              label: copy(label),
            }))}
            onChange={setSourceKind}
          />
          <TextInput
            style={field}
            accessibilityLabel={copy("Source reference")}
            placeholder={copy("Source reference")}
            value={reference}
            onChangeText={setReference}
            editable={!disabled}
            maxLength={500}
          />
          <TextInput
            style={field}
            accessibilityLabel={copy("Source link (optional)")}
            placeholder={copy("Source link (optional)")}
            value={url}
            onChangeText={setUrl}
            editable={!disabled}
            autoCapitalize="none"
            keyboardType="url"
          />
          {attr?.kind==="insurance"&&<View style={{gap:10}}>
            <FleetCheckbox label={copy("I reviewed the listed coverage scope")} checked={scopesReviewed} disabled={disabled} onChange={setScopesReviewed}/>
            {attr.coverage.coverageType==="excess"&&<FleetCheckbox label={copy("I reviewed the excess follow-form terms")} checked={followFormReviewed} disabled={disabled} onChange={setFollowFormReviewed}/>}
            <FleetChoiceField label={copy("Filing decision")} value={filingStatus} disabled={disabled} options={["unverified","not_required","pending","accepted","cancelled"].map(id=>({id,label:copy(id)}))} onChange={value=>setFilingStatus(value as typeof filingStatus)}/>
            <FleetChoiceField label={copy("Filing verification source")} value={filingKind} disabled={disabled} options={Object.entries(sourceLabels).map(([id,label])=>({id,label:copy(label)}))} onChange={setFilingKind}/>
            <TextInput style={field} accessibilityLabel={copy("Filing source reference")} placeholder={copy("Filing source reference")} value={filingReference} onChangeText={setFilingReference} editable={!disabled} maxLength={500}/>
            <TextInput style={field} accessibilityLabel={copy("Filing source link (optional)")} placeholder={copy("Filing source link (optional)")} value={filingURL} onChangeText={setFilingURL} editable={!disabled} autoCapitalize="none" keyboardType="url"/>
          </View>}
          <TogglePillButton
            disabled={disabled}
            onPress={() => setCheckedAt(new Date().toISOString())}
          >
            {copy("I checked this source now")}
          </TogglePillButton>
          {!!checkedAt && (
            <Text style={text}>{new Date(checkedAt).toLocaleString()}</Text>
          )}
          {prepared ? (
            <>
              <Text style={text}>
                {copy("Review this exact decision and source before saving.")}
              </Text>
              <TogglePillButton disabled={busy} onPress={() => void save()}>
                {copy(
                  uncertain
                    ? "Retry the same evidence review"
                    : "Save evidence review",
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
                  {copy("Edit review")}
                </TogglePillButton>
              )}
            </>
          ) : (
            <TogglePillButton disabled={busy} onPress={prepare}>
              {copy("Prepare evidence review")}
            </TogglePillButton>
          )}
        </>
      )}
      <TogglePillButton
        disabled={busy}
        onPress={() => {
          setRecord(null);
          onClose();
        }}
      >
        {copy("Close private review")}
      </TogglePillButton>
    </View>
  );
}
