import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, Radio, Server, VideoOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type CameraChannel = {
  id: string;
  name: string;
  enabled: boolean;
  status: string;
};
type CameraDevice = {
  id: string;
  name: string;
  status: string;
  manufacturer: string | null;
  model: string | null;
  adapter: string;
  channels: CameraChannel[];
};
type CameraGateway = {
  id: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
  devices: CameraDevice[];
};
type CameraRegistryResponse = { gateways: CameraGateway[] };
type PlaybackDescriptor = { protocol: "hls"; url: string; expiresAt: string };

function statusVariant(status: string) {
  return status === "online" ? "default" : "secondary";
}

export default function CameraCenterPage({ siteId }: { siteId: number }) {
  const { t } = useTranslation();
  const [active, setActive] = useState<{ channel: CameraChannel; playback: PlaybackDescriptor } | null>(null);
  const registry = useQuery({
    queryKey: ["camera-registry", siteId],
    queryFn: async () => {
      const response = await fetch(`${BASE}/api/sites/${siteId}/cameras`, { credentials: "include" });
      if (!response.ok) throw new Error(`camera registry status ${response.status}`);
      return response.json() as Promise<CameraRegistryResponse>;
    },
    refetchInterval: 30_000,
  });
  const playback = useMutation({
    mutationFn: async (channel: CameraChannel) => {
      const response = await fetch(`${BASE}/api/camera-channels/${channel.id}/playback`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ protocol: "hls" }),
      });
      if (!response.ok) throw new Error(`camera playback status ${response.status}`);
      return { channel, playback: (await response.json()) as PlaybackDescriptor };
    },
    onSuccess: setActive,
  });

  return (
    <div className="p-6 space-y-6" data-testid="page-camera-center">
      <div className="flex items-center gap-3">
        <ContentPaneBackLink href={`/site-locations/${siteId}`} />
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Camera className="h-6 w-6 text-amber-500" />
            {t("cameraCenter.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("cameraCenter.subtitle")}</p>
        </div>
      </div>

      {active ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="h-4 w-4 text-emerald-500" />
              {active.channel.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <video
              aria-label={t("cameraCenter.liveLabel", { name: active.channel.name })}
              className="w-full max-h-[65vh] rounded-md bg-black"
              controls
              autoPlay
              playsInline
              src={active.playback.url}
            />
          </CardContent>
        </Card>
      ) : null}

      {registry.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : registry.isError ? (
        <p className="text-destructive">{t("cameraCenter.loadError")}</p>
      ) : registry.data?.gateways.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <VideoOff className="mx-auto mb-3 h-8 w-8" />
            {t("cameraCenter.empty")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {registry.data?.gateways.map((gateway) => (
            <Card key={gateway.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3 text-base">
                  <span className="flex items-center gap-2">
                    <Server className="h-4 w-4" />
                    {gateway.name}
                  </span>
                  <Badge variant={statusVariant(gateway.status)}>
                    {t(`cameraCenter.status.${gateway.status === "online" ? "online" : "offline"}`)}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {gateway.devices.map((device) => (
                  <div key={device.id} className="rounded-md border p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">{device.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {[device.manufacturer, device.model].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <Badge variant={statusVariant(device.status)}>
                        {t(`cameraCenter.status.${device.status === "online" ? "online" : "offline"}`)}
                      </Badge>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {device.channels.map((channel) => {
                        const available =
                          gateway.status === "online" &&
                          device.status === "online" &&
                          channel.status === "online" &&
                          channel.enabled;
                        return (
                          <div key={channel.id} className="flex items-center justify-between gap-3 rounded border bg-muted/20 p-3">
                            <div>
                              <div className="text-sm font-medium">{channel.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {t(`cameraCenter.status.${available ? "online" : "offline"}`)}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              disabled={!available || playback.isPending}
                              onClick={() => playback.mutate(channel)}
                            >
                              {t("cameraCenter.viewLive")}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {playback.isError ? <p className="text-destructive">{t("cameraCenter.playbackError")}</p> : null}
    </div>
  );
}
