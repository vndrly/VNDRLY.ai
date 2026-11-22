import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useBrand } from "@/hooks/use-brand";
import { Dialog } from "@/components/ui/dialog";
import MiniCardDialogContent from "@/components/mini-card-dialog-content";
import { WorkHubMiniCardButton as Button } from "./chrome";
import {
  ProviderLogo,
  TeamsLogo,
  OutlookLogo,
  GmailLogo,
  SlackLogo,
  type CommunicationProvider,
} from "./provider-logo";
import { connectorRequest, useAccounts } from "./connector-client";
const providers = [
  { id: "teams", name: "Teams", Icon: TeamsLogo },
  { id: "outlook", name: "Outlook", Icon: OutlookLogo },
  { id: "gmail", name: "Gmail", Icon: GmailLogo },
  { id: "slack", name: "Slack", Icon: SlackLogo },
] as const;
export function CommunicationConnections() {
  const brand = useBrand(),
    accounts = useAccounts(),
    cache = useQueryClient();
  const [selected, setSelected] = useState<CommunicationProvider | null>(null),
    [attempt, setAttempt] = useState<string>(),
    [busy, setBusy] = useState(false),
    [authorization, setAuthorization] = useState<{ id: string; url: string }>(),
    [error, setError] = useState("");
  const provider = providers.find((p) => p.id === selected);
  useEffect(() => {
    if (!attempt) return;
    let active = true;
    const check = async () => {
      try {
        const result = await connectorRequest(`/attempts/${attempt}`);
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
      const result = await connectorRequest(`/${selected}/connect`, {});
      const target = new URL(result.authorizationUrl);
      if (
        target.protocol !== "https:" ||
        ![
          "login.microsoftonline.com",
          "accounts.google.com",
          "slack.com",
        ].includes(target.hostname)
      )
        throw new Error("Invalid authorization address.");
      setAuthorization({ id: result.id, url: target.href });
      setBusy(false);
    } catch (e) {
      setBusy(false);
      setError((e as Error).message);
    }
  }
  return (
    <div className="mt-5">
      <div className="flex flex-wrap gap-3">
        {providers.map((p) => (
          <Button
            key={p.id}
            className="inline-flex items-center gap-2"
            onClick={() => {
              setSelected(p.id);
              setAuthorization(undefined);
              setError("");
            }}
          >
            <ProviderLogo provider={p.id} />
            Connect {p.name}
          </Button>
        ))}
      </div>
      <Dialog
        open={!!provider}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        {provider && (
          <MiniCardDialogContent
            icon={provider.Icon}
            label={`Connect ${provider.name}`}
            definition="Manage your connected accounts."
            iconColor={brand.primary}
          >
            <section
              className="rounded-xl border-2 p-4 space-y-3"
              style={{ borderColor: brand.primary, background: "#242426" }}
            >
              {accounts.data?.accounts
                .filter((a) => a.provider === selected)
                .map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <span>
                      {a.label}
                      {a.status !== "connected" ? " · Reconnect required" : ""}
                    </span>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        void connectorRequest(
                          `/accounts/${a.id}/disconnect`,
                          {},
                        )
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
                  </div>
                ))}
              {authorization ? (
                <a
                  className="vendor-mini-card-button inline-flex items-center gap-2"
                  href={authorization.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    setAttempt(authorization.id);
                    setBusy(true);
                  }}
                >
                  <ProviderLogo provider={provider.id} />
                  Continue to {provider.name}
                </a>
              ) : <Button disabled={busy} onClick={() => void connect()}>
                <span className="flex items-center gap-2">
                  <ProviderLogo provider={provider.id} />
                  {busy
                    ? "Waiting for sign-in…"
                    : `Add ${provider.name} account`}
                </span>
              </Button>}
              {(error || accounts.error) && (
                <p role="alert">{error || accounts.error?.message}</p>
              )}
            </section>
          </MiniCardDialogContent>
        )}
      </Dialog>
    </div>
  );
}
