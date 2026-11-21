import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Laptop, Mic, Smartphone, Star, Tablet, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { workHubRequest } from "@/lib/work-hub-client";
import { workHubDeviceIdentity } from "@/hooks/use-work-hub-device-presence";
import { BrandedInput, WorkHubCardTitle, WorkHubMiniCardButton, WORK_HUB_SUBCARD_CLASS } from "@/components/work-hub/chrome";
import SphereBackButton from "@/components/sphere-back-button";
import type { ActiveWorkHubAudio } from "@/hooks/use-work-hub-active-audio";

type Device = {
  id: string;
  userId: number;
  friendlyName: string;
  deviceClass: string;
  capabilities: { microphone?: boolean };
  revokedAt: string | null;
  updatedAt: string;
  connected: boolean;
  currentAudioOwner?: boolean;
};
type Preferences = {
  rankedDeviceIds: string[];
  learning: Record<string, number>;
};

type AudioControls = {
  activeAudio?: ActiveWorkHubAudio | null;
  takeoverBusy?: boolean;
  onTakeOver?: (audio: ActiveWorkHubAudio) => void;
  disconnecting?: boolean;
  onDisconnect?: () => void;
  embedded?: boolean;
  flat?: boolean;
  onExit?: () => void;
};
const backupArrowClass = "group grid size-10 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)] disabled:pointer-events-none disabled:opacity-40";

