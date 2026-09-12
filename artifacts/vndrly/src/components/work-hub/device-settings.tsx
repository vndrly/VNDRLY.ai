import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Laptop, Mic, Smartphone, Tablet, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import BrandPillButton from "@/components/brand-pill-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { isWorkHubAdmin, workHubRequest } from "@/lib/work-hub-client";
import { workHubDeviceIdentity } from "@/hooks/use-work-hub-device-presence";
import { WorkHubCardTitle } from "@/components/work-hub/chrome";

type Device = {
  id: string;
  userId: number;
  friendlyName: string;
  deviceClass: string;
  capabilities: { microphone?: boolean };
  revokedAt: string | null;
  updatedAt: string;
  connected?: boolean;
  currentAudioOwner?: boolean;
};
type Preferences = {
  rankedDeviceIds: string[];
  automaticBackupDeviceIds: string[];
  learning: Record<string, number>;
};

export default function WorkHubDeviceSettings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const cache = useQueryClient();
  const currentId = useMemo(() => workHubDeviceIdentity()?.deviceId ?? "", []);
  const admin = isWorkHubAdmin(user);
  const [names, setNames] = useState<Record<string, string>>({});
  const own = useQuery<Device[]>({ queryKey: ["work-hub", "devices", "self"], queryFn: () => workHubRequest("/devices") });
  const organization = useQuery<Device[]>({ queryKey: ["work-hub", "devices", "organization"], queryFn: () => workHubRequest("/devices?scope=organization"), enabled: admin });
  const preferences = useQuery<Preferences>({ queryKey: ["work-hub", "device-preferences"], queryFn: () => workHubRequest("/devices/preferences") });
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ["work-hub", "devices"] });
    void cache.invalidateQueries({ queryKey: ["work-hub", "device-preferences"] });
  };
  const change = useMutation({
    mutationFn: ({ path, method, body }: { path: string; method: string; body?: unknown }) => workHubRequest(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }),
    onSuccess: refresh,
  });
  const devices = (admin ? organization.data : own.data)?.filter((device) => !device.revokedAt) ?? [];
  const ownIds = new Set((own.data ?? []).filter((device) => !device.revokedAt).map((device) => device.id));
  const orderedOwn = [...(own.data ?? []).filter((device) => !device.revokedAt)].sort((a, b) => {
    const order = preferences.data?.rankedDeviceIds ?? [];
    const left = order.indexOf(a.id), right = order.indexOf(b.id);
    return (left < 0 ? Number.MAX_SAFE_INTEGER : left) - (right < 0 ? Number.MAX_SAFE_INTEGER : right);
  });
  const savePreferences = (next: Partial<Preferences> & { clearLearning?: boolean }) => change.mutate({
    path: "/devices/preferences",
    method: "PUT",
    body: {
      rankedDeviceIds: next.rankedDeviceIds ?? preferences.data?.rankedDeviceIds ?? orderedOwn.map((device) => device.id),
      automaticBackupDeviceIds: next.automaticBackupDeviceIds ?? preferences.data?.automaticBackupDeviceIds ?? [],
      ...(next.clearLearning ? { clearLearning: true } : {}),
    },
  });
  const move = (id: string, direction: -1 | 1) => {
    const ids = orderedOwn.map((device) => device.id);
    const index = ids.indexOf(id), target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    savePreferences({ rankedDeviceIds: ids });
  };
  const toggleBackup = (id: string) => {
    const current = preferences.data?.automaticBackupDeviceIds ?? [];
    savePreferences({ automaticBackupDeviceIds: current.includes(id) ? current.filter((value) => value !== id) : [...current, id] });
  };
  const Icon = ({ kind }: { kind: string }) => kind === "phone" ? <Smartphone className="h-4 w-4" /> : kind === "tablet" ? <Tablet className="h-4 w-4" /> : <Laptop className="h-4 w-4" />;
  return (
    <Card data-testid="work-hub-device-settings">
      <CardHeader><CardTitle><WorkHubCardTitle icon={Laptop}>{t("workHubDevices.title")}</WorkHubCardTitle></CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("workHubDevices.description")}</p>
        {change.error && <p role="alert" className="text-sm text-red-700">{change.error instanceof Error ? change.error.message : t("workHubDevices.failed")}</p>}
        <div className="grid gap-3">
          {devices.map((device) => {
            const selfOwned = ownIds.has(device.id);
            const automatic = preferences.data?.automaticBackupDeviceIds.includes(device.id) ?? false;
            return <section key={device.id} className="rounded-xl border p-3" aria-label={device.friendlyName}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2"><Icon kind={device.deviceClass} /><strong>{device.friendlyName}</strong>{device.id === currentId && <span className="text-xs text-[var(--brand-primary)]">{t("workHubDevices.thisDevice")}</span>}{device.currentAudioOwner && <span className="text-xs font-semibold text-[var(--brand-primary)]">{t("workHubDevices.audioOwner")}</span>}</div>
                {device.capabilities.microphone && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Mic className="h-3.5 w-3.5" />{t("workHubDevices.audioCapable")}</span>}
              </div>
              {selfOwned && <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input className="h-9 min-w-44 flex-1" aria-label={t("workHubDevices.nameLabel")} value={names[device.id] ?? device.friendlyName} onChange={(event) => setNames((current) => ({ ...current, [device.id]: event.target.value }))} />
                <BrandPillButton disabled={change.isPending} onClick={() => change.mutate({ path: `/devices/${device.id}`, method: "PATCH", body: { friendlyName: names[device.id] ?? device.friendlyName } })}>{t("common.save")}</BrandPillButton>
                <BrandPillButton disabled={change.isPending} onClick={() => move(device.id, -1)}>{t("workHubDevices.moveUp")}</BrandPillButton>
                <BrandPillButton disabled={change.isPending} onClick={() => move(device.id, 1)}>{t("workHubDevices.moveDown")}</BrandPillButton>
                <BrandPillButton tone={automatic ? "brand" : "image"} disabled={change.isPending || !device.capabilities.microphone} aria-pressed={automatic} onClick={() => toggleBackup(device.id)}>{automatic ? t("workHubDevices.backupEnabled") : t("workHubDevices.allowBackup")}</BrandPillButton>
              </div>}
              <div className="mt-2"><BrandPillButton tone="red" disabled={change.isPending || device.id === currentId} onClick={() => change.mutate({ path: `/devices/${device.id}${selfOwned ? "" : "?scope=organization"}`, method: "DELETE" })}><span className="flex items-center gap-1"><Trash2 className="h-3.5 w-3.5" />{selfOwned ? t("workHubDevices.forget") : t("workHubDevices.revoke")}</span></BrandPillButton></div>
            </section>;
          })}
          {!devices.length && !own.isLoading && !organization.isLoading && <p className="text-sm text-muted-foreground">{t("workHubDevices.none")}</p>}
        </div>
        <BrandPillButton disabled={change.isPending} onClick={() => savePreferences({ clearLearning: true })}>{t("workHubDevices.clearLearning")}</BrandPillButton>
      </CardContent>
    </Card>
  );
}
