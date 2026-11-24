import SphereBackButton from "@/components/SphereBackButton";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, ScrollView, Text, TextInput, View, StyleSheet } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { pickMeetingFile } from "@/lib/meeting-files";
import Button from "@/components/ProfileMiniCardButton";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import ProviderLogo from "./ProviderLogo";
import { curatedMailFolders } from "./curated-mail-folders";
import {
  request,
  useAccounts,
  useInboxCounts,
  useConnectorScope,
  enc,
  type Account,
  type Row,
  type Selection,
} from "./connector-client";
// Poll only while this screen is visible and the app is active.
function useLiveInterval(): number | false {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(AppState.currentState === "active");
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => setActive(state === "active"));
    return () => subscription.remove();
  }, []);
  return focused && active ? 30_000 : false;
}
function Label({ children, branded = false }: { children: React.ReactNode; branded?: boolean }) {
  const brand = useBrand();
  return <Text style={{ color: branded ? brand.primary : "#eee" }}>{children}</Text>;
}
function ErrorText({ error }: { error: unknown }) {
  return error ? (
    <Text accessibilityRole="alert" style={{ color: "#eee" }}>
      {error instanceof Error ? error.message : String(error)}
    </Text>
  ) : null;
}
function Action({
  children,
  onPress,
  disabled = false,
}: {
  children: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const brand = useBrand();
  return (
    <Button borderColor={brand.primary} disabled={disabled} onPress={onPress}>
      {children}
    </Button>
  );
}
function Toggle({
  brandedCount = false,
  label,
  onPress,
  open,
  children,
}: {
  brandedCount?: boolean;
  label: string;
  onPress: () => void;
  open?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View style={{ paddingVertical: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onPress}
        style={{
          minHeight: 44,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Label>
          {open ? "▾" : "▸"} {brandedCount ? label.replace(/ \([^()]*\)$/, "") : label}
          {brandedCount && / \([^()]*\)$/.test(label) && <Label branded>{label.match(/ \([^()]*\)$/)?.[0]}</Label>}
        </Label>
      </Pressable>
      {open && children}
    </View>
  );
}
export function ConnectorTree({
  kind,
  onSelect,
}: {
  kind: Selection["kind"];
  onSelect: (s: Selection) => void;
}) {
  const accounts = useAccounts(),
    [open, setOpen] = useState(kind !== "email");
  const inbox = useInboxCounts(kind === "email" ? accounts.data?.accounts : []);
  const content = (
    <>
      <ErrorText error={accounts.error} />
      {accounts.isLoading && <Label>Loading accounts…</Label>}
      {accounts.data?.accounts
        .filter((a) =>
          kind === "email"
            ? ["gmail", "outlook"].includes(a.provider)
            : ["teams", "slack"].includes(a.provider),
        )
        .map((a) => (
          <AccountTree key={a.id} account={a} kind={kind} count={inbox.counts[a.id]} onSelect={onSelect} />
        ))}
    </>
  );
  return kind === "email" ? (
    <Toggle brandedCount label={`Emails (${accounts.isLoading ? "…" : inbox.total ?? "…"})`} open={open} onPress={() => setOpen((v) => !v)}>
      {content}
    </Toggle>
  ) : (
    content
  );
}
function AccountTree({
  count,
  account,
  kind,
  onSelect,
}: {
  count?: number;
  account: Account;
  kind: Selection["kind"];
  onSelect: (s: Selection) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ marginLeft: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <ProviderLogo provider={account.provider} size={16} />
        <Toggle
          brandedCount={kind === "email"}
          label={kind === "email" ? `${account.label} (${count ?? "…"})` : account.label}
          open={open}
          onPress={() => setOpen((v) => !v)}
        />
      </View>
      {open &&
        (account.status !== "connected" ? (
          <Label>Reconnect this account below.</Label>
        ) : (
          <FolderTree account={account} kind={kind} onSelect={onSelect} />
        ))}
    </View>
  );
}
function FolderTree({
  activeFolderId,
  expandable = true,
  expandedFolderId,
  onToggleFolder,
  paneMode = false,
  account,
  kind,
  onSelect,
  parent,
}: {
  account: Account;
  kind: Selection["kind"];
  onSelect: (s: Selection) => void;
  parent?: Row;
  expandable?: boolean;
  activeFolderId?: string;
  expandedFolderId?: string;
  onToggleFolder?: (folder: Row) => void;
  paneMode?: boolean;
}) {
  const [cursor, setCursor] = useState<string>(),
    [previous, setPrevious] = useState<Row[]>([]),
    scope = useConnectorScope();
  const params = new URLSearchParams({
    ...(cursor ? { cursor } : {}),
    ...(kind !== "email" ? { kind } : {}),
    ...(parent
      ? kind === "email"
        ? { parent: parent.id }
        : { team: parent.id }
      : {}),
  });
  const path = `/accounts/${account.id}/${kind === "email" ? "folders" : "conversations"}?${params}`;
  const q = useQuery({
    refetchInterval: useLiveInterval(),
    staleTime: 60_000,
    queryKey: ["comms-folders", scope, path],
    queryFn: ({ signal }) =>
      request<{ items: Row[]; next?: string }>(path, undefined, signal),
    retry: false,
  });
  const counts = useQuery({
    queryKey: ["comms-folder-counts", scope, path],
    queryFn: ({signal}) => request<Record<string, number>>(path.replace("/folders?", "/folder-counts?"), undefined, signal),
    enabled: kind === "email",
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  return (
    <View style={{ marginLeft: 12 }}>
      <ErrorText error={q.error} />
      {q.isLoading && <Label>Loading…</Label>}
      {(kind === "email" && !parent ? curatedMailFolders([...previous, ...(q.data?.items || [])], account.provider) : [...previous, ...(q.data?.items || [])]).map((f) => (
        <FolderRow
          key={f.id}
          active={activeFolderId === f.id}
          activeFolderId={activeFolderId}
          expandable={expandable}
          expandedFolderId={expandedFolderId}
          onToggleFolder={onToggleFolder}
          paneMode={paneMode}
          showChildren={kind === "email" && (!!parent || f.name === "Inbox")}
          count={counts.data?.[f.id]}
          folder={f}
          account={account}
          kind={kind}
          onSelect={onSelect}
        />
      ))}
      {q.data?.next && (
        <Action
          onPress={() => {
            setPrevious((v) => [...v, ...q.data!.items]);
            setCursor(q.data!.next);
          }}
        >
          More folders
        </Action>
      )}
    </View>
  );
}
function FolderRow({
  active = false,
  activeFolderId,
  expandable,
  expandedFolderId,
  onToggleFolder,
  paneMode = false,
  showChildren,
  count,
  account,
  kind,
  onSelect,
  folder,
}: {
  count?: number;
  expandable: boolean;
  expandedFolderId?: string;
  onToggleFolder?: (folder: Row) => void;
  paneMode?: boolean;
  showChildren: boolean;
  active?: boolean;
  activeFolderId?: string;
  account: Account;
  kind: Selection["kind"];
  onSelect: (s: Selection) => void;
  folder: Row;
}) {
  const brand = useBrand();
  const [open, setOpen] = useState(false),
    scope = useConnectorScope();
  const expanded = paneMode ? expandedFolderId === folder.id : open;
  const q = useQuery({
    refetchInterval: useLiveInterval(),
    staleTime: 30_000,
    queryKey: ["comms-mail", scope, account.id, folder.id, undefined, ""],
    enabled: expandable && expanded && kind === "email" && !paneMode,
    queryFn: ({ signal }) =>
      request<{ items: Row[] }>(
        `/accounts/${account.id}/messages?folder=${enc(folder.id)}`,
        undefined,
        signal,
      ),
    retry: false,
  });
  if (folder.team)
    return (
      <Toggle
        label={folder.name || "Team"}
        open={open}
        onPress={() => setOpen((v) => !v)}
      >
        {expandable && open && (
          <FolderTree
            account={account}
            kind={kind}
            parent={folder}
            onSelect={onSelect}
          />
        )}
      </Toggle>
    );
  return (
    <View style={kind === "email" ? { borderBottomWidth: 1, borderBottomColor: "#3b3d40" } : undefined}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {kind === "email" && expandable && (
          <Pressable
            accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${folder.name}`}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => onToggleFolder ? onToggleFolder(folder) : setOpen((v) => !v)}
            style={{ padding: 12 }}
          >
            <Label>{expanded ? "▾" : "▸"}</Label>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => onSelect({ account, kind, folder })}
          style={{ flex: 1, paddingVertical: 12, paddingLeft: kind === "email" && /^inbox\//i.test(folder.name ?? "") ? 20 : 0 }}
        >
          <Text numberOfLines={1} style={{color:"#eee",fontWeight:active?"700":"400"}}>
            {kind === "email" ? (folder.name ?? folder.id).replace(/^inbox\//i, "") : folder.name}
            {kind !== "email" && folder.unread ? ` (${folder.unread})` : ""}
          </Text>
        </Pressable>
        {kind === "email" && <Text style={{ color: brand.primary, fontSize: 12 }}>{count ?? "…"}</Text>}
      </View>
      {expandable && expanded && !paneMode && (
        <View style={{ marginLeft: 20 }}>
          <ErrorText error={q.error} />
          {q.isLoading && <Label>Loading messages…</Label>}
          {q.data?.items.map((m) => (
            <Pressable
              key={m.id}
              accessibilityRole="button"
              onPress={() => onSelect({ account, kind, folder, message: m })}
              style={({pressed}) => [styles.row, {backgroundColor: pressed ? "#ffffff22" : "transparent"}]}
            >
              <Text
                style={{ color: "white", fontWeight: m.unread ? "700" : "400" }}
              >
                {m.subject}
              </Text>
              <Label>{m.from}</Label>
            </Pressable>
          ))}
          {!!folder.children && (
            <FolderTree
              account={account}
              kind={kind}
              parent={folder}
              onSelect={onSelect}
            />
          )}
        </View>
      )}
      {showChildren && account.provider === "outlook" && !!folder.children && (!paneMode || expanded) && (
        <FolderTree account={account} kind="email" parent={folder} onSelect={onSelect} expandable={false} activeFolderId={activeFolderId} />
      )}
    </View>
  );
}
export default function ConnectedWorkspace({
  onBack,
  selection,
  onSelect,
}: {
  onBack?: () => void;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
}) {
  const accounts = useAccounts(),
    brand = useBrand(),
    colors = useColors();
  const mail =
    accounts.data?.accounts.filter((a) =>
      ["outlook", "gmail"].includes(a.provider),
    ) || [];
  const content = (
      <View
        style={{
          flex: selection?.kind === "email" ? 1 : undefined,
          minHeight: 0,
          borderColor: brand.primary,
          borderWidth: 2,
          borderRadius: 14,
          padding: 14,
          gap: 12,
          backgroundColor: colors.card,
        }}
      >
        {!selection ? (
          <>
            <Label>Email accounts</Label>
            <ErrorText error={accounts.error} />
            {accounts.isLoading ? (
              <Label>Loading accounts…</Label>
            ) : !mail.length ? (
              <Label>Connect Outlook or Gmail below to open your email.</Label>
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {mail.map((a) => (
                  <Button
                    key={a.id}
                    borderColor={brand.primary}
                    icon={<ProviderLogo provider={a.provider} size={16} />}
                    onPress={() => onSelect({ account: a, kind: "email" })}
                  >
                    {a.label}
                  </Button>
                ))}
              </View>
            )}
          </>
        ) : (
          <View
            key={`${selection.account.id}:${selection.kind}:${selection.folder?.id}`}
            style={{ flex: selection.kind === "email" ? 1 : undefined, minHeight: 0, gap: 12 }}
          >
            {selection.kind !== "email" && <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <ProviderLogo provider={selection.account.provider} />
              <Label>{selection.account.label}</Label>
            </View>}
            {selection.kind === "email" ? (
              <EmailPanel selection={selection} onSelect={onSelect} onBack={onBack} />
            ) : (
              <ChatPanel selection={selection} />
            )}
          </View>
        )}
      </View>
  );
  return selection?.kind === "email"
    ? <View style={{ flex: 1, minHeight: 0, padding: 8 }}>{content}</View>
    : <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 8, gap: 12 }}>{content}</ScrollView>;
}
function EmailPanel({
  onBack,
  selection,
  onSelect,
}: {
  onBack?: () => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const brand = useBrand();
  const { account } = selection,
    folder = selection.folder ?? { id: account.provider === "gmail" ? "INBOX" : "inbox", name: "Inbox" },
    scope = useConnectorScope(),
    cache = useQueryClient();
  const [selected, setSelected] = useState<Row | undefined>(selection.message),
    [folderOpen, setFolderOpen] = useState(true),
    [compose, setCompose] = useState<any>(),
    [cursor, setCursor] = useState<string>(),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const messageScroll = useRef<ScrollView>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = () => { setSearchOpen(false); setSearch(""); setQuery(""); setCursor(undefined); setPage(0); setPages([undefined]); };
  const base = `/accounts/${account.id}`;
  const list = useQuery({
    refetchInterval: useLiveInterval(),
    staleTime: 30_000,
    queryKey: ["comms-mail", scope, account.id, folder?.id, cursor, query, 50],
    enabled: !!folder && folderOpen,
    queryFn: ({ signal }) =>
      request<{ items: Row[]; next?: string }>(
        `${base}/messages?${new URLSearchParams({ folder: folder!.id, limit: "50", ...(cursor ? { cursor } : {}), ...(query ? { q: query } : {}) })}`,
        undefined,
        signal,
      ),
    retry: false,
  });
  const totals = useQuery({
    queryKey: ["comms-folder-counts", scope, `${base}/folders?`],
    queryFn: ({ signal }) => request<Record<string, number>>(`${base}/folder-counts?`, undefined, signal),
    staleTime: 30_000,
    retry: false,
  });
  const turnPage = (next: number) => {
    const token = next > page ? list.data?.next : pages[next];
    if (next < 0 || (next > page && !token)) return;
    if (next > page) setPages(old => [...old.slice(0, next), token]);
    setChecked(new Set());
    setPage(next);
    setCursor(token);
    messageScroll.current?.scrollTo?.({ y: 0, animated: false });
  };
  const detail = useQuery({
    refetchInterval: useLiveInterval(),
    staleTime: 30_000,
    queryKey: ["comms-message", scope, account.id, selected?.id],
    enabled: !!selected,
    queryFn: ({ signal }) =>
      request<Row>(`${base}/messages/${enc(selected!.id)}`, undefined, signal),
    retry: false,
  });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggleFolder = (next: Row) => {
    if (next.id === folder.id) {
      setFolderOpen(open => !open);
      setSelected(undefined);
    } else onSelect({ account, kind: "email", folder: next });
  };
  const selectFolder = (next: Selection) => {
    if (next.folder?.id === folder.id && !next.message) {
      setFolderOpen(true);
      setSelected(undefined);
    } else onSelect(next);
  };
  const [busy, setBusy] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const destinations = useQuery({queryKey:["comms-folders", scope, `${base}/folders?`], queryFn:({signal})=>request<{items:Row[]}>(`${base}/folders?`,undefined,signal)});
  const rows = list.data?.items || [];
  useEffect(()=>setChecked(new Set()),[query,folder.id,page]);
  const toggleChecked = (id:string) => setChecked(old=>{const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next;});
  async function manage(ids:string[], action:string, target?:string) {
    if (busy || !ids.length) return;
    setBusy(true); setError("");
    await cache.cancelQueries({queryKey:["comms-mail",scope,account.id]});
    const failed:string[]=[];
    let nextIndex=0;
    await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{
    while(nextIndex<ids.length) {
      const id=ids[nextIndex++];
      try {
        await request(`${base}/messages/${enc(id)}/action`,{action,destination:target,...(action === "move" ? {source:folder.id} : {})});
        const update = (items:Row[]) => action === "star" || action === "unstar" ? items.map(row=>row.id===id?{...row,starred:action==="star"}:row) : items.filter(row=>row.id!==id);
        cache.setQueriesData<{items:Row[]}>({queryKey:["comms-mail",scope,account.id]},old=>old?{...old,items:update(old.items)}:old);
        setChecked(old=>{const next=new Set(old);next.delete(id);return next;});
      } catch { failed.push(id); }
    }
    }));
    if(failed.length) setError(`${failed.length} message action(s) failed. Failed messages remain selected so you can retry.`);
    for(const key of ["comms-folder-counts","comms-inbox-count","comms-preview"]) void cache.invalidateQueries({queryKey:[key,scope]});
    setBusy(false);
  }
  const m = detail.data;
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ["comms-mail"] });
    void cache.invalidateQueries({ queryKey: ["comms-preview"] });
  };
  async function act(action: string) {
    if (!m) return;
    try {
      await request(`${base}/messages/${enc(m.id)}/action`, { action });
      setSelected(undefined);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function composeFrom(mode: string) {
    if (!m) return;
    const emails = (s: string) =>
      s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    try {
      const attachments =
        mode === "reply"
          ? []
          : await Promise.all(
              (m.attachments || []).map(async (a: any) => {
                const result = await request<{ data: string }>(
                  `${base}/messages/${enc(m.id)}/attachments/${enc(a.id)}`,
                );
                return {
                  name: a.name,
                  type: a.type || "application/octet-stream",
                  data: result.data,
                };
              }),
            );
      if (
        attachments.reduce((n: number, a: any) => n + a.data.length * 0.75, 0) >
        2000000
      )
        throw new Error(
          "Attachments exceed the 2 MB editing limit. The original message has not been changed.",
        );
      setCompose({
        attachments,
        mode,
        to:
          mode === "reply"
            ? emails(m.from || "").join(", ")
            : mode === "new"
              ? (m.to || []).flatMap(emails).join(", ")
              : "",
        cc: mode === "new" ? (m.cc || []).flatMap(emails).join(", ") : "",
        bcc: mode === "new" ? (m.bcc || []).flatMap(emails).join(", ") : "",
        subject:
          mode === "reply"
            ? `Re: ${m.subject}`
            : mode === "forward"
              ? `Fwd: ${m.subject}`
              : m.subject,
        text: mode === "new" ? m.text : `\n\n${m.from}\n${m.text}`,
        replyId: m.id,
        draftId: mode === "new" ? selected?.draftId : undefined,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function download(a: { id: string; name: string; type: string }) {
    try {
      const r = await request<{ data: string }>(
        `${base}/messages/${enc(m!.id)}/attachments/${enc(a.id)}`,
      );
      const { File, Paths } = await import("expo-file-system");
      const Sharing = await import("expo-sharing");
      const file = new File(
        Paths.cache,
        `${Crypto.randomUUID()}-${a.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
      );
      try {
        file.write(Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0)));
        await Sharing.shareAsync(file.uri, { mimeType: a.type });
      } finally {
        if (file.exists) file.delete();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (compose)
    return (
      <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        <Composer
          initial={compose}
          base={base}
          close={() => setCompose(undefined)}
          saved={() => {
            setCompose(undefined);
            refresh();
          }}
        />
      </ScrollView>
    );
  return (
    <>
      <View style={{ flexDirection: "row", flexWrap:"wrap", alignItems: "center", gap: 8 }}>
        <SphereBackButton size={28} accessibilityLabel="Back to email accounts" onPress={onBack} />
        <ProviderLogo provider={account.provider} size={16} />
        <Text style={{ color: "#eee", flex: 1, fontSize: 14, fontWeight: "600" }}>{account.label}</Text>
        {selected && m && <View style={{flexDirection:"row", flexWrap:"wrap", alignItems:"center"}}>
          {(selected.draftId ? [{label:"Edit draft", icon:"create-outline" as const, run:()=>composeFrom("new")}] : [
            {label:"Reply", icon:"arrow-undo-outline" as const, run:()=>composeFrom("reply")},
            {label:"Forward", icon:"arrow-redo-outline" as const, run:()=>composeFrom("forward")},
          ]).map(({label,icon,run})=><Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={run} style={{padding:10}}><Ionicons name={icon} size={18} color={brand.primary}/></Pressable>)}
          <Pressable accessibilityRole="button" accessibilityLabel={m.unread ? "Mark read" : "Mark unread"} onPress={()=>void act(m.unread ? "read" : "unread")} style={{padding:10}}><Ionicons name={m.unread ? "mail-open-outline" : "mail-outline"} size={18} color={brand.primary}/></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Archive" onPress={()=>void act("archive")} style={{padding:10}}><Ionicons name="archive-outline" size={18} color={brand.primary}/></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Move to deleted" onPress={()=>void act("trash")} style={{padding:10}}><Ionicons name="trash-outline" size={18} color={brand.primary}/></Pressable>
        </View>}
        <Pressable accessibilityRole="button" accessibilityLabel="Toggle email search" accessibilityState={{expanded:searchOpen}} onPress={() => { if(searchOpen) closeSearch(); else {setSearchOpen(true);setSelected(undefined);} }} style={{padding:10}}><Ionicons name="search-outline" size={18} color={brand.primary} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Compose" onPress={() => setCompose({})} style={{ padding: 10 }}><Ionicons name="create-outline" size={18} color={brand.primary} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh email" onPress={() => {
          setCursor(undefined); setPage(0); setPages([undefined]);
          void cache.invalidateQueries({queryKey:["comms-mail",scope,account.id]});
        }} style={{ padding: 10 }}><Ionicons name="refresh-outline" size={18} color={brand.primary} /></Pressable>
      </View>
          {searchOpen && folder && !selected && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <TextInput
                autoFocus
                accessibilityLabel="Search email"
                placeholder="Search email"
                placeholderTextColor="#aaa"
                style={[styles.input, { flex: 1, minWidth: 0 }]}
                value={search}
                onChangeText={setSearch}
              />
              <Action
                onPress={() => {
                  setQuery(search);
                  setCursor(undefined);
                  setPage(0);
                  setPages([undefined]);
                }}
              >
                Search
              </Action>
              <Action onPress={closeSearch}>Cancel</Action>
            </View>
          )}
      <ErrorText error={error} />
      {!selected && <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <View style={{ width: "40%", maxWidth: 220, minWidth: 108, flexShrink: 0 }} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Pressable accessibilityRole="checkbox" accessibilityLabel="Select all visible messages" accessibilityState={{ checked: !!rows.length && rows.every(row => checked.has(row.id)) }} disabled={busy || !rows.length} onPress={() => setChecked(rows.every(row => checked.has(row.id)) ? new Set() : new Set(rows.map(row => row.id)))} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name={rows.length && rows.every(row => checked.has(row.id)) ? "checkbox-outline" : "square-outline"} size={18} color={brand.primary} />
          <Label>Select all</Label>
        </Pressable>
        <Label>Emails {rows.length ? `${page * 50 + 1}–${page * 50 + rows.length}` : "0"}{!query && ` of ${totals.data?.[folder.id] ?? "…"}`}</Label>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous email page" disabled={busy || list.isFetching || page === 0} onPress={() => turnPage(page - 1)} style={{ padding: 8 }}><Ionicons name="chevron-back" size={18} color={page === 0 ? "#777" : brand.primary} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Next email page" disabled={busy || list.isFetching || !list.data?.next} onPress={() => turnPage(page + 1)} style={{ padding: 8 }}><Ionicons name="chevron-forward" size={18} color={!list.data?.next ? "#777" : brand.primary} /></Pressable>
        </View>
      </View>}
      <View style={{ flex: 1, minHeight: 0, flexDirection: "row", flexWrap: "nowrap", alignItems: "stretch", gap: 8 }}>
      <View style={{ width: "40%", maxWidth: 220, minWidth: 108, flexShrink: 0, borderRightWidth: 1, borderRightColor: brand.primary, paddingRight: 8 }}>
        <FolderTree account={account} kind="email" onSelect={selectFolder} expandable activeFolderId={folder.id} expandedFolderId={folderOpen ? folder.id : undefined} onToggleFolder={toggleFolder} paneMode />
      </View>
      <ScrollView ref={messageScroll} nestedScrollEnabled showsVerticalScrollIndicator={false} style={{ flex: 1, minWidth: 0, flexShrink: 1 }}>
      {!folderOpen ? <Label>Select a mailbox to view messages.</Label> : selected ? (
        <>
          <View style={{flexDirection:"row", alignItems:"center", gap:8}}>
            <SphereBackButton size={28} accessibilityLabel="Back to messages" onPress={() => setSelected(undefined)} />
            <Text style={[styles.heading, {fontSize:14, flex:1, color:brand.primary}]}>{m?.subject || selected.subject || "Message"}</Text>
          </View>
          <ErrorText error={detail.error} />
          {detail.isLoading && <Label>Loading message…</Label>}
          {m && (
            <>
              <Label>{m.from}</Label>
              <Label>To: {m.to?.join(", ")}</Label>
              <Text selectable style={{ color: "white", lineHeight: 22 }}>
                {m.text}
              </Text>
              {m.attachments?.map((a) => (
                <Action
                  key={a.id}
                  onPress={() => void download(a)}
                >{`Download ${a.name}`}</Action>
              ))}
            </>
          )}
        </>
      ) : (
        <>
          <ErrorText error={list.error} />
          {list.isLoading && <Label>Loading email…</Label>}
          {!!checked.size && <View style={{flexDirection:"row",alignItems:"center",gap:8}}><Label>{checked.size} selected</Label><Action disabled={busy} onPress={()=>setMoveOpen(!moveOpen)}>Move selected</Action><Pressable accessibilityLabel="Delete selected messages" disabled={busy} onPress={()=>void manage(rows.filter(r=>checked.has(r.id)).map(r=>r.id),"trash")}><Ionicons name="trash-outline" size={18} color={brand.primary}/></Pressable></View>}
          {moveOpen && !!checked.size && destinations.data?.items.filter(f=>f.id!==folder.id).map(f=><Action key={f.id} disabled={busy} onPress={()=>{setMoveOpen(false);void manage(rows.filter(r=>checked.has(r.id)).map(r=>r.id),"move",f.id);}}>{f.name || f.id}</Action>)}
          {rows.map(row=><View key={row.id} style={[styles.row,{flexDirection:"row",flexWrap:"wrap",alignItems:"flex-start",gap:8}]}>
            <Pressable accessibilityRole="checkbox" style={{height:24,justifyContent:"center"}} accessibilityLabel={`Select ${row.subject}`} accessibilityState={{checked:checked.has(row.id)}} disabled={busy} onPress={()=>toggleChecked(row.id)}><Ionicons name={checked.has(row.id)?"checkbox-outline":"square-outline"} size={18} color={brand.primary}/></Pressable>
            <Pressable style={{height:24,justifyContent:"center"}} accessibilityLabel={`${row.starred?"Unstar":"Star"} ${row.subject}`} disabled={busy} onPress={()=>void manage([row.id],row.starred?"unstar":"star")}><Ionicons name={row.starred?"star":"star-outline"} size={18} color={brand.primary}/></Pressable>
            <Pressable style={{flex:1,minWidth:80}} onPress={()=>setSelected(row)}><Text style={{color:brand.primary,lineHeight:24,fontWeight:row.unread?"700":"400"}}>{row.subject}</Text><Label>{row.from}</Label></Pressable>
            {row.date && !Number.isNaN(Date.parse(row.date)) && <Text accessibilityLabel="Received date and time" style={{color:"#aaa",fontSize:12,lineHeight:24,textAlign:"right"}}>{new Date(row.date).toLocaleString(undefined,{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"})}</Text>}
            <Pressable style={{height:24,justifyContent:"center"}} accessibilityLabel={`Delete ${row.subject}`} disabled={busy} onPress={()=>void manage([row.id],"trash")}><Ionicons name="trash-outline" size={18} color={brand.primary}/></Pressable>
          </View>)}
          {list.data && !list.data.items.length && (
            <Label>No messages in this view.</Label>
          )}
        </>
      )}
      </ScrollView>
      </View>
    </>
  );
}
function Composer({
  initial,
  base,
  close,
  saved,
}: {
  initial: any;
  base: string;
  close: () => void;
  saved: () => void;
}) {
  const [form, setForm] = useState({
      to: initial.to || "",
      cc: initial.cc || "",
      bcc: initial.bcc || "",
      subject: initial.subject || "",
      text: initial.text || "",
    }),
    [attachments, setAttachments] = useState<
      { name: string; type: string; data: string }[]
    >(initial.attachments || []),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const attempt = useRef<{ signature: string; id: string } | undefined>(
    undefined,
  );
  async function attach() {
    try {
      const f = await pickMeetingFile("files");
      if (!f) return;
      if (
        f.size + attachments.reduce((n, a) => n + a.data.length * 0.75, 0) >
        2000000
      )
        throw new Error("Attachments must total 2 MB or less.");
      let binary = "";
      for (const byte of f.bytes) binary += String.fromCharCode(byte);
      setAttachments((a) => [
        ...a,
        { name: f.name, type: f.type, data: btoa(binary) },
      ]);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save(draft: boolean) {
    setBusy(true);
    setError("");
    try {
      const recipients = (s: string) =>
        s
          .split(/[,;]+/)
          .map((s) => s.trim())
          .filter(Boolean);
      const mail = {
        ...form,
        to: recipients(form.to),
        cc: recipients(form.cc),
        bcc: recipients(form.bcc),
        attachments,
        mode: initial.mode || "new",
        replyId: initial.replyId,
        draftId: initial.draftId,
      };
      const signature = JSON.stringify({ mail, draft });
      if (attempt.current && attempt.current.signature !== signature)
        throw new Error(
          "Check the previous delivery in Sent before changing and resending this draft.",
        );
      attempt.current ??= { signature, id: Crypto.randomUUID() };
      await request(`${base}/mail`, {
        operationId: attempt.current.id,
        draft,
        mail,
      });
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 10 }}>
      {(["to", "cc", "bcc", "subject", "text"] as const).map((key) => (
        <View key={key}>
          <Label>
            {
              {
                to: "To",
                cc: "Cc",
                bcc: "Bcc",
                subject: "Subject",
                text: "Email message",
              }[key]
            }
          </Label>
          <TextInput
            accessibilityLabel={key}
            style={[
              styles.input,
              key === "text" && { minHeight: 180, textAlignVertical: "top" },
            ]}
            multiline={key === "text"}
            autoCapitalize={
              key === "to" || key === "cc" || key === "bcc"
                ? "none"
                : "sentences"
            }
            value={form[key]}
            editable={!busy}
            onChangeText={(value) => setForm((f) => ({ ...f, [key]: value }))}
          />
        </View>
      ))}
      <Action disabled={busy} onPress={() => void attach()}>
        Attach file (2 MB total)
      </Action>
      {attachments.map((a, i) => (
        <View key={i}>
          <Label>{a.name}</Label>
          <Action
            onPress={() => setAttachments((v) => v.filter((_, n) => n !== i))}
          >
            Remove
          </Action>
        </View>
      ))}
      <ErrorText error={error} />
      <View style={styles.actions}>
        <Action disabled={busy} onPress={() => void save(false)}>
          Send
        </Action>
        <Action disabled={busy} onPress={() => void save(true)}>
          Save draft
        </Action>
        <Action disabled={busy} onPress={close}>
          Cancel
        </Action>
      </View>
    </View>
  );
}
function ChatPanel({ selection }: { selection: Selection }) {
  const { account, folder, kind } = selection,
    scope = useConnectorScope();
  const [text, setText] = useState(""),
    [thread, setThread] = useState<string>(),
    [cursor, setCursor] = useState<string>(),
    [previous, setPrevious] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const attempt = useRef<{ text: string; id: string } | undefined>(undefined);
  const base = `/accounts/${account.id}/conversations/${enc(folder?.id || "")}/messages`;
  const q = useQuery({
    refetchInterval: useLiveInterval(),
    queryKey: ["comms-chat", scope, account.id, folder?.id, thread, cursor],
    enabled: !!folder,
    queryFn: ({ signal }) =>
      request<{ items: Row[]; next?: string }>(
        `${base}?${new URLSearchParams({ kind, ...(thread ? { thread } : {}), ...(cursor ? { cursor } : {}) })}`,
        undefined,
        signal,
      ),
    retry: false,
  });
  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      if (attempt.current && attempt.current.text !== text)
        throw new Error(
          "Check the previous delivery before sending a changed message.",
        );
      attempt.current ??= { text, id: Crypto.randomUUID() };
      await request(base, {
        kind,
        text,
        thread,
        operationId: attempt.current.id,
      });
      setText("");
      attempt.current = undefined;
      setPrevious([]);
      setCursor(undefined);
      await q.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Text style={styles.heading}>{folder?.name}</Text>
      <Action
        onPress={() => {
          setPrevious([]);
          setCursor(undefined);
          void q.refetch();
        }}
      >
        Refresh messages
      </Action>
      {thread && (
        <Action
          onPress={() => {
            setThread(undefined);
            setCursor(undefined);
            setPrevious([]);
          }}
        >
          Back to conversation
        </Action>
      )}
      <ErrorText error={error || q.error} />
      {q.isLoading && <Label>Loading messages…</Label>}
      {[...previous, ...(q.data?.items || [])].map((m) => (
        <View key={m.id} style={styles.row}>
          <Text style={{ color: "white", fontWeight: "700" }}>{m.from}</Text>
          <Text selectable style={{ color: "white" }}>
            {m.text}
          </Text>
          {!thread && !!m.replies && (
            <Action
              onPress={() => {
                setThread(m.id);
                setCursor(undefined);
                setPrevious([]);
              }}
            >
              Replies
            </Action>
          )}
        </View>
      ))}
      {q.data?.next && (
        <Action
          onPress={() => {
            setPrevious((v) => [...q.data!.items, ...v]);
            setCursor(q.data!.next);
          }}
        >
          Older messages
        </Action>
      )}
      <TextInput
        accessibilityLabel="Message"
        multiline
        style={[styles.input, { minHeight: 90 }]}
        value={text}
        onChangeText={setText}
      />
      <Action disabled={busy || !text.trim()} onPress={() => void send()}>
        Send
      </Action>
    </>
  );
}
const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: "#777",
    borderRadius: 8,
    padding: 12,
    color: "white",
    minHeight: 44,
  },
  heading: { color: "white", fontSize: 18, fontWeight: "700" },
  row: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#555",
    gap: 6,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
