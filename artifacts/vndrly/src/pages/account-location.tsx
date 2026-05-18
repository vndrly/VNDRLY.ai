import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import Layout from "@/components/layout";
import SphereBackButton from "@/components/sphere-back-button";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Consent = {
  id: number;
  deviceId: string;
  acceptedAt: string;
  revokedAt: string | null;
};

export default function AccountLocationPage() {
  const { t } = useTranslation();
  const [consents, setConsents] = useState<Consent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/location-consents/me`, { credentials: "include" });
      if (!r.ok) throw new Error(t("accountLocation.errorLoad"));
      const data = await r.json();
      setConsents(Array.isArray(data?.consents) ? data.consents : []);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("accountLocation.errorGeneric"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const revoke = async (deviceId?: string) => {
    setBusy(true);
    try {
      const url = deviceId
        ? `${API_BASE}/api/location-consents?deviceId=${encodeURIComponent(deviceId)}`
        : `${API_BASE}/api/location-consents`;
      const r = await fetch(url, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(t("accountLocation.errorRevoke"));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("accountLocation.errorGeneric"));
    } finally {
      setBusy(false);
    }
  };

  const active = consents.filter((c) => !c.revokedAt);
  const revoked = consents.filter((c) => c.revokedAt);

  return (
    <Layout>
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div className="flex items-start gap-4">
          <Link
            href="/field"
            className="group inline-flex items-center shrink-0 mt-1"
            aria-label="Back"
            data-testid="button-back"
          >
            <SphereBackButton size={32} />
          </Link>
          <div>
            <h1 className="text-2xl font-semibold">{t("accountLocation.title")}</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
              {t("accountLocation.description")}
            </p>
          </div>
        </div>

        {err && <div className="rounded border border-red-300 bg-red-50 text-red-800 px-3 py-2">{err}</div>}

        {loading ? (
          <div>{t("accountLocation.loading")}</div>
        ) : (
          <>
            <section>
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-medium">{t("accountLocation.activeDevices")}</h2>
                {active.length > 0 && (
                  <button
                    type="button"
                    onClick={() => revoke()}
                    disabled={busy}
                    className="text-sm rounded bg-red-600 hover:bg-red-700 text-white px-3 py-1 disabled:opacity-50"
                  >
                    {t("accountLocation.revokeAll")}
                  </button>
                )}
              </div>
              {active.length === 0 ? (
                <div className="text-sm text-zinc-500">{t("accountLocation.noActive")}</div>
              ) : (
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded border border-zinc-200 dark:border-zinc-800">
                  {active.map((c) => (
                    <li key={c.id} className="flex items-center justify-between p-3">
                      <div>
                        <div className="font-mono text-xs text-zinc-500">{c.deviceId.slice(0, 16)}…</div>
                        <div className="text-xs text-zinc-500">{t("accountLocation.accepted", { when: new Date(c.acceptedAt).toLocaleString() })}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => revoke(c.deviceId)}
                        disabled={busy}
                        className="text-sm rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 px-3 py-1 disabled:opacity-50"
                      >
                        {t("accountLocation.revoke")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {revoked.length > 0 && (
              <section>
                <h2 className="font-medium mb-2">{t("accountLocation.history")}</h2>
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded border border-zinc-200 dark:border-zinc-800 text-sm">
                  {revoked.map((c) => (
                    <li key={c.id} className="p-3 flex justify-between">
                      <span className="font-mono text-xs text-zinc-500">{c.deviceId.slice(0, 16)}…</span>
                      <span className="text-xs text-zinc-500">
                        {t("accountLocation.revoked", { when: c.revokedAt ? new Date(c.revokedAt).toLocaleString() : "" })}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
