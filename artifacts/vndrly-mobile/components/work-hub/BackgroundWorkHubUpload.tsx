import React, { useEffect, useRef, useState } from "react";
import { Image, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeToken,
  subscribeUser,
} from "@/lib/auth";
import { pickMeetingFile } from "@/lib/meeting-files";
import { scanWorkDocumentDraft } from "@/lib/native-work-capture";
import {
  beginBackgroundWorkUpload,
  beginBackgroundScannedWorkUpload,
  canBackgroundUploadWorkFile,
  cancelBackgroundWorkUpload,
  discardScannedWorkPages,
  readPendingWorkUpload,
  resumeBackgroundWorkUpload,
} from "@/lib/work-hub-background-upload-native";
type Page = Awaited<ReturnType<typeof scanWorkDocumentDraft>>["pages"][number];
type Target = {
  owner: { type: "vendor" | "partner"; id: number };
  scope: "personal" | "company" | "channel";
  channelId?: string;
};
export default function BackgroundWorkHubUpload({
  target,
  disabled,
  onAvailability,
  onSaved,
}: {
  target: Target;
  disabled: boolean;
  onAvailability: (available: boolean) => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation(),
    colors = useColors();
  const c = {
    file: t("workHubUpload.file"),
    scan: t("workHubUpload.scan"),
    review: t("workHubUpload.review"),
    upload: t("workHubUpload.upload"),
    discard: t("workHubUpload.discard"),
    resume: t("workHubUpload.resume"),
    cancel: t("workHubUpload.cancel"),
    pending: t("workHubUpload.pending"),
    transported: t("workHubUpload.transported"),
    reserved: t("workHubUpload.reserved"),
    saved: t("workHubUpload.saved"),
    unknown: t("workHubUpload.unknown"),
    failed: t("workHubUpload.failed"),
    refresh: t("workHubUpload.refresh"),
  };
  const [available, setAvailable] = useState(false),
    [pending, setPending] =
      useState<Awaited<ReturnType<typeof readPendingWorkUpload>>>(null),
    [pages, setPages] = useState<Page[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const scopeRef = useRef(captureAuthScope()),
    alive = useRef(false),
    inflight = useRef(false);
  const current = () => alive.current && isAuthScopeCurrent(scopeRef.current);
  useEffect(() => {
    alive.current = true;
    scopeRef.current = captureAuthScope();
    const invalidate = () => {
      setPages([]);
      setPending(null);
      setMessage("");
      setAvailable(false);
      onAvailability(false);
    };
    const a = subscribeUser(invalidate),
      b = subscribeToken(invalidate);
    void canBackgroundUploadWorkFile().then(async (value) => {
      if (!current()) return;
      setAvailable(value);
      onAvailability(value);
      if (value) {
        try {
          const saved = await readPendingWorkUpload();
          if (current()) setPending(saved);
        } catch {
          if (current()) setMessage(c.unknown);
        }
      }
    });
    return () => {
      alive.current = false;
      a();
      b();
    };
  }, []);
  const work = async (action: () => Promise<void>) => {
    if (inflight.current || !current()) return;
    inflight.current = true;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch {
      if (current()) {
        setMessage(c.unknown);
        try {
          const saved = await readPendingWorkUpload();
          if (current()) setPending(saved);
        } catch {}
      }
    } finally {
      inflight.current = false;
      if (current()) setBusy(false);
    }
  };
  const resume = async () => {
    const result = await resumeBackgroundWorkUpload(scopeRef.current);
    if (!current()) return;
    if (result.state === "saved") {
      setPending(null);
      setPages((currentPages) =>
        currentPages.filter((page) => page.fileId !== result.stagedFileId),
      );
      setMessage(c.saved);
      try {
        await onSaved();
      } catch {
        if (current()) setMessage(c.refresh);
      }
    } else {
      setMessage(
        result.state === "failed" || result.state === "cancelled"
          ? c.failed
          : c.reserved,
      );
      const saved = await readPendingWorkUpload();
      if (current()) setPending(saved);
    }
  };
  if (!available) return null;
  return (
    <View
      style={{
        gap: 10,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 12,
        borderRadius: 12,
      }}
    >
      <Text style={{ color: colors.mutedForeground }}>
        {t(`workHubUpload.scope.${pending?.scope ?? target.scope}`)}
      </Text>
      {message ? (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
          {message}
        </Text>
      ) : null}
      {pending ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text }}>
            {c.pending}: {pending.name}
          </Text>
          <Text style={{ color: colors.mutedForeground }}>
            {pending.transported ? c.transported : c.reserved}
          </Text>
          <TogglePillButton disabled={busy} onPress={() => void work(resume)}>
            {c.resume}
          </TogglePillButton>
          <TogglePillButton
            disabled={busy}
            onPress={() =>
              void work(async () => {
                await cancelBackgroundWorkUpload(scopeRef.current);
                if (current()) {
                  setPending(null);
                  setPages((currentPages) =>
                    currentPages.filter(
                      (page) => page.fileId !== pending?.stagedFileId,
                    ),
                  );
                  setMessage(c.failed);
                }
              })
            }
          >
            {c.cancel}
          </TogglePillButton>
        </View>
      ) : null}
      {!pending ? (
        <View style={{ gap: 8 }}>
          <TogglePillButton
            disabled={disabled || busy}
            onPress={() =>
              void work(async () => {
                const file = await pickMeetingFile("files");
                if (!current() || !file) return;
                await beginBackgroundWorkUpload(
                  { file, ...target },
                  scopeRef.current,
                );
                if (!current()) return;
                const restored = await readPendingWorkUpload();
                if (!current()) return;
                setPending(restored);
                await resume();
              })
            }
          >
            {c.file}
          </TogglePillButton>
          <TogglePillButton
            disabled={disabled || busy || pages.length > 0}
            onPress={() =>
              void work(async () => {
                const draft = await scanWorkDocumentDraft();
                if (current()) setPages(draft.pages);
              })
            }
          >
            {c.scan}
          </TogglePillButton>
        </View>
      ) : null}
      {pages.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Text style={{ color: colors.text }}>
            {c.review} ({pages.length})
          </Text>
          {pages.map((page, index) => (
            <View key={page.fileId} style={{ gap: 6 }}>
              <Image
                source={{ uri: page.uri }}
                accessibilityLabel={`${index + 1} / ${pages.length}`}
                style={{ height: 180, width: "100%", resizeMode: "contain" }}
              />
              <Text style={{ color: colors.mutedForeground }}>
                {index + 1} / {pages.length}
              </Text>
              <TogglePillButton
                disabled={disabled || busy || !!pending}
                onPress={() =>
                  void work(async () => {
                    await beginBackgroundScannedWorkUpload(
                      {
                        page,
                        name: `scanned-page-${index + 1}.jpg`,
                        ...target,
                      },
                      scopeRef.current,
                    );
                    if (!current()) return;
                    const restored = await readPendingWorkUpload();
                    if (!current()) return;
                    setPending(restored);
                    await resume();
                  })
                }
              >
                {c.upload} {index + 1}
              </TogglePillButton>
            </View>
          ))}
          <TogglePillButton
            disabled={busy}
            onPress={() =>
              void work(async () => {
                await discardScannedWorkPages(
                  pages
                    .filter((page) => page.fileId !== pending?.stagedFileId)
                    .map((page) => page.fileId),
                  scopeRef.current,
                );
                if (current())
                  setPages(
                    pages.filter(
                      (page) => page.fileId === pending?.stagedFileId,
                    ),
                  );
              })
            }
          >
            {c.discard}
          </TogglePillButton>
        </View>
      ) : null}
    </View>
  );
}
