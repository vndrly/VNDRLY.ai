import {LibraryEntryNoticeSchema} from "@workspace/api-zod";
import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { z } from "zod/v4";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import {
  workHubRequest,
  ownerForUser,
  commandEnvelope,
} from "@/lib/work-hub-client";
import BrandPillButton from "@/components/brand-pill-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
const schema = LibraryEntryNoticeSchema;
type Row = z.infer<typeof schema>["present"][number];
export default function LibraryEntryNotice({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation(),
    { user } = useAuth(),
    [path, navigate] = useLocation(),
    owner = ownerForUser(user),
    identity = [
      user?.userId,
      user?.activeMembershipId,
      owner?.type,
      owner?.id,
    ].join(":"),
    current = useRef(identity);
  current.current = identity;
  const [data, setData] = useState<{ identity: string; items: Row[] }>({
      identity: "",
      items: [],
    }),
    [dismissed, setDismissed] = useState<string[]>([]);
  const essential =
      /^\/(?:safety|ticket|tickets|scan|work-hub\/(?:calls|chat|meeting|training|checklist))(?:\/|$)/.test(
        path,
      ),
    workplace =
      path === "/" ||
      path.startsWith("/work-hub") ||
      path === "/dashboard" ||
      path === "/foreman";
  const items = data.identity === identity ? data.items : [],
    shown = items.filter((i) => !dismissed.includes(i.instanceId)).slice(0, 3),
    visible = enabled && workplace && !essential && shown.length > 0;
  useEffect(() => {
    setData({ identity, items: [] });
    setDismissed([]);
    if (!enabled || !owner) return;
    let active = true,
      running = false;
    const controller = new AbortController();
    const load = async () => {
      if (!active || running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const result = schema.parse(
          await workHubRequest("/library/entry", {
            method: "POST",
            body: "{}",
            signal: controller.signal,
          }),
        );
        if (active && current.current === identity)
          setData({ identity, items: result.present });
      } catch {
        /* An unavailable rollout API must not block access to the portal. */
      } finally {
        running = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60000);
    document.addEventListener("visibilitychange", load);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [enabled, identity]);
  useEffect(() => {
    if (!visible || !owner) return;
    for (const item of shown)
      void workHubRequest(`/library/instances/${item.instanceId}/presented`, {
        method: "POST",
        body: JSON.stringify(
          commandEnvelope(owner, {}, undefined, item.assignment.version),
        ),
      }).catch(() => undefined);
  }, [visible, data, identity]);
  return (
    <Dialog
      open={visible}
      onOpenChange={(open) => {
        if (!open) setDismissed(items.map((i) => i.instanceId));
      }}
    >
      <DialogContent className="border-2 border-[color:var(--brand-primary)]">
        <DialogHeader>
          <DialogTitle>{t("workHubLibrary.newAssignments")}</DialogTitle>
        </DialogHeader>
        {shown.map((item) => (
          <BrandPillButton
            key={item.instanceId}
            tone="brand"
            onClick={() => {
              setDismissed(items.map((i) => i.instanceId));
              navigate(
                `/work-hub/${item.kind === "training" ? "training" : "checklist"}/${item.instanceId}`,
              );
            }}
          >
            {item.title}
          </BrandPillButton>
        ))}
        <BrandPillButton
          tone="brand"
          onClick={() => setDismissed(items.map((i) => i.instanceId))}
        >
          {t("workHubLibrary.close")}
        </BrandPillButton>
      </DialogContent>
    </Dialog>
  );
}