export default function WorkHubDeviceSettings({ activeAudio, takeoverBusy, onTakeOver, disconnecting, onDisconnect, embedded = false, flat = false, onExit }: AudioControls) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const cache = useQueryClient();
  const currentId = useMemo(() => workHubDeviceIdentity(user?.userId)?.deviceId ?? "", [user?.userId]);
  const [names, setNames] = useState<Record<string, string>>({});
  const own = useQuery<Device[]>({ queryKey: ["work-hub", "devices", "self", user?.userId], queryFn: () => workHubRequest("/devices"), refetchInterval: 15_000 });
  const preferences = useQuery<Preferences>({ queryKey: ["work-hub", "device-preferences"], queryFn: () => workHubRequest("/devices/preferences") });
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ["work-hub", "devices"] });
    void cache.invalidateQueries({ queryKey: ["work-hub", "device-preferences"] });
  };
  const change = useMutation({
    mutationFn: ({ path, method, body }: { path: string; method: string; body?: unknown }) => workHubRequest(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }),
    onSuccess: refresh,
  });
  const connected = own.data?.filter((device) => device.userId === user?.userId && device.connected && !device.revokedAt) ?? [];
  const ownIds = new Set((own.data ?? []).filter((device) => !device.revokedAt).map((device) => device.id));
  const activeId = activeAudio?.deviceId ?? connected.find(device => ownIds.has(device.id) && device.currentAudioOwner)?.id;
  const pinnedId = activeId ?? currentId;
  const ranks = new Map(preferences.data?.rankedDeviceIds?.map((id, index) => [id, index]));
  const rank = (id: string) => ranks.get(id) ?? Number.MAX_SAFE_INTEGER;
  const devices = [...connected].sort((left, right) =>
    Number(right.id === pinnedId) - Number(left.id === pinnedId)
    || Number(ownIds.has(right.id)) - Number(ownIds.has(left.id))
    || rank(left.id) - rank(right.id),
  );
  const backups = devices.filter(device => device.id !== pinnedId && ownIds.has(device.id) && device.capabilities.microphone).map(device => device.id);
  const savePreferences = (next: Partial<Preferences> & { clearLearning?: boolean }) => change.mutate({
    path: "/devices/preferences",
    method: "PUT",
    body: {
      rankedDeviceIds: next.rankedDeviceIds ?? preferences.data?.rankedDeviceIds ?? [],
      ...(next.clearLearning ? { clearLearning: true } : {}),
    },
  });
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (index < 0 || target < 0 || target >= backups.length) return;
    const ids = [...backups];
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    const remaining = [...ranks.keys()].filter(id => ownIds.has(id) && !ids.includes(id));
    savePreferences({ rankedDeviceIds: [...ids, ...remaining].slice(0, 20) });
  };
  const content = (
    <>
        <p className="text-sm text-muted-foreground">{t("workHubDevices.description")}</p>
        {change.error && <p role="alert" className="text-sm text-red-700">{change.error instanceof Error ? change.error.message : t("workHubDevices.failed")}</p>}
        <div className="grid gap-3">
          {devices.map((device) => {
            const DeviceIcon = device.deviceClass === "phone" ? Smartphone : device.deviceClass === "tablet" ? Tablet : Laptop;
            const selfOwned = ownIds.has(device.id);
            const revokeDisabled = change.isPending || device.id === currentId;
            const revoke = () => change.mutate({ path: `/devices/${device.id}`, method: "DELETE" });
            const backupIndex = backups.indexOf(device.id);
            const canTakeOver = activeAudio && onTakeOver && selfOwned && device.id === currentId && device.id !== activeId && device.capabilities.microphone;
            return <section key={device.id} data-work-hub-card={flat ? undefined : true} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 ${flat ? "border-b border-[#454548] py-3" : `p-3 ${WORK_HUB_SUBCARD_CLASS}`}`} aria-label={device.friendlyName}>
              <div className="col-span-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <DeviceIcon className="h-4 w-4 shrink-0 text-[var(--brand-primary)]" aria-hidden="true" />
                  <strong className="break-all">{device.friendlyName}</strong>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {selfOwned && <button type="button" className={backupArrowClass} aria-label={t("workHubDevices.moveUp")} title={t("workHubDevices.moveUp")} disabled={change.isPending || !preferences.data || backupIndex <= 0} onClick={() => move(backupIndex, -1)}>
                    <SphereBackButton backStyle direction="up" size={30} />
                  </button>}
                </div>
              </div>
              <div className="col-span-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {device.id === currentId && <span className="inline-flex items-center gap-1 text-xs text-[var(--brand-primary)]">
                    <Star className="size-3 shrink-0 fill-current" aria-hidden="true" />{t("workHubDevices.thisDevice")}
                  </span>}
                  {device.id === activeId && <span className="text-xs font-semibold text-[var(--brand-primary)]">{t("workHubDevices.audioOwner")}</span>}
                </div>
                {device.capabilities.microphone && <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Mic className="h-3.5 w-3.5" aria-hidden="true" />{t("workHubDevices.audioCapable")}</span>}
              </div>
              {selfOwned && <div className="col-span-2 flex flex-wrap items-center gap-2">
                <BrandedInput className="min-w-32 flex-1 focus-visible:outline-offset-0!" aria-label={t("workHubDevices.nameLabel")} value={names[device.id] ?? device.friendlyName} onChange={(event) => setNames((current) => ({ ...current, [device.id]: event.target.value }))} />
                <WorkHubMiniCardButton disabled={change.isPending} onClick={() => change.mutate({ path: `/devices/${device.id}`, method: "PATCH", body: { friendlyName: names[device.id] ?? device.friendlyName } })}>{t("workHubDevices.save")}</WorkHubMiniCardButton>
              </div>}
              <div className="flex flex-wrap items-center gap-2">
                {canTakeOver && <WorkHubMiniCardButton disabled={takeoverBusy} onClick={() => onTakeOver(activeAudio)}>
                  {takeoverBusy ? t("workHubDevices.takingOver") : t("workHubDevices.takeOver")}
                </WorkHubMiniCardButton>}
                <WorkHubMiniCardButton disabled={revokeDisabled} onClick={revoke}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("workHubDevices.forget")}
                </WorkHubMiniCardButton>
                {device.id === currentId && device.id === activeId && onDisconnect && <WorkHubMiniCardButton disabled={disconnecting} onClick={onDisconnect}>
                  {t(disconnecting ? "workHubDevices.disconnecting" : "workHubDevices.disconnect")}
                </WorkHubMiniCardButton>}
              </div>
              {selfOwned && <button type="button" className={backupArrowClass + " self-end justify-self-end"} aria-label={t("workHubDevices.moveDown")} title={t("workHubDevices.moveDown")} disabled={change.isPending || !preferences.data || backupIndex < 0 || backupIndex >= Math.min(backups.length, 20) - 1} onClick={() => move(backupIndex, 1)}>
                <SphereBackButton backStyle direction="down" size={30} />
              </button>}
            </section>;
          })}
          {!devices.length && !own.isLoading && <p className="text-sm text-muted-foreground">{t("workHubDevices.none")}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onExit && <WorkHubMiniCardButton onClick={onExit}>Exit</WorkHubMiniCardButton>}
          <WorkHubMiniCardButton disabled={change.isPending} onClick={() => savePreferences({ clearLearning: true })}>{t("workHubDevices.clearLearning")}</WorkHubMiniCardButton>
        </div>
    </>
  );
  if (embedded) return <div className="space-y-4" data-testid="work-hub-device-settings">{content}</div>;

  return (
    <Card data-testid="work-hub-device-settings">
      <CardHeader><CardTitle><WorkHubCardTitle icon={Laptop}>{t("workHubDevices.title")}</WorkHubCardTitle></CardTitle></CardHeader>
      <CardContent className="space-y-4">{content}</CardContent>
    </Card>
  );
}
