import React, { useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import DismissibleModal from "@/components/DismissibleModal";
import Button from "@/components/ProfileMiniCardButton";
import { useBrand } from "@/hooks/use-brand";
import ProviderLogo, { type Provider } from "./ProviderLogo";
import { request, useAccounts } from "./connector-client";
const providers = [
  { id: "teams", name: "Teams" },
  { id: "outlook", name: "Outlook" },
  { id: "gmail", name: "Gmail" },
  { id: "slack", name: "Slack" },
] as const;
export default function CommunicationConnections() {
  const brand = useBrand(),
    accounts = useAccounts(),
    cache = useQueryClient();
  const [selected, setSelected] = useState<Provider>(),
    [attempt, setAttempt] = useState<string>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!attempt) return;
    let active = true;
    const check = async () => {
      try {
        const result = await request(`/attempts/${attempt}`);
        if (!active) return;
        if (["connected", "failed"].includes(result.status)) {
          setAttempt(undefined);
          setBusy(false);
          if (result.error) setError(result.error.replaceAll("_", " "));
          void cache.invalidateQueries({ queryKey: ["comms-accounts"] });
        }
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          setAttempt(undefined);
          setBusy(false);
        }
      }
    };
    const timer = setInterval(() => void check(), 2000);
    const timeout = setTimeout(() => {
      if (active) {
        setAttempt(undefined);
        setBusy(false);
        setError("Sign-in timed out. Try connecting again.");
      }
    }, 600000);
    return () => {
      active = false;
      clearInterval(timer);
      clearTimeout(timeout);
    };
  }, [attempt, cache]);
  async function connect() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const r = await request(`/${selected}/connect`, {});
      const target = new URL(r.authorizationUrl);
      if (
        target.protocol !== "https:" ||
        ![
          "login.microsoftonline.com",
          "accounts.google.com",
          "slack.com",
        ].includes(target.hostname)
      )
        throw new Error("Invalid authorization address.");
      setAttempt(r.id);
      await Linking.openURL(target.href);
    } catch (e) {
      setBusy(false);
      setAttempt(undefined);
      setError((e as Error).message);
    }
  }
  const provider = providers.find((p) => p.id === selected);
  return (
    <View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {providers.map((p) => (
          <Button
            key={p.id}
            borderColor={brand.primary}
            icon={<ProviderLogo provider={p.id} />}
            onPress={() => {
              setSelected(p.id);
              setError("");
            }}
          >{`Connect ${p.name}`}</Button>
        ))}
      </View>
      <DismissibleModal
        visible={!!selected}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(undefined)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            padding: 20,
            backgroundColor: "rgba(0,0,0,.65)",
          }}
        >
          <View
            style={{
              backgroundColor: "#242426",
              borderColor: brand.primary,
              borderWidth: 2,
              borderRadius: 14,
              padding: 16,
              gap: 12,
            }}
          >
            {provider && (
              <>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <ProviderLogo provider={provider.id} size={28} />
                  <Text
                    style={{ color: "white", fontWeight: "700", fontSize: 20 }}
                  >{`Connect ${provider.name}`}</Text>
                </View>
                {accounts.data?.accounts
                  .filter((a) => a.provider === selected)
                  .map((a) => (
                    <View key={a.id}>
                      <Text style={{ color: "white" }}>
                        {a.label}
                        {a.status !== "connected"
                          ? " · Reconnect required"
                          : ""}
                      </Text>
                      <Button
                        borderColor={brand.primary}
                        disabled={busy}
                        onPress={() => {
                          setBusy(true);
                          void request(`/accounts/${a.id}/disconnect`, {})
                            .then(() =>
                              cache.invalidateQueries({
                                queryKey: ["comms-accounts"],
                              }),
                            )
                            .catch((e) => setError(e.message))
                            .finally(() => setBusy(false));
                        }}
                      >
                        Disconnect
                      </Button>
                    </View>
                  ))}
                <Button
                  borderColor={brand.primary}
                  loading={busy}
                  icon={<ProviderLogo provider={provider.id} />}
                  onPress={() => void connect()}
                >
                  {busy
                    ? "Waiting for sign-in…"
                    : `Add ${provider.name} account`}
                </Button>
              </>
            )}
            {!!(error || accounts.error) && (
              <Text accessibilityRole="alert" style={{ color: "white" }}>
                {error || accounts.error?.message}
              </Text>
            )}
            <Button
              borderColor={brand.primary}
              onPress={() => setSelected(undefined)}
            >
              Close
            </Button>
          </View>
        </View>
      </DismissibleModal>
    </View>
  );
}
