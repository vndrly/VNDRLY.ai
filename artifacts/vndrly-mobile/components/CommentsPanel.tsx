import { Feather } from "@expo/vector-icons";
import { Image as ExpoImage } from "expo-image";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import AmberButton from "@/components/AmberButton";
import LayeredPillButton from "@/components/LayeredPillButton";
import { useRateLimitGate } from "@/hooks/use-rate-limit-gate";
import { useColors } from "@/hooks/useColors";
import { apiFetch, getApiBase } from "@/lib/api";
import { translateApiError } from "@/lib/apiErrors";
import { getUser, type StoredUser } from "@/lib/auth";
import {
  isPttComment,
  playPttUri,
  pttAttachmentPlayUri,
  pttDurationLabel,
} from "@/lib/ptt";
import { captureAndUploadImage, pickAndUploadImage } from "@/lib/photos";

type Comment = {
  id: number;
  content: string;
  attachments: string[] | null;
  mentions: number[] | null;
  editHistory: { at: string; prev: string }[] | null;
  updatedAt: string | null;
  deletedAt: string | null;
  deletedById: number | null;
  createdAt: string;
  createdById: number | null;
  createdByName: string | null;
  createdByRole: string | null;
  seenBy: { userId: number; seenAt: string }[];
  seenCount: number;
};

type Props = {
  source: "ticket" | "hotlist";
  parentId: number;
  isEditable?: boolean;
  hideHeader?: boolean;
  onCommentsChanged?: () => void;
};

const PHOTO_PREFIX = "[photo] ";

function objectUrl(objectPath: string): string {
  const base = getApiBase();
  let suffix = objectPath;
  if (suffix.startsWith("/objects/")) suffix = suffix.slice("/objects/".length);
  else if (suffix.startsWith("objects/")) suffix = suffix.slice("objects/".length);
  else if (suffix.startsWith("/")) suffix = suffix.slice(1);
  return `${base}/api/storage/objects/${suffix}`;
}

function legacyPhotoUrl(content: string): string | null {
  if (!content.startsWith(PHOTO_PREFIX)) return null;
  const path = content.slice(PHOTO_PREFIX.length).trim();
  return path ? objectUrl(path) : null;
}

