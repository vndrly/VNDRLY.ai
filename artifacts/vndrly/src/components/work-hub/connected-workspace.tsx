import { curatedMailFolders } from "./curated-mail-folders";
import { CommsUnreadIcon } from "./comms-unread-icon";
import { readMailState, writeMailState, replyAllRecipients } from "./mail-local-state";
import SphereBackButton from "@/components/sphere-back-button";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, SquarePen, RefreshCw, Search, Reply, ReplyAll, Forward, MailOpen, Archive, Trash2, Star } from "lucide-react";
import { WorkHubMiniCardButton as Button } from "./chrome";
import { ProviderLogo } from "./provider-logo";
import {
  connectorRequest as request,
  useAccounts,
  useInboxCounts,
  useConnectorScope,
  enc,
  type Account,
  type Folder,
  type Message,
  type Selection,
} from "./connector-client";
function ErrorText({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="py-2 text-sm">
      {error instanceof Error ? error.message : String(error)}
    </p>
  ) : null;
}
export function ConnectorTree({
  kind,
  onSelect,
}: {
  kind: Selection["kind"];
  onSelect: (s: Selection) => void;
}) {
  const accounts = useAccounts();
  const inbox = useInboxCounts(kind === "email" ? accounts.data?.accounts : []);
  const content = (
    <>
      {accounts.data?.accounts
        .filter((a) =>
          kind === "email"
            ? ["gmail", "outlook"].includes(a.provider)
            : ["teams", "slack"].includes(a.provider),
        )
        .map((a) => (
          <AccountTree key={a.id} account={a} kind={kind} count={inbox.counts[a.id]} onSelect={onSelect} />
        ))}
      <ErrorText error={accounts.error} />
    </>
  );
  return kind === "email" ? (
    <details className="hub-conversation-category hub-email-interactions">
      <summary>
        <CommsUnreadIcon count={inbox.unread} label="inbox emails"><Mail className="size-4" style={{ color: "var(--brand-primary)" }} /></CommsUnreadIcon>
        Emails
        <span aria-label="Total inbox emails">{accounts.isLoading ? "…" : inbox.total ?? "…"}</span>
      </summary>
      {accounts.isLoading ? <p>Loading accounts…</p> : content}
    </details>
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
    <details
      className="ml-3 border-b border-white/15 py-2"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="flex items-center gap-2 cursor-pointer">
        <ProviderLogo provider={account.provider} className="size-4" />
        {account.label}
        {kind === "email" && <span className="ml-auto text-xs text-muted-foreground" aria-label="Account inbox emails">{count ?? "…"}</span>}
      </summary>
      {open &&
        (account.status !== "connected" ? (
          <p>Reconnect this account to continue.</p>
        ) : (
          <FolderTree account={account} kind={kind} onSelect={onSelect} />
        ))}
    </details>
  );
}
function FolderTree({
  activeFolderId,
  expandable = true,
  account,
  kind,
  onSelect,
  parent,
}: {
  account: Account;
  kind: Selection["kind"];
  onSelect: (s: Selection) => void;
  parent?: Folder;
  expandable?: boolean;
  activeFolderId?: string;
}) {
  const [cursor, setCursor] = useState<string>(),
    [previous, setPrevious] = useState<Folder[]>([]);
  const scope = useConnectorScope();
  const path =
    kind === "email"
      ? `/accounts/${account.id}/folders?${new URLSearchParams({ ...(parent ? { parent: parent.id } : {}), ...(cursor ? { cursor } : {}) })}`
      : `/accounts/${account.id}/conversations?${new URLSearchParams({ kind, ...(parent ? { team: parent.id } : {}), ...(cursor ? { cursor } : {}) })}`;
  const q = useQuery({
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 60_000,
    queryKey: ["comms-folders", scope, path],
    queryFn: ({ signal }) =>
      request<{ items: Folder[]; next?: string }>(path, undefined, signal),
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
    <div className="ml-2">
      {q.isLoading && <p>Loading…</p>}
      <ErrorText error={q.error} />
      {(kind === "email" && !parent ? curatedMailFolders([...previous, ...(q.data?.items || [])], account.provider) : [...previous, ...(q.data?.items || [])]).map((f) => (
        <FolderRow
          key={f.id}
          active={activeFolderId === f.id}
          expandable={expandable}
          count={counts.data?.[f.id]}
          folder={f}
          account={account}
          kind={kind}
          onSelect={onSelect}
        />
      ))}
      {q.data?.next && (
        <Button
          onClick={() => {
            setPrevious((v) => [...v, ...q.data!.items]);
            setCursor(q.data!.next);
          }}
        >
          More folders
        </Button>
      )}
    </div>
  );
}
function FolderRow({
  active = false,
  expandable,
  count,
  account,
  kind,
  onSelect,
  folder,
}: {
  count?: number;
  expandable: boolean;
  active?: boolean;
  account: Account;
  kind: Selection["kind"];
  onSelect: (s: Selection) => void;
  folder: Folder;
}) {
  const [open, setOpen] = useState(false);
  const scope = useConnectorScope();
  const q = useQuery({
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    queryKey: ["comms-mail", scope, account.id, folder.id, undefined, ""],
    enabled: expandable && open && kind === "email",
    queryFn: ({ signal }) =>
      request<{ items: Message[] }>(
        `/accounts/${account.id}/messages?folder=${enc(folder.id)}`,
        undefined,
        signal,
      ),
    retry: false,
  });
  if (folder.team)
    return (
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>{folder.name}</summary>
        {expandable && open && (
          <FolderTree
            account={account}
            kind={kind}
            parent={folder}
            onSelect={onSelect}
          />
        )}
      </details>
    );
  return (
    <div>
      <div className="flex items-center gap-2 py-1">
        {kind === "email" && (expandable || !!folder.children) && (
          <button
            aria-label={`Expand ${folder.name}`}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "▾" : "▸"}
          </button>
        )}
        <button
          className={`text-left flex-1 ${active ? "font-bold" : ""}`}
          aria-current={active ? "page" : undefined}
          style={{fontWeight:active ? 700 : 400}}
          onClick={() => onSelect({ account, kind, folder })}
        >
          {folder.name}
          {kind !== "email" && folder.unread ? ` (${folder.unread})` : ""}
        </button>
        {kind === "email" && <span className="ml-auto text-xs text-muted-foreground" aria-label={`${folder.name} message count`}>{count ?? "…"}</span>}
      </div>
      {expandable && open && (
        <div className="ml-4">
          <ErrorText error={q.error} />
          {q.isLoading && <p>Loading messages…</p>}
          {q.data?.items.map((m) => (
            <button
              key={m.id}
              className="block w-full text-left py-2 border-b border-white/10"
              onClick={() => onSelect({ account, kind, folder, message: m })}
            >
              <span className={`hub-email-title ${m.unread ? "font-bold" : ""}`}>{m.subject}</span>
              <span className="block text-xs opacity-70">{m.from}</span>
            </button>
          ))}

        </div>
      )}
      {open && !!folder.children && <FolderTree account={account} kind={kind} parent={folder} onSelect={onSelect} expandable={expandable} activeFolderId={active ? folder.id : undefined} />}
    </div>
  );
}
export function ConnectedWorkspace({
  onBack,
  selection,
  onSelect,
}: {
  onBack?: () => void;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
}) {
  const accounts = useAccounts();
  const emails =
    accounts.data?.accounts.filter((a) =>
      ["outlook", "gmail"].includes(a.provider),
    ) || [];
  if (!selection)
    return (
      <section className="hub-email-interactions p-4 space-y-3">
        <h2>Email</h2>
        <ErrorText error={accounts.error} />
        {accounts.isLoading ? (
          <p>Loading accounts…</p>
        ) : !emails.length ? (
          <p>Connect an Outlook or Gmail account below to open your email.</p>
        ) : (
          emails.map((a) => (
            <Button
              key={a.id}
              onClick={() => onSelect({ account: a, kind: "email" })}
            >
              <span className="flex gap-2 items-center">
                <ProviderLogo provider={a.provider} className="size-4" />
                {a.label}
              </span>
            </Button>
          ))
        )}
      </section>
    );
  return (
    <section
      key={`${selection.account.id}:${selection.kind}:${selection.folder?.id}`}
      className="hub-email-interactions p-3 space-y-3 h-full overflow-auto"
    >
      {(selection.kind !== "email" || selection.account.status !== "connected") && <div className="flex items-center gap-2">
        <ProviderLogo provider={selection.account.provider} />
        <h2>{selection.account.label}</h2>
      </div>}
      {selection.account.status !== "connected" ? (
        <p>Reconnect this account below to continue.</p>
      ) : selection.kind === "email" ? (
        <EmailPanel selection={selection} onSelect={onSelect} onBack={onBack} />
      ) : (
        <ExternalChat selection={selection} />
      )}
    </section>
  );
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
  const [folderWidth, setFolderWidth] = useState(180);
  const splitRef = useRef<HTMLDivElement>(null);
  const resizeStart = useRef<{x:number; width:number} | undefined>(undefined);
  const resizeFolders = (width:number) => setFolderWidth(Math.max(120, Math.min(width, Math.min(400, (splitRef.current?.clientWidth || 720) - 280))));
  const { account } = selection,
    folder = selection.folder ?? { id: account.provider === "gmail" ? "INBOX" : "inbox", name: "Inbox" },
    scope = useConnectorScope(),
    cache = useQueryClient();
  const [selected, setSelected] = useState<Message | undefined>(
      selection.message,
    ),
    [compose, setCompose] = useState<any>(),
    [cursor, setCursor] = useState<string>(),
    [previous, setPrevious] = useState<Message[]>([]),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [error, setError] = useState("");
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const [page, setPage] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = () => {
    setSearchOpen(false); setSearch(""); setQuery(""); setCursor(undefined); setPrevious([]); setPage(0); setPages([undefined]);
  };
  const base = `/accounts/${account.id}`;
  const summaryKey = JSON.stringify(["mail-summaries",scope,account.id,folder.id,cursor,query,50]);
  const list = useQuery({
    initialData:()=>readMailState<{items:Message[];next?:string}>(sessionStorage,summaryKey),
    initialDataUpdatedAt:0,
    placeholderData:()=>!cursor && !query ? cache.getQueryData<{items:Message[];next?:string}>(["comms-mail",scope,account.id,folder.id,undefined,""]) : undefined,

    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    queryKey: ["comms-mail", scope, account.id, folder?.id, cursor, query, 50],
    enabled: !!folder,
    queryFn: ({ signal }) =>
      request<{ items: Message[]; next?: string }>(
        `${base}/messages?${new URLSearchParams({ folder: folder!.id, limit:"50", ...(cursor ? { cursor } : {}), ...(query ? { q: query } : {}) })}`,
        undefined,
        signal,
      ),
    retry: false,
  });
  // Provider paging tokens can expire between visits. Restart this folder's
  // read-only pagination instead of leaving the messages pane empty.
  useEffect(() => {
    if (!cursor || !(list.error instanceof Error) || !/invalid provider cursor|expired.*cursor|cursor.*expired/i.test(list.error.message)) return;
    setCursor(undefined); setPage(0); setPages([undefined]); setPrevious([]);
    setChecked(new Set()); setSelected(undefined);
    void cache.invalidateQueries({ queryKey: ["comms-mail", scope, account.id, folder.id, undefined, query, 50], exact: true });
  }, [list.error, cursor, cache, scope, account.id, folder.id, query]);
  useEffect(()=>{if(list.data && !list.isPlaceholderData) writeMailState(sessionStorage,summaryKey,list.data);},[list.data,list.isPlaceholderData,summaryKey]);
  const detail = useQuery({
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    queryKey: ["comms-message", scope, account.id, selected?.id],
    enabled: !!selected,
    queryFn: ({ signal }) =>
      request<Message>(
        `${base}/messages/${enc(selected!.id)}`,
        undefined,
        signal,
      ),
    retry: false,
  });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [destination, setDestination] = useState("");
  const destinations = useQuery({queryKey:["comms-folders", scope, `${base}/folders?`], queryFn:({signal})=>request<{items:Folder[]}>(`${base}/folders?`,undefined,signal)});
  const rows = list.data?.items || [];
  const totals = useQuery({queryKey:["comms-folder-counts",scope,`${base}/folders?`],queryFn:({signal})=>request<Record<string,number>>(`${base}/folder-counts?`,undefined,signal),staleTime:30_000});
  function turnPage(next:number) {
    const token=next > page ? list.data?.next : pages[next];
    if(next < 0 || (next > page && !token)) return;
    if(next > page) setPages(old=>[...old.slice(0,next),token]);
    setChecked(new Set()); setPage(next); setCursor(token);
  }

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
        const update = (items:Message[]) => action === "star" || action === "unstar" ? items.map(row=>row.id===id?{...row,starred:action==="star"}:row) : items.filter(row=>row.id!==id);
        setPrevious(update);
        cache.setQueriesData<{items:Message[]}>({queryKey:["comms-mail",scope,account.id]},old=>old?{...old,items:update(old.items)}:old);
        setChecked(old=>{const next=new Set(old);next.delete(id);return next;});
      } catch { failed.push(id); }
    }
    }));
    if(failed.length) setError(`${failed.length} message action(s) failed. Failed messages remain selected so you can retry.`);
    for(const key of ["comms-folder-counts","comms-inbox-count","comms-preview"]) void cache.invalidateQueries({queryKey:[key,scope]});
    setBusy(false);
  }
  const m = detail.data;
  const readAttempt = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!selected) { readAttempt.current = undefined; return; }
    if (!m?.unread || m.id !== selected.id || readAttempt.current === m.id) return;
    readAttempt.current = m.id;
    void request(`${base}/messages/${enc(m.id)}/action`, {action:"read"}).then(() => {
      cache.setQueryData(["comms-message",scope,account.id,m.id], {...m,unread:false});
      void cache.invalidateQueries({queryKey:["comms-mail",scope,account.id]});
      void cache.invalidateQueries({queryKey:["comms-inbox-count",scope,account.id]});
    }).catch((error:Error)=>setError(error.message));
  }, [m?.id,m?.unread,selected?.id,base,scope,account.id,cache]);
  useEffect(() => {
    setSelected(selection.message);
  }, [selection.message]);
  async function act(action: string, destination?: string) {
    if (!m) return;
    try {
      await request(`${base}/messages/${enc(m.id)}/action`, {
        action,
        destination,
      });
      setSelected(undefined);
      await cache.invalidateQueries({ queryKey: ["comms-mail"] });
      await cache.invalidateQueries({ queryKey: ["comms-preview"] });
      await cache.invalidateQueries({ queryKey: ["comms-inbox-count"] });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const composeFrom = async (mode: string) => {
    if (!m) return;
    const emails = (s: string) =>
      s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    try {
      const replyAll = mode === "replyAll" ? replyAllRecipients(m.from,m.to,m.cc,account.label) : undefined;
      const attachments =
        (mode === "reply" || mode === "replyAll")
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
        mode:mode === "replyAll" ? "reply" : mode,
        to:
          (mode === "reply" || mode === "replyAll")
            ? replyAll?.to ?? emails(m.from).join(", ")
            : mode === "new"
              ? (m.to || []).flatMap(emails).join(", ")
              : "",
        cc: replyAll?.cc ?? (mode === "new" ? (m.cc || []).flatMap(emails).join(", ") : ""),
        bcc: mode === "new" ? (m.bcc || []).flatMap(emails).join(", ") : "",
        subject:
          (mode === "reply" || mode === "replyAll")
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
  };
  return (
    <>
      <div className="relative flex min-w-0 flex-wrap items-center gap-2">
        {!selected && !compose && <div className="hub-email-pagination order-last ml-auto flex flex-wrap items-center justify-end gap-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" aria-label="Select all visible messages" disabled={busy || !rows.length} checked={!!rows.length && rows.every(row=>checked.has(row.id))} ref={node=>{if(node)node.indeterminate=rows.some(row=>checked.has(row.id))&&!rows.every(row=>checked.has(row.id));}} onChange={e=>setChecked(e.target.checked?new Set(rows.map(row=>row.id)):new Set())}/><span>Select all</span></label>
          <span aria-live="polite" className="whitespace-nowrap">Emails {rows.length ? `${page*50+1}–${page*50+rows.length}` : "0"}{!query && ` of ${totals.data?.[folder.id] ?? "…"}`}</span>
          <button type="button" className="hub-email-page" aria-label="Previous email page" disabled={busy || list.isFetching || page===0} onClick={()=>turnPage(page-1)}>‹</button>
          <button type="button" className="hub-email-page" aria-label="Next email page" disabled={busy || list.isFetching || !list.data?.next} onClick={()=>turnPage(page+1)}>›</button>
        </div>}
        <button type="button" className="group hub-email-back shrink-0" aria-label="Back to email accounts" title="Back to email accounts" onClick={onBack}><SphereBackButton size={28} /></button>
        <ProviderLogo provider={account.provider} className="size-4" />
        <h2 className="min-w-0 flex-1 truncate" style={{ paddingRight: 28, fontSize: 14, lineHeight: "20px", fontWeight: 600 }}><span style={{display:"block",maxWidth:Math.max(60,folderWidth-56),overflow:"hidden",textOverflow:"ellipsis"}}>{account.label}</span></h2>
        {selected && m && !compose && (
          <div role="group" aria-label="Message actions" className="flex items-center gap-2">
            {(selected.draftId ? [{label:"Edit draft", Icon:SquarePen, run:()=>composeFrom("new")}] : [
              {label:"Reply", Icon:Reply, run:()=>composeFrom("reply")},
              {label:"Reply all", Icon:ReplyAll, run:()=>composeFrom("replyAll")},
              {label:"Forward", Icon:Forward, run:()=>composeFrom("forward")},
            ]).concat([
              {label:m.unread ? "Mark read" : "Mark unread", Icon:m.unread ? MailOpen : Mail, run:()=>act(m.unread ? "read" : "unread")},
              {label:"Archive", Icon:Archive, run:()=>act("archive")},
              {label:"Move to deleted", Icon:Trash2, run:()=>act("trash")},
            ]).map(({label,Icon,run})=><button key={label} type="button" className="hub-conversation-tool shrink-0" aria-label={label} title={label} onClick={run}><Icon className="size-4" aria-hidden="true" /></button>)}
          </div>
        )}
        <button type="button" className="hub-conversation-tool shrink-0" aria-label="Toggle email search" title="Search email" aria-expanded={searchOpen} onClick={() => {
          if (searchOpen) closeSearch();
          else { setSearchOpen(true); setSelected(undefined); setCompose(undefined); }
        }}><Search className="size-4" aria-hidden="true" /></button>
        <button type="button" className="hub-conversation-tool shrink-0" aria-label="Compose" title="Compose" onClick={() => setCompose({})}><SquarePen className="size-4" aria-hidden="true" /></button>
        <button type="button" className="hub-conversation-tool shrink-0" aria-label="Refresh email" title="Refresh email" onClick={() => {
          setPrevious([]);
          setCursor(undefined); setPage(0); setPages([undefined]);
          void cache.invalidateQueries({ queryKey: ["comms-mail", scope, account.id] });
        }}><RefreshCw className="size-4" aria-hidden="true" /></button>
      </div>
                {searchOpen && folder && !compose && !selected && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      setQuery(search);
                      setCursor(undefined); setPage(0); setPages([undefined]);
                      setPrevious([]);
                    }}
                    className="flex gap-2"
                  >
                    <input
                      autoFocus
                      aria-label="Search email"
                      placeholder="Search email"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="min-w-0 flex-1 rounded border p-2 bg-transparent"
                    />
                    <Button type="submit">Search</Button>
                    <Button type="button" onClick={closeSearch}>Cancel</Button>
                  </form>
                )}
      <ErrorText error={error} />
      {compose ? (
        <MailComposer
          key={compose.replyId || "new"}
          initial={compose}
          base={base}
          onClose={() => setCompose(undefined)}
          onSaved={() => {
            setCompose(undefined);
            void cache.invalidateQueries({ queryKey: ["comms-mail"] });
            void cache.invalidateQueries({ queryKey: ["comms-preview"] });
          }}
        />
      ) : (
        <div ref={splitRef} className="hub-email-split" style={{"--email-folder-width": `${folderWidth}px`} as CSSProperties}>
          <nav aria-label="Email folders" className="hub-email-folder-sidebar">
            <FolderTree account={account} kind="email" onSelect={onSelect} expandable={false} activeFolderId={folder.id} />
          </nav>
          <div role="separator" aria-label="Resize email folders" aria-orientation="vertical" aria-valuemin={120} aria-valuemax={400} aria-valuenow={folderWidth} tabIndex={0} className="hub-email-divider"
            onPointerDown={event=>{if(event.button !== 0) return; resizeStart.current={x:event.clientX,width:folderWidth};event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();}}
            onPointerMove={event=>{if(resizeStart.current) resizeFolders(resizeStart.current.width + event.clientX-resizeStart.current.x);}}
            onPointerUp={event=>{resizeStart.current=undefined;if(event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);}}
            onPointerCancel={()=>{resizeStart.current=undefined;}}
            onLostPointerCapture={()=>{resizeStart.current=undefined;}}
            onKeyDown={event=>{if(event.key==="ArrowLeft" || event.key==="ArrowRight"){event.preventDefault();resizeFolders(folderWidth+(event.key==="ArrowRight"?16:-16));}}}
          />
          <div className="hub-email-message-pane min-w-0">
            {selected ? (
              <>
                <div className="flex items-center gap-2">
                  <button type="button" className="group hub-email-back shrink-0" aria-label="Back to messages" title="Back to messages" onClick={() => setSelected(undefined)}><SphereBackButton size={28} /></button>
                  <h3 className="text-sm font-semibold">{m?.subject || selected.subject || "Message"}</h3>
                </div>
                <ErrorText error={detail.error} />
                {detail.isLoading && <p>Loading message…</p>}
                {m && (
                  <>
                    <p>{m.from}</p>
                    <p className="text-sm">To: {m.to?.join(", ")}</p>
                    <p className="text-xs">
                      {new Date(m.date).toLocaleString()}
                    </p>
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm">
                      {m.text}
                    </pre>
                    {m.attachments?.map((a) => (
                      <Button
                        key={a.id}
                        onClick={() => {
                          void request<{ data: string }>(
                            `${base}/messages/${enc(m.id)}/attachments/${enc(a.id)}`,
                          )
                            .then((result) => {
                              const bytes = Uint8Array.from(
                                atob(result.data),
                                (c) => c.charCodeAt(0),
                              );
                              const url = URL.createObjectURL(
                                new Blob([bytes], {
                                  type: "application/octet-stream",
                                }),
                              );
                              const link = document.createElement("a");
                              link.href = url;
                              link.download = a.name;
                              link.click();
                              setTimeout(() => URL.revokeObjectURL(url), 1000);
                            })
                            .catch((e) => setError(e.message));
                        }}
                      >
                        Download {a.name}
                      </Button>
                    ))}
                  </>
                )}
              </>
            ) : (
              <>
                <ErrorText error={list.error} />
                {list.isLoading && !previous.length && <p>Loading email…</p>}
                <div className="flex items-center gap-2" aria-label="Bulk email actions">

                  {!!checked.size && <><span>{checked.size} selected</span><select aria-label="Move selected messages to" value={destination} onChange={e=>setDestination(e.target.value)} disabled={busy}><option value="">Choose folder</option>{destinations.data?.items.filter(f=>f.id!==folder.id).map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select><button type="button" disabled={busy || !destination} onClick={()=>void manage(rows.filter(r=>checked.has(r.id)).map(r=>r.id),"move",destination)}>Move selected</button><button type="button" className="hub-conversation-tool" title="Delete selected messages" aria-label="Delete selected messages" disabled={busy} onClick={()=>void manage(rows.filter(r=>checked.has(r.id)).map(r=>r.id),"trash")}><Trash2 className="size-4"/></button></>}
                </div>
                {rows.map(row=>(
                  <div key={row.id} className="hub-email-message-row flex items-start gap-2 py-3 border-b border-white/15">
                    <input type="checkbox" aria-label={`Select ${row.subject}`} checked={checked.has(row.id)} disabled={busy} onChange={()=>toggleChecked(row.id)}/>
                    <button type="button" className="hub-conversation-tool shrink-0" aria-label={`${row.starred?"Unstar":"Star"} ${row.subject}`} aria-pressed={!!row.starred} disabled={busy} onClick={()=>void manage([row.id],row.starred?"unstar":"star")}><Star className="size-4" fill={row.starred?"currentColor":"none"}/></button>
                    <button type="button" className="hub-email-message-content text-left min-w-0 flex-1" onClick={()=>setSelected(row)}><strong className={`hub-email-title ${row.unread?"":"font-normal"}`}>{row.subject}</strong><span className="block text-xs">{row.from}</span></button>
                    {row.date && !Number.isNaN(Date.parse(row.date)) && <time dateTime={row.date} className="shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground" style={{lineHeight:"24px"}} aria-label="Received date and time">{new Date(row.date).toLocaleString(undefined,{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"})}</time>}
                    <button type="button" className="hub-conversation-tool shrink-0" aria-label={`Delete ${row.subject}`} title="Move to deleted" disabled={busy} onClick={()=>void manage([row.id],"trash")}><Trash2 className="size-4"/></button>
                  </div>
                ))}
                {list.data && !list.data.items.length && (
                  <p>No messages in this view.</p>
                )}

              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
function MailComposer({
  initial,
  base,
  onClose,
  onSaved,
}: {
  initial: any;
  base: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const scope = useConnectorScope();
  const draftKey = JSON.stringify(["mail-draft",scope,base,initial.draftId || initial.replyId || "new",initial.mode || "new"]);
  const [recovered] = useState(()=>readMailState<{form:any;attachments:any[];attempt?:{signature:string;id:string}}>(localStorage,draftKey));
  const [draftStatus,setDraftStatus] = useState(recovered ? "Recovered draft saved on this device" : "Draft saved on this device");
  const [form, setForm] = useState<{to:string;cc:string;bcc:string;subject:string;text:string}>(recovered?.form ?? {
      to: initial.to || "",
      cc: initial.cc || "",
      bcc: initial.bcc || "",
      subject: initial.subject || "",
      text: initial.text || "",
    }),
    [attachments, setAttachments] = useState<
      { name: string; type: string; data: string }[]
    >(recovered?.attachments ?? initial.attachments ?? []),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const attempt = useRef<{ signature: string; id: string } | undefined>(
    recovered?.attempt,
  );
  useEffect(()=>{
    const ok=writeMailState(localStorage,draftKey,{form,attachments,attempt:attempt.current});
    setDraftStatus(ok ? "Draft saved on this device" : "Unable to autosave on this device. Use Save draft before leaving.");
  },[form,attachments,draftKey]);
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
      attempt.current ??= { signature, id: crypto.randomUUID() };
      writeMailState(localStorage,draftKey,{form,attachments,attempt:attempt.current});
      await request(`${base}/mail`, {
        operationId: attempt.current.id,
        draft,
        mail,
      });
      localStorage.removeItem(draftKey);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      <p role="status" className="text-xs">{draftStatus}</p>
      {(["to", "cc", "bcc", "subject"] as const).map((key) => (
        <label key={key} className="block">
          {{ to: "To", cc: "Cc", bcc: "Bcc", subject: "Subject" }[key]}
          <input
            className="block w-full rounded border bg-transparent p-2"
            value={form[key]}
            disabled={busy}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          />
        </label>
      ))}
      <textarea
        aria-label="Email message"
        className="w-full min-h-48 rounded border bg-transparent p-2"
        value={form.text}
        disabled={busy}
        onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
      />
      <label className="block">
        Attachments (2 MB total)
        <input
          type="file"
          multiple
          disabled={busy}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            void Promise.all(
              files.map(
                (file) =>
                  new Promise<{ name: string; type: string; data: string }>(
                    (resolve, reject) => {
                      const reader = new FileReader();
                      reader.onerror = reject;
                      reader.onload = () =>
                        resolve({
                          name: file.name,
                          type: file.type || "application/octet-stream",
                          data: String(reader.result).split(",")[1],
                        });
                      reader.readAsDataURL(file);
                    },
                  ),
              ),
            )
              .then((items) => {
                if (
                  [...attachments, ...items].reduce(
                    (n, a) => n + a.data.length * 0.75,
                    0,
                  ) > 2000000
                )
                  throw new Error("Attachments must total 2 MB or less.");
                setAttachments((a) => [...a, ...items]);
              })
              .catch((e) => setError(e.message));
          }}
        />
      </label>
      {attachments.map((a, i) => (
        <div key={i}>
          {a.name}{" "}
          <button
            type="button"
            onClick={() => setAttachments((v) => v.filter((_, n) => n !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          Send
        </Button>
        <Button disabled={busy} onClick={() => void save(true)}>
          Save draft
        </Button>
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
function ExternalChat({ selection }: { selection: Selection }) {
  const { account, folder, kind } = selection,
    scope = useConnectorScope();
  const [text, setText] = useState(""),
    [thread, setThread] = useState<string>(),
    [cursor, setCursor] = useState<string>(),
    [previous, setPrevious] = useState<Message[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const attempt = useRef<{ text: string; id: string } | undefined>(undefined);
  const base = `/accounts/${account.id}/conversations/${enc(folder?.id || "")}/messages`;
  const q = useQuery({
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryKey: ["comms-chat", scope, account.id, folder?.id, thread, cursor],
    enabled: !!folder,
    queryFn: ({ signal }) =>
      request<{ items: Message[]; next?: string }>(
        `${base}?${new URLSearchParams({ kind, ...(thread ? { thread } : {}), ...(cursor ? { cursor } : {}) })}`,
        undefined,
        signal,
      ),
    retry: false,
  });
  return (
    <>
      <h3>{folder?.name}</h3>
      <div className="flex gap-2">
        <Button
          onClick={() => {
            setPrevious([]);
            setCursor(undefined);
            void q.refetch();
          }}
        >
          Refresh messages
        </Button>
        {thread && (
          <Button
            onClick={() => {
              setThread(undefined);
              setPrevious([]);
              setCursor(undefined);
            }}
          >
            Back to conversation
          </Button>
        )}
      </div>
      <ErrorText error={q.error || error} />
      {q.isLoading && <p>Loading messages…</p>}
      {[...previous, ...(q.data?.items || [])].map((m) => (
        <article key={m.id} className="py-3 border-b border-white/15">
          <strong>{m.from}</strong>
          <time className="ml-2 text-xs">
            {new Date(m.date).toLocaleString()}
          </time>
          <p className="whitespace-pre-wrap break-words">{m.text}</p>
          {!thread && !!m.replies && (
            <Button
              onClick={() => {
                setThread(m.id);
                setPrevious([]);
                setCursor(undefined);
              }}
            >
              Replies
            </Button>
          )}
        </article>
      ))}
      {q.data?.next && (
        <Button
          onClick={() => {
            setPrevious((v) => [...q.data!.items, ...v]);
            setCursor(q.data!.next);
          }}
        >
          Older messages
        </Button>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          setBusy(true);
          setError("");
          if (attempt.current && attempt.current.text !== text) {
            setError(
              "Check the previous delivery before sending a changed message.",
            );
            setBusy(false);
            return;
          }
          attempt.current ??= { text, id: crypto.randomUUID() };
          void request(base, {
            kind,
            text,
            thread,
            operationId: attempt.current.id,
          })
            .then(() => {
              setText("");
              attempt.current = undefined;
              setPrevious([]);
              setCursor(undefined);
              return q.refetch();
            })
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
        className="space-y-2"
      >
        <textarea
          aria-label="Message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full min-h-24 border rounded p-2 bg-transparent"
        />
        <Button type="submit" disabled={busy || !text.trim()}>
          Send
        </Button>
      </form>
    </>
  );
}
