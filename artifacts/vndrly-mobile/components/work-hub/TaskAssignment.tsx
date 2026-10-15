import LibraryAssignmentReview from "./library/AssignmentReview";
import React, { useEffect, useRef, useState } from "react";
import { Modal, ScrollView, Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { mobileOwner, mobileCommandEnvelope } from "@/lib/work-hub-mobile";
import TogglePillButton from "../TogglePillButton";
type Person = { id: number; displayName: string; sameCompany: boolean };
export default function TaskAssignment({
  onSaved,
}: {
  onSaved: () => Promise<unknown>;
}) {
  const { user } = useAuth(),
    colors = useColors(),
    owner = mobileOwner(user);
  const identity = [
    user?.id,
    user?.activeMembershipId,
    owner?.type,
    owner?.id,
  ].join(":");
  const [open, setOpen] = useState(false),
    [kind, setKind] = useState<"task" | "form" | "policy" | "training">("task"),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [search, setSearch] = useState(""),
    [assignee, setAssignee] = useState<number | null>(null),
    [people, setPeople] = useState<Person[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [notice, setNotice] = useState("");
  const pending = useRef<{
      path: string;
      body: string;
      scope: ReturnType<typeof captureAuthScope>;
      identity: string;
    } | null>(null),
    sending = useRef(false);
  useEffect(() => {
    pending.current = null;
    setOpen(false);
    setPeople([]);
    setAssignee(null);
    setTitle("");
    setDescription("");
    setNotice("");
    setSearch("");
  }, [identity]);
  useEffect(() => {
    if (!open || !owner) return;
    const scope = captureAuthScope();
    let active = true;
    setLoading(true);
    apiFetch<Person[]>("/api/work-hub/people", undefined, scope)
      .then((p) => {
        if (!active || !isAuthScopeCurrent(scope)) return;
        setPeople(p.filter((x) => x.sameCompany));
      })
      .catch((e) => {
        if (active && isAuthScopeCurrent(scope))
          setNotice(
            e instanceof Error
              ? e.message
              : "Could not load assignment choices",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, identity]);
  const submit = async () => {
    if (!owner || sending.current) return;
    if (!pending.current) {
      if (!assignee) {
        setNotice("Choose who should receive this assignment.");
        return;
      }
      if (kind === "task" && !title.trim()) {
        setNotice("Enter a task title.");
        return;
      }
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        priority: "normal",
        assigneeUserId: assignee,
      };
      pending.current = {
        path: "/api/work-hub/tasks",
        body: JSON.stringify(
          mobileCommandEnvelope(
            owner,
            payload,
            undefined,
            { kind: "organization", id: owner.id },
            Crypto.randomUUID(),
          ),
        ),
        scope: captureAuthScope(),
        identity,
      };
    }
    const attempt = pending.current;
    if (attempt.identity !== identity || !isAuthScopeCurrent(attempt.scope)) {
      pending.current = null;
      setNotice("Company changed. Reopen the assignment.");
      return;
    }
    sending.current = true;
    setBusy(true);
    setNotice("");
    try {
      const result = await apiFetch<{
        operationId: string;
        resource: { id: string; assigneeUserId: number };
      }>(attempt.path, { method: "POST", body: attempt.body }, attempt.scope);
      if (!isAuthScopeCurrent(attempt.scope)) return;
      if (
        result.operationId !== JSON.parse(attempt.body).operationId ||
        !result.resource?.id ||
        result.resource.assigneeUserId !== assignee
      )
        throw Error(
          "Assignment result could not be verified. Retry the original request.",
        );
      pending.current = null;
      setOpen(false);
      setTitle("");
      setDescription("");
      setNotice("Assignment saved.");
      await onSaved();
    } catch (e) {
      if (isAuthScopeCurrent(attempt.scope)) {
        const status = (e as { status?: number }).status;
        if (status && status >= 400 && status < 500) pending.current = null;
        setNotice(
          e instanceof Error
            ? e.message
            : "Assignment could not be confirmed. Retry the original request.",
        );
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const field = {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 10,
    padding: 12,
    color: colors.text,
  };
  return (
    <View style={{ gap: 10 }}>
      <TogglePillButton
        color="brand"
        onPress={() => {
          setNotice("");
          setOpen(true);
        }}
      >
        Create assignment
      </TogglePillButton>
      {!open && !!notice && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
          {notice}
        </Text>
      )}
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setOpen(false);
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.65)",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderWidth: 2,
              borderColor: colors.primary,
              borderRadius: 14,
              padding: 16,
              maxWidth: 600,
              width: "100%",
              maxHeight: "90%",
              alignSelf: "center",
              gap: 12,
            }}
          >
            <Text
              style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}
            >
              Create assignment
            </Text>
            <TogglePillButton
              color="brand"
              disabled={busy}
              onPress={() => setOpen(false)}
            >
              Close
            </TogglePillButton>
            <ScrollView contentContainerStyle={{ gap: 12 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {(["task", "form", "policy", "training"] as const).map((k) => (
                  <TogglePillButton
                    key={k}
                    color="brand"
                    solid={kind === k}
                    disabled={busy || !!pending.current}
                    onPress={() => setKind(k)}
                  >
                    {
                      {
                        task: "Task",
                        form: "Form",
                        policy: "Policy Acknowledgment",
                        training: "Training",
                      }[k]
                    }
                  </TogglePillButton>
                ))}
              </View>
              {kind !== "task" ? (
                <LibraryAssignmentReview
                  kind={kind}
                  onSaved={async () => {
                    setOpen(false);
                    await onSaved();
                  }}
                />
              ) : (
                <>
                  <>
                    <TextInput
                      accessibilityLabel="Task title"
                      placeholder="Task title"
                      value={title}
                      editable={!busy && !pending.current}
                      onChangeText={setTitle}
                      style={field}
                    />
                    <TextInput
                      accessibilityLabel="Task instructions"
                      placeholder="Instructions (optional)"
                      multiline
                      value={description}
                      editable={!busy && !pending.current}
                      onChangeText={setDescription}
                      style={field}
                    />
                  </>
                  <Text style={{ color: colors.text }}>Assign to</Text>
                  <TextInput
                    accessibilityLabel="Find assignee"
                    placeholder="Search company members"
                    value={search}
                    onChangeText={setSearch}
                    style={field}
                  />
                  {loading && (
                    <Text style={{ color: colors.text }}>
                      Loading assignment choices…
                    </Text>
                  )}
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                  >
                    {people
                      .filter((p) =>
                        p.displayName
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((p) => (
                        <TogglePillButton
                          key={p.id}
                          color="brand"
                          solid={assignee === p.id}
                          disabled={busy || !!pending.current}
                          onPress={() => setAssignee(p.id)}
                        >
                          {p.displayName}
                        </TogglePillButton>
                      ))}
                  </View>
                  {!!notice && (
                    <Text
                      accessibilityLiveRegion="polite"
                      style={{ color: colors.text }}
                    >
                      {notice}
                    </Text>
                  )}
                  <TogglePillButton
                    color="brand"
                    disabled={busy || loading}
                    onPress={() => void submit()}
                  >
                    {busy
                      ? "Saving…"
                      : pending.current
                        ? "Retry original assignment"
                        : "Assign"}
                  </TogglePillButton>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
