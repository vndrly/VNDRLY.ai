import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { useTranslation } from "react-i18next";
import {
  createGateDailyBillingWorkflow,
  gateDailyBillingCopy,
  gateDailyBillingError,
  fleetInstantToWallTime,
  type GateBillingRequest,
  type GateBillingWorkflowSnapshot,
} from "@workspace/api-zod";
import { apiFetch } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import TogglePillButton from "./TogglePillButton";
import FleetChoiceField from "./FleetChoiceField";
import FleetCheckbox from "./FleetCheckbox";
const defaultRequest: GateBillingRequest = (path, init) =>
  apiFetch(`/api${path}`, init);
const empty: GateBillingWorkflowSnapshot = {
  busy: true,
  posts: [],
  nextCursor: null,
  postId: "",
  setup: null,
  preview: null,
  pending: null,
  result: null,
  errorCode: null,
};
export default function GateDailyBillingPanel({
  scopeKey,
  request = defaultRequest,
}: {
  scopeKey: string;
  request?: GateBillingRequest;
}) {
  return <ScopedPanel key={scopeKey} request={request} />;
}
function ScopedPanel({ request }: { request: GateBillingRequest }) {
  const colors = useColors(),
    { i18n } = useTranslation(),
    copy = (text: string) => gateDailyBillingCopy(text, i18n.language),
    [workflow, setWorkflow] = useState<ReturnType<
      typeof createGateDailyBillingWorkflow
    > | null>(null);
  useEffect(() => {
    const value = createGateDailyBillingWorkflow({
      request,
      operationId: () => Crypto.randomUUID(),
    });
    setWorkflow(value);
    void value.load();
    return () => value.dispose();
  }, [request]);
  const state = useSyncExternalStore(
      workflow?.subscribe ?? (() => () => {}),
      workflow?.getSnapshot ?? (() => empty),
      () => empty,
    ),
    config = state.setup?.config,
    locked = state.busy || Boolean(state.pending),
    frozen = Boolean(config?.openTicketId);
  const [service, setService] = useState(""),
    [start, setStart] = useState(""),
    [agreement, setAgreement] = useState(""),
    [rule, setRule] = useState<"full_day" | "prorate_actual_day">("full_day"),
    [confirmed, setConfirmed] = useState(false),
    [automatic, setAutomatic] = useState(false),
    [interval, setIntervalDays] = useState("30"),
    [continueBilling, setContinue] = useState(true);
  useEffect(() => {
    const value = state.setup?.config;
    setService(
      value
        ? String(value.workTypeId)
        : state.setup?.services.length === 1
          ? String(state.setup.services[0].id)
          : "",
    );
    setStart(
      value?.periodStartDay ??
        fleetInstantToWallTime(
          new Date().toISOString(),
          "America/Chicago",
        )!.slice(0, 10),
    );
    setAgreement(value?.agreementReference ?? "");
    setRule(value?.partialDayRule ?? "full_day");
    setConfirmed(Boolean(value));
    setAutomatic(
      value?.autoInvoiceEveryDays !== null &&
        value?.autoInvoiceEveryDays !== undefined,
    );
    setIntervalDays(String(value?.autoInvoiceEveryDays ?? 30));
    setContinue(true);
  }, [state.setup]);
  const money = (cents: number) =>
      new Intl.NumberFormat(i18n.language, {
        style: "currency",
        currency: "USD",
      }).format(cents / 100),
    text = { color: colors.foreground },
    field = {
      backgroundColor: colors.card,
      borderColor: colors.primary,
      borderRadius: 12,
      borderWidth: 2,
      color: colors.foreground,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    card = {
      backgroundColor: colors.card,
      borderColor: colors.primary,
      borderRadius: 14,
      borderWidth: 2,
      padding: 16,
      gap: 12,
    };
  const save = () =>
    void workflow?.configure({
      workTypeId: Number(service),
      startDay: start,
      agreementReference: agreement,
      partialDayRule: rule,
      confirmedUnbilledStart: confirmed as true,
      autoInvoiceEveryDays: automatic ? Number(interval) : null,
    });
  return (
    <View style={{ gap: 16 }}>
      <View style={card}>
        <Text style={text}>
          {copy(
            "Staff shifts and Gate coverage continue independently of billing.",
          )}
        </Text>
        <Text style={text}>
          {copy("Billing includes only completed days in Central time.")}
        </Text>
        <FleetChoiceField
          label={copy("Gate post")}
          placeholder={copy("Choose a post")}
          value={state.postId}
          disabled={locked}
          options={state.posts.map((post) => ({
            id: post.id,
            label: `${post.siteName} — ${post.name}`,
          }))}
          onChange={(value) => void workflow?.select(value)}
        />
        {state.nextCursor ? (
          <TogglePillButton
            disabled={locked}
            onPress={() => void workflow?.load(state.nextCursor!)}
          >
            {copy("Load more posts")}
          </TogglePillButton>
        ) : null}
        {!state.busy && !state.posts.length && !state.errorCode ? (
          <Text style={text}>{copy("No authorized gate posts.")}</Text>
        ) : null}
        {state.busy ? (
          <Text style={text} accessibilityLiveRegion="polite">
            {copy("Working…")}
          </Text>
        ) : null}
        {state.errorCode ? (
          <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
            {gateDailyBillingError(state.errorCode, i18n.language)}
          </Text>
        ) : null}
        {state.pending ? (
          <TogglePillButton
            disabled={state.busy}
            onPress={() => void workflow?.retry()}
          >
            {copy("Retry request")}
          </TogglePillButton>
        ) : null}
      </View>
      {state.setup?.automationNotice ? (
        <Text style={text} accessibilityRole="alert">
          {copy("Automatic billing needs office review.")}
        </Text>
      ) : null}
      {state.setup ? (
        <View style={card}>
          <FleetChoiceField
            label={copy("Approved daily service")}
            placeholder={copy("Choose an approved service")}
            value={service}
            disabled={locked || frozen}
            options={state.setup.services.map((item) => ({
              id: String(item.id),
              label: `${item.name} · ${money(frozen && config?.workTypeId === item.id ? config.dailyRateCents : item.dailyRateCents)} ${copy("Per day")}`,
            }))}
            onChange={setService}
          />
          {!state.setup.services.length ? (
            <Text style={text}>
              {copy(
                "Choose an approved per-day service before starting billing.",
              )}
            </Text>
          ) : null}
          <Text style={text}>{copy("Period starts")} (YYYY-MM-DD)</Text>
          <TextInput
            accessibilityLabel={copy("Period starts")}
            style={field}
            value={start}
            editable={!locked && !frozen}
            onChangeText={setStart}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.mutedForeground}
          />
          <Text style={text}>{copy("Agreement reference")}</Text>
          <TextInput
            accessibilityLabel={copy("Agreement reference")}
            style={field}
            value={agreement}
            editable={!locked && !frozen}
            onChangeText={setAgreement}
          />
          <FleetChoiceField
            label={copy("Partial-day billing")}
            value={rule}
            disabled={locked || frozen}
            options={[
              { id: "full_day", label: copy("Full daily rate") },
              {
                id: "prorate_actual_day",
                label: copy("Prorate by actual day length"),
              },
            ]}
            onChange={(value) => setRule(value as typeof rule)}
          />
          {frozen ? (
            <Text style={text}>
              {copy("Close the current period before changing its agreement.")}
            </Text>
          ) : (
            <FleetCheckbox
              label={copy(
                "Confirm this starts after all previously billed days.",
              )}
              checked={confirmed}
              disabled={locked}
              onChange={setConfirmed}
            />
          )}
          <FleetCheckbox
            label={copy("Automatic billing")}
            checked={automatic}
            disabled={locked}
            onChange={setAutomatic}
          />
          {automatic ? (
            <>
              <Text style={text}>{copy("Interval in completed days")}</Text>
              <TextInput
                accessibilityLabel={copy("Interval in completed days")}
                style={field}
                keyboardType="number-pad"
                value={interval}
                editable={!locked}
                onChangeText={setIntervalDays}
              />
              <Text style={text}>
                {copy(
                  "Automatic billing submits reviewed coverage at the saved interval; partner approval still applies.",
                )}
              </Text>
              <Text style={text}>
                {copy(
                  "Partial or missing recorded coverage pauses automatic billing for office review.",
                )}
              </Text>
            </>
          ) : null}
          <TogglePillButton
            disabled={
              locked || !service || !start || !agreement.trim() || !confirmed
            }
            onPress={save}
          >
            {copy("Save billing setup")}
          </TogglePillButton>
        </View>
      ) : null}
      {state.preview ? (
        <View style={card}>
          <Text style={text}>
            {copy("Partner")}:{" "}
            {state.setup?.post.partnerName || config?.partnerId}
          </Text>
          <Text style={text}>
            {copy("Site")}: {state.setup?.post.siteName}
          </Text>
          <Text style={text}>
            {copy("Gate post")}: {state.setup?.post.name}
          </Text>
          <Text style={text}>
            {copy("AFE")}: {config?.afe || "—"}
          </Text>
          <Text style={text}>
            {copy("Period daily rate")}:{" "}
            {money(state.preview.config.dailyRateCents)}
          </Text>
          <Text style={text}>
            {copy("Current ticket")}: {config?.openTicketId ?? "—"}
          </Text>
          <Text style={text}>
            {copy("Last billed through")}: {config?.lastBilledThroughDay ?? "—"}
          </Text>
          <Text style={text}>
            {copy("Through")}: {state.preview.period.throughDay} · Central
          </Text>
          <Text style={text}>
            {copy("Recorded billable days")}:{" "}
            {state.preview.period.billableDays}
          </Text>
          <Text style={{ ...text, fontWeight: "700", fontSize: 22 }}>
            {copy("Total")}: {money(state.preview.period.totalCents)}
          </Text>
          {state.preview.period.days.some((day) => day.hasCoverageGap) ? (
            <Text style={text}>
              {copy(
                "Some days have partial or missing recorded coverage. Review before submitting.",
              )}
            </Text>
          ) : null}
          <Text style={text}>
            {copy(
              "Partner approval is required before the invoice is generated.",
            )}
          </Text>
          {config?.openTicketId ? (
            <FleetCheckbox
              label={copy("Start next billing ticket")}
              checked={continueBilling}
              disabled={locked}
              onChange={setContinue}
            />
          ) : null}
          {!state.preview.period.billableDays ? (
            <Text style={text}>{copy("No completed billable days yet.")}</Text>
          ) : null}
          <TogglePillButton
            disabled={
              locked ||
              !config?.openTicketId ||
              !state.preview.period.billableDays
            }
            onPress={() => void workflow?.invoiceNow(continueBilling)}
          >
            {copy("Invoice Now")}
          </TogglePillButton>
          <TogglePillButton
            disabled={locked}
            onPress={() => void workflow?.refresh()}
          >
            {copy("Refresh preview")}
          </TogglePillButton>
        </View>
      ) : null}
      {state.result ? (
        <View style={card} accessibilityLiveRegion="polite">
          {state.result.status === "submitted" ? (
            <>
              <Text style={text}>
                {copy(
                  "Submitted ticket {ticket} for partner approval.",
                ).replace("{ticket}", String(state.result.ticketId))}
              </Text>
              <Text style={text}>
                {state.result.nextTicketId
                  ? copy("Next ticket: {ticket}.").replace(
                      "{ticket}",
                      String(state.result.nextTicketId),
                    )
                  : copy("Billing stopped after this period.")}
              </Text>
            </>
          ) : (
            <Text style={text}>{copy("Billing is not due yet.")}</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}
