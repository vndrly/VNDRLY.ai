import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Laptop, Smartphone, Tablet } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { workHubDeviceIdentity } from "@/hooks/use-work-hub-device-presence";
import { ProfileRow, profileRequest } from "./gate-profile-chrome";

type Device = { id: string; friendlyName: string; deviceClass: string; connected: boolean; revokedAt: string | null; currentAudioOwner?: boolean };
export default function GateProfileDevices() {
  const { user } = useAuth(), { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const devices = useQuery({ queryKey: ["gate-profile-devices", user?.userId, user?.activeMembershipId],
    queryFn: ({ signal }) => profileRequest<Device[]>("/work-hub/devices", { signal }), refetchInterval: 15000 });
  const connected = devices.data?.filter(d => !d.revokedAt && d.connected) ?? [];
  const owner = connected.find(d => d.currentAudioOwner);
  const id = workHubDeviceIdentity(user?.userId)?.deviceId;
  return <>
    <p className="text-muted-foreground">{t("workHubDevices.automaticDescription")}</p>
    <div className="rounded-xl border border-[var(--brand-primary)] p-3 space-y-1">
      <p className="font-bold">{owner ? t("workHubDevices.voiceActiveOn", { device: owner.friendlyName }) : t("workHubDevices.noActiveVoice")}</p>
      <p className="text-muted-foreground">{t("workHubDevices.contentAvailable")}</p>
    </div>
    {devices.error && <p role="alert">{devices.error.message}<button type="button" className="ml-3 underline" onClick={() => void devices.refetch()}>Retry</button></p>}
    <ProfileRow label={t("workHubDevices.connectedDevices", "Connected devices")} open={open} onClick={() => setOpen(!open)}>
      {connected.map(device => { const Icon = device.deviceClass === "phone" ? Smartphone : device.deviceClass === "tablet" ? Tablet : Laptop;
        return <div key={device.id} className="flex items-center gap-3 border-b border-white/10 pb-3"><Icon className="h-5 w-5 text-[var(--brand-primary)]" /><div>
          <p className="font-bold">{device.friendlyName}{device.id === id ? ` · ${t("workHubDevices.thisDevice")}` : ""}</p>
          <p className="text-muted-foreground">{t(device.currentAudioOwner ? "workHubDevices.voiceActive" : "workHubDevices.readyForHandoff")}</p>
        </div></div>; })}
      {!connected.length && !devices.isPending && <p>{t("workHubDevices.none")}</p>}
      {devices.isPending && <p>{t("common.loading")}</p>}
    </ProfileRow>
  </>;
}