function timeAgo(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const ts = new Date(iso).getTime();
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return t("comments.ago.second", { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t("comments.ago.minute", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("comments.ago.hour", { n: h });
  const d = Math.floor(h / 24);
  return t("comments.ago.day", { n: d });
}

export default function CommentsPanel({
  source,
  parentId,
  isEditable = true,
  hideHeader = false,
  onCommentsChanged,
}: Props) {
  const colors = useColors();
  const { t } = useTranslation();
  const [me, setMe] = useState<StoredUser | null>(null);
  const [playingPttId, setPlayingPttId] = useState<number | null>(null);
  useEffect(() => { getUser().then(setMe).catch(() => {}); }, []);

  const basePath = source === "ticket"
    ? `/api/tickets/${parentId}/comments`
    : `/api/hotlist/jobs/${parentId}/comments`;

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  // Task #699 — gate comment-list refetches when /api/.../comments
  // returns 429 with code "comments.rate_limited". Surfaces a friendly
  // slow-down banner above the form so users see why the thread paused.
  const [loadError, setLoadError] = useState<unknown>(null);
  const { rateLimited, retryAfterSeconds } = useRateLimitGate(
    loadError,
    "comments.rate_limited",
  );

  const load = useCallback(async () => {
    try {
      const cs = await apiFetch<Comment[]>(basePath);
      setComments(cs || []);
      setLoadError(null);
    } catch (e) {
      // Park on rate-limit; other failures are non-fatal here (the
      // existing UX shows the loading spinner falling away to whatever
      // we last had — the post action surfaces its own error alerts).
      const status = (e as { status?: unknown })?.status;
      if (status === 429) setLoadError(e);
    } finally {
      setLoading(false);
    }
  }, [basePath]);

  useEffect(() => {
    if (rateLimited) return;
    load();
  }, [load, rateLimited]);

  const post = async () => {
    if (!content.trim() && attachments.length === 0) return;
    setPosting(true);
    try {
      await apiFetch(basePath, {
        method: "POST",
        body: JSON.stringify({ content: content.trim(), attachments }),
      });
      setContent("");
      setAttachments([]);
      await load();
      onCommentsChanged?.();
    } catch (e: unknown) {
      Alert.alert(
        t("comments.couldntPost"),
        translateApiError(e, t, t("comments.tryAgain")),
      );
    } finally {
      setPosting(false);
    }
  };

  const removeComment = async (id: number) => {
    Alert.alert(t("comments.removeTitle"), t("comments.removeBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.remove"),
        style: "destructive",
        onPress: async () => {
          try {
            await apiFetch(`${basePath}/${id}`, { method: "DELETE" });
            load();
          } catch (e: any) {
            Alert.alert(t("comments.failed"), String(e?.message ?? ""));
          }
        },
      },
    ]);
  };

  const attachFromCamera = async () => {
    try {
      const r = await captureAndUploadImage();
      if (r) setAttachments((a) => [...a, `${getApiBase()}/api/storage${r.objectPath}`]);
    } catch (e: any) {
      Alert.alert(t("comments.camera"), e?.message ?? t("comments.actionFailed"));
    }
  };
  const attachFromLibrary = async () => {
    try {
      const r = await pickAndUploadImage();
      if (r) setAttachments((a) => [...a, `${getApiBase()}/api/storage${r.objectPath}`]);
    } catch (e: any) {
      Alert.alert(t("comments.library"), e?.message ?? t("comments.actionFailed"));
    }
  };

  const playPttComment = async (comment: Comment) => {
    const url = comment.attachments?.[0];
    if (!url) return;
    setPlayingPttId(comment.id);
    try {
      await playPttUri(pttAttachmentPlayUri(url));
    } catch {
      Alert.alert(t("foremanHome.pttPlayFailed"));
    } finally {
      setPlayingPttId(null);
    }
  };

  if (loading) {
    return <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />;
  }

  return (
    <View style={{ marginTop: 12 }}>
      {hideHeader ? null : (
        <Text style={[styles.section, { color: colors.foreground }]}>{t("comments.log")}</Text>
      )}

      {rateLimited ? (
        <View
          style={[
            styles.slowDownBanner,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
          accessibilityRole="alert"
          testID="comments-slow-down-banner"
        >
          <Feather name="clock" size={14} color={colors.mutedForeground} />
          <Text style={[styles.slowDownText, { color: colors.mutedForeground }]}>
            {retryAfterSeconds != null
              ? t("comments.slowDown.retryIn", { seconds: retryAfterSeconds })
              : t("comments.slowDown.brief")}
          </Text>
        </View>
      ) : null}

      {comments.map((c) => {
        const photoUrls = c.attachments && c.attachments.length
          ? c.attachments
          : legacyPhotoUrl(c.content)
            ? [legacyPhotoUrl(c.content)!]
            : [];
        const isPtt = isPttComment(c.content);
        const pttUrl =
          !c.deletedAt && c.attachments?.[0] && (isPtt || /\.m4a|\.mp3|audio/i.test(c.attachments[0]))
            ? c.attachments[0]
            : null;
        const isAuthor = c.createdById === me?.id;
        const isAdmin = me?.role === "admin";
        const canDelete = (isAuthor || isAdmin) && !c.deletedAt;
        const showText = c.attachments && c.attachments.length
          ? isPtt
            ? null
            : c.content
          : legacyPhotoUrl(c.content)
            ? null
            : isPtt
              ? null
              : c.content;
        return (
          <View
            key={c.id}
            style={[styles.note, { borderColor: colors.border, backgroundColor: c.deletedAt ? colors.muted : colors.card }]}
          >
            <View style={{ flexDirection: "row" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 11, marginBottom: 4 }}>
                  {(c.createdByName ?? t("comments.unknown"))}
                  {c.createdByRole ? ` (${c.createdByRole.replace(/_/g, " ")})` : ""}
                  {" · "}{timeAgo(c.createdAt, t)}
                  {c.editHistory && c.editHistory.length > 0 && !c.deletedAt ? ` · ${t("comments.edited")}` : ""}
                </Text>
                {showText ? (
                  <Text style={{ color: colors.foreground, fontStyle: c.deletedAt ? "italic" : "normal" }}>
                    {showText}
                  </Text>
                ) : null}
                {pttUrl ? (
                  <Pressable
                    onPress={() => void playPttComment(c)}
                    style={[styles.pttRow, { borderColor: colors.border }]}
                    testID={`comment-ptt-${c.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t("foremanHome.pttVoice")}
                  >
                    <View
                      style={[
                        styles.pttPlayCircle,
                        { backgroundColor: `${colors.primary}33` },
                      ]}
                    >
                      {playingPttId === c.id ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Feather name="play" size={16} color={colors.primary} />
                      )}
                    </View>
                    <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}>
                      {pttDurationLabel(c.content) ?? t("foremanHome.pttVoice")}
                    </Text>
                  </Pressable>
                ) : null}
                {photoUrls.length > 0 && !c.deletedAt && (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                    {photoUrls.map((u) => (
                      <Pressable key={u} onPress={() => setPreviewPhoto(u)}>
                        <ExpoImage
                          source={{ uri: u }}
                          style={{ width: 80, height: 80, borderRadius: 6 }}
                          contentFit="cover"
                          transition={150}
                        />
                      </Pressable>
                    ))}
                  </View>
                )}
                <Text style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 6 }}>
                  {t("comments.seenBy", { count: c.seenCount })}
                </Text>
              </View>
              {canDelete ? (
                <TouchableOpacity onPress={() => removeComment(c.id)} style={styles.iconBtn}>
                  <Feather name="trash-2" size={16} color={colors.destructive} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        );
      })}

      {comments.length === 0 ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginVertical: 8 }}>
          {t("comments.noComments")}
        </Text>
      ) : null}

      {isEditable ? (
        <View style={[styles.formCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <TextInput
            value={content}
            onChangeText={setContent}
            multiline
            placeholder={t("comments.addNotePlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { borderColor: colors.border, color: colors.foreground, minHeight: 60, textAlignVertical: "top" }]}
          />
          {attachments.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {attachments.map((u) => (
                <View key={u} style={{ position: "relative" }}>
                  <Image source={{ uri: u }} style={{ width: 60, height: 60, borderRadius: 4 }} resizeMode="cover" />
                  <TouchableOpacity
                    onPress={() => setAttachments((a) => a.filter((x) => x !== u))}
                    style={{ position: "absolute", top: -6, right: -6, backgroundColor: colors.background, borderRadius: 10, padding: 2 }}
                  >
                    <Feather name="x" size={12} color={colors.foreground} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <TouchableOpacity
              onPress={attachFromCamera}
              style={[styles.smallBtn, { borderWidth: 1, borderColor: colors.border, flexDirection: "row", gap: 6 }]}
            >
              <Feather name="camera" size={14} color={colors.foreground} />
              <Text style={{ color: colors.foreground, fontSize: 12 }}>{t("comments.camera")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={attachFromLibrary}
              style={[styles.smallBtn, { borderWidth: 1, borderColor: colors.border, flexDirection: "row", gap: 6 }]}
            >
              <Feather name="image" size={14} color={colors.foreground} />
              <Text style={{ color: colors.foreground, fontSize: 12 }}>{t("comments.library")}</Text>
            </TouchableOpacity>
            <LayeredPillButton
              onPress={post}
              disabled={posting}
              loading={posting}
              height={32}
              style={{ marginLeft: "auto" }}
              testID="button-post-comment"
            >
              <Text style={{ color: "#ffffff", fontFamily: "Inter_600SemiBold", fontSize: 12, textShadowColor: "rgba(0,0,0,0.35)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 1 }}>
                {t("comments.post")}
              </Text>
            </LayeredPillButton>
          </View>
        </View>
      ) : null}

      <Modal visible={!!previewPhoto} transparent onRequestClose={() => setPreviewPhoto(null)}>
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.9)", alignItems: "center", justifyContent: "center" }}
          onPress={() => setPreviewPhoto(null)}
        >
          {previewPhoto ? (
            <Image source={{ uri: previewPhoto }} style={{ width: "90%", height: "70%" }} resizeMode="contain" />
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontFamily: "Inter_700Bold", fontSize: 16, marginTop: 12, marginBottom: 6 },
  slowDownBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  slowDownText: { fontFamily: "Inter_500Medium", fontSize: 12, flex: 1 },
  note: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 8 },
  formCard: { borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 6, padding: 8 },
  smallBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  iconBtn: { padding: 6 },
  pttRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  pttPlayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});
