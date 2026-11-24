import { CardHeading } from "@/components/ui/card-heading";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardCheck, ClipboardList, NotebookPen } from "lucide-react";
import type { ChangeOverState } from "@workspace/gate-booth";
import { useBrand } from "@/hooks/use-brand";
import { PngPillButton, brandImagePillSrc } from "@/components/png-pill-rollover";
import WatchPassControl from "@/components/watch-pass-control";
import GateTaskHopper from "@/components/gate-task-hopper";
import { Dialog } from "@/components/ui/dialog";
import MiniCardDialogContent from "@/components/mini-card-dialog-content";
import "./gate-handoff-desk.css";
import { useNextSteps, usePageWorkflows } from "./next-steps";
import { useGuidedTarget } from "./guided-target";
import { gateGuideMatches, gateGuideScope } from "@/lib/gate-operational-helpers";

export interface GateHandoffDeskProps {
  stationId?: string;
  current: ChangeOverState;
  ownWatch: boolean;
  gatekeeperOnDuty?: boolean;
  busy: boolean;
  online: boolean;
  readError: boolean;
  notes: string;
  onNotesChange: (text: string) => void;
  itemText: string;
  onItemTextChange: (text: string) => void;
  itemNotes: Record<string, string>;
  onItemNoteChange: (id: string, text: string) => void;
  onItemAction: (id: string, kind: "resolve" | "reopen") => void;
  onAddItem: () => void;
  onSave: () => void;
  onEditSave?: (notes:string) => Promise<void>;
  onSignHandoff?: (input:{operationId:string;expectedWatchId:string;expectedPreparationId:string|null;notes:string}) => Promise<void>;
  onAddNote?: (input:{operationId:string;expectedWatchId:string;text:string;photoPaths?:string[]}) => Promise<void>;
  onAssumeReviewed: () => void;
  pendingWatch: boolean;
  onRecoverWatch: () => void;
  reason: string;
  onReasonChange: (text: string) => void;
  onWithdraw: () => void;
}

type WatchNote = { id: string; text: string; createdAt: string; authorName: string; photoPaths: string[] };
const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

async function uploadShiftNotePhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) throw new Error("Choose an image under 8 MB.");
  const request = await fetch(`${apiBase}/api/storage/uploads/request-url`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }) });
  if (!request.ok) throw new Error("Could not prepare photo upload.");
  const descriptor = await request.json() as { uploadURL: string; objectPath: string };
  const uploadURL = /^https?:\/\//i.test(descriptor.uploadURL) ? descriptor.uploadURL : `${apiBase}${descriptor.uploadURL}`;
  const uploaded = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  if (!uploaded.ok) throw new Error("Could not upload photo.");
  const finalized = await fetch(`${apiBase}/api/storage/uploads/finalize`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objectURL: descriptor.uploadURL, visibility: "private", purpose: "gate-evidence" }) });
  if (!finalized.ok) throw new Error("Could not finalize photo.");
  return descriptor.objectPath;
}

/** Saving records the handoff. Only the incoming operator's explicit review action changes watch custody. */
export default function GateHandoffDesk(props: GateHandoffDeskProps) {
  const {
    current, stationId, ownWatch, gatekeeperOnDuty = false, busy, online, readError, notes,
    itemText, onItemTextChange, itemNotes, onItemNoteChange, onItemAction,
    onAddItem, onSave, onAssumeReviewed, pendingWatch, onRecoverWatch,
  } = props;
  const { t, i18n } = useTranslation();
  const es = i18n?.language?.startsWith("es");
  const brand = useBrand();
  const [itemView, setItemView] = useState<"open" | "resolved">("open");
  const [editing,setEditing]=useState(false),[editNotes,setEditNotes]=useState(""),[editBusy,setEditBusy]=useState(false),[editError,setEditError]=useState("");
  const [newNote,setNewNote]=useState(""),[noteBusy,setNoteBusy]=useState(false),[noteError,setNoteError]=useState(""),[notesExpanded,setNotesExpanded]=useState(false);
  const [noteCommand,setNoteCommand]=useState<{operationId:string;expectedWatchId:string;text:string;photoPaths?:string[]}|null>(null);
  const [notePhotos,setNotePhotos]=useState<string[]>([]),[photoBusy,setPhotoBusy]=useState(false);
  const [watchNotes,setWatchNotes]=useState<WatchNote[]>([]),[watchNotesBusy,setWatchNotesBusy]=useState(false),[watchNotesError,setWatchNotesError]=useState("");
  const photoInput=useRef<HTMLInputElement>(null);
  const [reviewExpanded,setReviewExpanded]=useState(false);
  const [editingSigned,setEditingSigned]=useState(false),[signing,setSigning]=useState(false),[signError,setSignError]=useState("");
  const [signCommand,setSignCommand]=useState<{operationId:string;expectedWatchId:string;expectedPreparationId:string|null;notes:string}|null>(null);
  const preparation = current.preparation;
  const watchId=current.shift?.id??current.releasedWatch?.id;
  useEffect(()=>{
    if(!stationId||!watchId){setWatchNotes([]);return;}
    const controller=new AbortController();
    setWatchNotesBusy(true);setWatchNotesError("");
    fetch(`${apiBase}/api/gate-change-over/${stationId}/notes/watch?watchId=${encodeURIComponent(watchId)}`,{credentials:"include",signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error("Could not load shift notes.");return response.json() as Promise<{notes:WatchNote[]}>;})
      .then(result=>setWatchNotes(result.notes))
      .catch(error=>{if(!controller.signal.aborted)setWatchNotesError(error instanceof Error?error.message:"Could not load shift notes.");})
      .finally(()=>{if(!controller.signal.aborted)setWatchNotesBusy(false);});
    return()=>controller.abort();
  },[stationId,watchId,preparation?.id]);
  const reloadWatchNotes=async()=>{
    if(!stationId||!watchId)return;
    const response=await fetch(`${apiBase}/api/gate-change-over/${stationId}/notes/watch?watchId=${encodeURIComponent(watchId)}`,{credentials:"include"});
    if(!response.ok)throw new Error("Could not load shift notes.");
    setWatchNotes(((await response.json()) as {notes:WatchNote[]}).notes);
  };
  useEffect(()=>{const show=(event:Event)=>{if((event as CustomEvent<{name?:string}>).detail?.name==="manage_gate_shift"){setNotesExpanded(true);void reloadWatchNotes();}};window.addEventListener("askv:data-changed",show);return()=>window.removeEventListener("askv:data-changed",show);},[stationId,watchId]);
  const addNote=async()=>{
    if(!current.shift||!props.onAddNote||!newNote.trim()||noteBusy||photoBusy)return;
    const command=noteCommand??{operationId:crypto.randomUUID(),expectedWatchId:current.shift.id,text:newNote.trim(),photoPaths:notePhotos};
    setNoteCommand(command);setNoteBusy(true);setNoteError("");
    try{await props.onAddNote(command);setNewNote("");setNotePhotos([]);setNoteCommand(null);setNotesExpanded(true);await reloadWatchNotes();}
    catch(error){const status=(error as {status?:number}).status;if(status&&status>=400&&status<500)setNoteCommand(null);setNoteError(error instanceof Error?error.message:t("changeOver.failed"));}
    finally{setNoteBusy(false);}
  };
  const signature=preparation?.summary.signature;
  useEffect(()=>{if(signature)setEditingSigned(false);},[preparation?.id]);
  const revision = current.snapshot?.revision;
  const freshSaved = Boolean(preparation && !current.stale && revision && revision === preparation.snapshot.revision);
  const ready = freshSaved && notes === preparation?.notes;
  const blocked = busy || !online || readError || pendingWatch;
  const mayEditItems = ownWatch || current.supervisor;
  const mayAssume = Boolean(!ownWatch && !blocked);
  const pillSrc = brandImagePillSrc(brand.primary, brand.name);
  const selectedItems = current.items.filter((item) => item.status === itemView);
  const helper = useNextSteps();
  const guideContext = { siteId: current.site.id, stationId, siteName: current.site.name, stationName: current.station.name };
  usePageWorkflows(["gate-watch-handoff"], guideContext, Boolean(stationId));
  const scopeId = gateGuideScope("handoff", guideContext);
  const guided = gateGuideMatches(helper?.selected, "gate-watch-handoff", guideContext);
  const targetId = !ownWatch ? "review-watch" : signature && !editingSigned ? "saved-handoff" : notes.trim() ? "sign-handoff" : "handoff-notes";
  useGuidedTarget({ scopeId, targetId, prompt: !ownWatch ? "Review the saved outgoing briefing and current activity, then explicitly review and Assume Watch from your own account." : signature && !editingSigned ? "The signed handoff is saved. Review its notes; the incoming operator must explicitly accept the watch. Your navigation does not release custody." : notes.trim() ? "Review open items and your notes, then sign and save the handoff. Signing alone does not release your watch." : "Add any handoff notes the incoming operator needs, or review the existing facts before signing. Only saved handoff notes are shared." }, guided && !blocked && !signing, 35);
  const signHandoff=async()=>{
    if(!current.shift||!props.onSignHandoff)return;
    const command=signCommand??{operationId:crypto.randomUUID(),expectedWatchId:current.shift.id,expectedPreparationId:preparation?.id??null,notes};
    setSignCommand(command);setSigning(true);setSignError("");
    try{await props.onSignHandoff(command);setSignCommand(null);setEditingSigned(false);}catch(error){const status=(error as {status?:number}).status;if(status&&status>=400&&status<500)setSignCommand(null);setSignError(error instanceof Error?error.message:t("changeOver.failed"));}finally{setSigning(false);}
  };

  const itemEditor = (
    <div className="handoff-item-editor">
      <div role="tablist" aria-label={t("changeOver.shiftFollowUps")} className="handoff-tabs">
        {(["open", "resolved"] as const).map((view) => (
          <PngPillButton key={view} type="button" role="tab" aria-selected={itemView === view}
            color="brand" activeSrc={pillSrc} idleSrc={itemView === view ? pillSrc : undefined}
            onClick={() => setItemView(view)}>
            {t(view === "open" ? "changeOver.openItems" : "changeOver.resolvedItems")}
          </PngPillButton>
        ))}
      </div>
      <div className="handoff-items">
        {selectedItems.length === 0 && <p className="handoff-muted">{t("changeOver.none")}</p>}
        {selectedItems.map((item) => (
          <div key={item.id} data-testid={`carry-forward-item-${item.id}`} className="handoff-item">
            <p className="handoff-preserve">{item.text}</p>
            {mayEditItems && <div className="handoff-item-controls">
              <input
                aria-label={t(item.status === "open" ? "changeOver.resolutionNote" : "changeOver.reopenNote")}
                placeholder={t(item.status === "open" ? "changeOver.resolutionNote" : "changeOver.reopenNote")}
                value={itemNotes[item.id] ?? ""} maxLength={2000} disabled={blocked}
                onChange={(event) => onItemNoteChange(item.id, event.target.value)}
              />
              <PngPillButton type="button" color="brand" disabled={blocked || !itemNotes[item.id]?.trim()}
                onClick={() => onItemAction(item.id, item.status === "open" ? "resolve" : "reopen")}>
                {t(item.status === "open" ? "changeOver.markResolved" : "changeOver.reopen")}
              </PngPillButton>
            </div>}
          </div>
        ))}
      </div>
      {!stationId && itemView === "open" && mayEditItems && <div className="handoff-add-item">
        <textarea aria-label={t("changeOver.newItem")} placeholder={t("changeOver.newItem")}
          maxLength={2000} rows={2} value={itemText} disabled={blocked}
          onChange={(event) => onItemTextChange(event.target.value)} />
        <PngPillButton type="button" color="brand" disabled={blocked || !itemText.trim()} onClick={onAddItem}>
          {t("changeOver.addItem")}
        </PngPillButton>
      </div>}
    </div>
  );

  const savedReview = preparation && <div className="handoff-saved-review" data-testid="handoff-saved-review">
    <div className="handoff-provenance">
      <span data-source={preparation.summary.source}>
        {t(preparation.summary.source === "ai_selected_facts" ? "handoffDesk.selectedFacts" : "handoffDesk.recordedFacts")}
      </span>
      <span>{t("handoffDesk.savedAt")} <time dateTime={preparation.created_at}>{new Date(preparation.created_at).toLocaleString()}</time></span>
      <span>{t("changeOver.asOf")} <time dateTime={preparation.snapshot.generatedAt}>{new Date(preparation.snapshot.generatedAt).toLocaleString()}</time></span>
      {signature&&<span>{t("handoffDesk.signedBy",{name:signature.name})} · <time dateTime={signature.signedAt}>{new Date(signature.signedAt).toLocaleString()}</time></span>}
    </div>
    <div className="handoff-review-tree">
      <details className="handoff-review-branch" aria-label={t("handoffDesk.savedFacts")}>
        <summary><ClipboardCheck aria-hidden="true" /><h3>{t("handoffDesk.savedFacts")}</h3><small>{preparation.summary.facts.length}</small></summary>
        <div className="handoff-review-content">
        {preparation.summary.facts.length ? <ul className="handoff-facts">{preparation.summary.facts.map((fact) => <li key={fact.id}>{fact.text}</li>)}</ul> : <p className="handoff-muted">{t("changeOver.none")}</p>}
        </div>
      </details>
      <details className="handoff-review-branch" aria-label={t("handoffDesk.savedActions")}>
        <summary><ClipboardList aria-hidden="true" /><h3>{t("handoffDesk.savedActions")}</h3><small>{preparation.snapshot.openItems.length}</small></summary>
        <div className="handoff-review-content">
        {preparation.snapshot.openItems.length ? <ul className="handoff-facts">{preparation.snapshot.openItems.map((item) => <li key={item.id} className="handoff-preserve">{item.text}</li>)}</ul> : <p className="handoff-muted">{t("changeOver.none")}</p>}
        </div>
      </details>
      <details className="handoff-review-branch" aria-label={t("handoffDesk.savedNotes")} open={notesExpanded} onToggle={event=>setNotesExpanded(event.currentTarget.open)}>
        <summary data-guidance-id="saved-handoff"><NotebookPen aria-hidden="true" /><h3>{t("handoffDesk.savedNotes")}</h3></summary>
        <div className="handoff-review-content">
        <p className="handoff-preserve">{preparation.notes || t("changeOver.none")}</p>
        </div>
      </details>
    </div>
  </div>;

  return <section data-guidance-scope={scopeId} id="gate-turnover" className="gate-handoff-desk" aria-label={t("handoffDesk.title")}>
    <header className="handoff-heading">
      <span className="hub-card-icon"><ClipboardCheck aria-hidden="true" /></span>
      <div><h2>{t("handoffDesk.title")}</h2><p>{t(ownWatch ? "handoffDesk.outgoingIntro" : "handoffDesk.incomingIntro")}</p></div>
      {gatekeeperOnDuty && <aside className="handoff-next-actions" aria-label={t("handoffDesk.nextActions")} role="status">
        <h3>{t("handoffDesk.nextActions")}</h3>
        <p>{t(!ownWatch ? "handoffDesk.nextReview" : notes.trim() ? "handoffDesk.nextHandoff" : "handoffDesk.nextPrepare")}</p>
      </aside>}
      {current.shift&&ownWatch&&props.onSignHandoff?(
        signature&&!editingSigned
          ? <button type="button" className="handoff-edit-mini-card" disabled={blocked||signing} onClick={()=>setEditingSigned(true)}>{t("handoffDesk.edit")}</button>
          : <button data-guidance-id="sign-handoff" type="button" className="handoff-edit-mini-card" disabled={blocked||signing} onClick={()=>void signHandoff()}>{t("handoffDesk.signHandoff")}</button>
      ):current.shift&&current.supervisor&&props.onEditSave&&<button type="button" className="handoff-edit-mini-card" disabled={blocked} onClick={()=>{setEditNotes(preparation?.notes??notes);setEditError("");setEditing(true);}}>{t("handoffDesk.editShift")}</button>}
    </header>
    {signError&&<p role="alert">{signError}</p>}
    <Dialog open={editing} onOpenChange={setEditing}><MiniCardDialogContent icon={NotebookPen} label={t("handoffDesk.editShift")} definition={t("handoffDesk.saveExplanation")} iconColor="var(--brand-primary)" className="handoff-edit-dialog max-h-[86vh] sm:max-w-lg">
      <div className="handoff-edit-card" role="group" aria-label={t("handoffDesk.editShift")}>
        <label>{t("handoffDesk.savedNotes")}<textarea aria-label={t("handoffDesk.savedNotes")} rows={6} maxLength={8000} value={editNotes} disabled={editBusy||blocked} onChange={event=>setEditNotes(event.target.value)}/></label>
        {editError&&<p role="alert">{editError}</p>}
        <button type="button" className="handoff-edit-mini-card handoff-edit-save" disabled={editBusy||blocked||(editNotes===(preparation?.notes??notes)&&freshSaved)} onClick={()=>void (async()=>{setEditBusy(true);setEditError("");try{await props.onEditSave?.(editNotes);setEditing(false);}catch(error){setEditError(error instanceof Error?error.message:t("changeOver.failed"));}finally{setEditBusy(false);}})()}>{t("handoffDesk.save")}</button>
      </div>
    </MiniCardDialogContent></Dialog>

    {(!online || readError || (preparation && !freshSaved)) && <p className="handoff-notice" role="status">
      {t(!online ? "changeOver.offline" : readError ? "handoffDesk.refreshRequired" : "handoffDesk.changed")}
    </p>}

    {ownWatch&&(!signature||editingSigned) ? <>
      <div className="handoff-compose-panels">
        <section data-card-layout className="handoff-panel" aria-label={t("changeOver.carryForward")}>
          <CardHeading as="h3"><ClipboardList aria-hidden="true" />{t("changeOver.carryForward")}</CardHeading>
          {stationId && <GateTaskHopper stationId={stationId} showTitle={false} />}
          {(!stationId || current.items.length > 0) && itemEditor}
        </section>
        <section data-card-layout className="handoff-panel" aria-label="Add shift notes">
          <CardHeading as="h3"><NotebookPen aria-hidden="true" />Add shift notes</CardHeading>
          <p className="handoff-muted handoff-panel-description">{t("changeOver.outgoingNotes")}</p>
          <textarea data-guidance-id="handoff-notes" aria-label="New shift note" placeholder="Add a note for this watch"
            rows={4} maxLength={2000} value={newNote} disabled={blocked||noteBusy||Boolean(noteCommand)}
            onChange={(event) => setNewNote(event.target.value)} />
          <div className="handoff-note-actions">
            <button type="button" className="handoff-edit-mini-card" disabled={blocked||noteBusy||photoBusy||!newNote.trim()} onClick={()=>void addNote()}>Add shift note</button>
            <button type="button" className="handoff-edit-mini-card" disabled={blocked||noteBusy||photoBusy||notePhotos.length>=4} onClick={()=>photoInput.current?.click()}>Add photo</button>
            <input ref={photoInput} className="handoff-photo-input" type="file" accept="image/*" aria-label="Shift note photo" onChange={event=>void(async()=>{const file=event.target.files?.[0];event.target.value="";if(!file)return;setPhotoBusy(true);setNoteError("");try{const path=await uploadShiftNotePhoto(file);setNotePhotos(previous=>[...previous,path]);}catch(error){setNoteError(error instanceof Error?error.message:"Could not attach photo.");}finally{setPhotoBusy(false);}})()}/>
          </div>
          {notePhotos.length>0&&<p className="handoff-muted">{notePhotos.length} photo{notePhotos.length===1?"":"s"} attached to this note</p>}
          {noteError&&<p role="alert">{noteError}</p>}
          {!props.onSignHandoff&&<div className="handoff-save-row">
            <PngPillButton data-guidance-id="sign-handoff" type="button" color="brand" activeSrc={pillSrc}
              disabled={blocked || !current.shift || !revision || ready} onClick={onSave}>
              {t("handoffDesk.save")}
            </PngPillButton>
            <p className="handoff-muted">{t("handoffDesk.saveExplanation")}</p>
          </div>}
        </section>
      </div>
      <details className="handoff-disclosure" open={reviewExpanded} onToggle={event=>setReviewExpanded(event.currentTarget.open)}>
        <summary>{t(preparation ? "handoffDesk.previewSaved" : "handoffDesk.draftPreview")}</summary>
        {preparation ? savedReview : current.snapshot ? <div className="handoff-draft">
          <p className="handoff-muted">{t("handoffDesk.draftExplanation")} · {t("changeOver.asOf")} <time dateTime={current.snapshot.generatedAt}>{new Date(current.snapshot.generatedAt).toLocaleString()}</time></p>
          <ul className="handoff-facts">{current.snapshot.facts.map((fact) => <li key={fact.id}>{fact.text}</li>)}</ul>
        </div> : <p className="handoff-muted">{t("changeOver.none")}</p>}
      </details>
    </> : preparation ? <>
      {savedReview}
    </> : <p className="handoff-waiting" role="status">{t(current.shift ? "handoffDesk.waiting" : "handoffDesk.noWatch", { name: current.shift?.operator_name })}</p>}
    {stationId && current.items.length > 0 && (!ownWatch || (signature && !editingSigned)) && <details className="handoff-disclosure">
      <summary>{t("changeOver.carryForward")}</summary>
      {itemEditor}
    </details>}
    {!ownWatch&&current.shift&&props.onAddNote&&(current.supervisor||gatekeeperOnDuty)&&<section className="handoff-panel" aria-label="Add shift notes">
      <CardHeading as="h3"><NotebookPen aria-hidden="true" />Add shift notes</CardHeading>
      <p className="handoff-muted handoff-panel-description">{t("changeOver.outgoingNotes")}</p>
      <textarea aria-label="New shift note" placeholder="Add a note for this watch" rows={4} maxLength={2000} value={newNote} disabled={blocked||noteBusy||Boolean(noteCommand)} onChange={event=>setNewNote(event.target.value)}/>
      <div className="handoff-note-actions"><button type="button" className="handoff-edit-mini-card" disabled={blocked||noteBusy||photoBusy||!newNote.trim()} onClick={()=>void addNote()}>Add shift note</button><button type="button" className="handoff-edit-mini-card" disabled={blocked||noteBusy||photoBusy||notePhotos.length>=4} onClick={()=>photoInput.current?.click()}>Add photo</button><input ref={photoInput} className="handoff-photo-input" type="file" accept="image/*" aria-label="Shift note photo" onChange={event=>void(async()=>{const file=event.target.files?.[0];event.target.value="";if(!file)return;setPhotoBusy(true);setNoteError("");try{const path=await uploadShiftNotePhoto(file);setNotePhotos(previous=>[...previous,path]);}catch(error){setNoteError(error instanceof Error?error.message:"Could not attach photo.");}finally{setPhotoBusy(false);}})()}/></div>
      {notePhotos.length>0&&<p className="handoff-muted">{notePhotos.length} photo{notePhotos.length===1?"":"s"} attached to this note</p>}{noteError&&<p role="alert">{noteError}</p>}
    </section>}

    <details className="handoff-disclosure">
      <summary>{es ? "Informes de acceso" : "Gate handoffs"}<span className="handoff-disclosure-count">{(preparation?.snapshot ?? current.snapshot)?.linkedHandoffs?.length ?? 0}</span></summary>
      <div className="handoff-review-tree">{((preparation?.snapshot ?? current.snapshot)?.linkedHandoffs ?? []).map(note => <details key={note.id} className="handoff-review-branch">
        <summary><NotebookPen aria-hidden="true"/><span>{note.siteName} | {note.gateName}</span></summary>
        <div className="handoff-review-content"><small>{note.operatorName} · {new Date(note.createdAt).toLocaleString()}</small><p className="handoff-preserve">{note.notes || t("changeOver.none")}</p><a className="gate-all-shift-notes" href={`/gate/shift-notes?stationId=${note.stationId}&siteId=${note.siteId}`}>{es ? "Abrir notas" : "Open shift notes"}</a></div>
      </details>)}{!(preparation?.snapshot ?? current.snapshot)?.linkedHandoffs?.length && <p className="handoff-muted">{es ? "No hay otros informes guardados." : "No other saved gate handoffs."}</p>}</div>
    </details>
    {watchId&&<details className="handoff-disclosure" open={notesExpanded} onToggle={event=>setNotesExpanded(event.currentTarget.open)}>
      <summary>Shift notes<span className="handoff-disclosure-count">{watchNotes.length}</span></summary>
      {watchNotesBusy&&<p className="handoff-muted">Loading shift notes…</p>}
      {watchNotesError&&<p role="alert">{watchNotesError}</p>}
      {!watchNotesBusy&&!watchNotesError&&watchNotes.length===0&&<p className="handoff-muted">{t("changeOver.none")}</p>}
      <ul className="handoff-watch-notes">{watchNotes.map(note=><li key={note.id}><p className="handoff-preserve">{note.text}</p><small>{note.authorName} · {new Date(note.createdAt).toLocaleString()}</small>{note.photoPaths?.length>0&&<div className="handoff-note-photos">{note.photoPaths.map(path=><a key={path} href={`${apiBase}/api/storage${path}`} target="_blank" rel="noreferrer"><img src={`${apiBase}/api/storage${path}`} alt="Shift note attachment"/></a>)}</div>}</li>)}</ul>
    </details>}
    {pendingWatch && <div className="handoff-recovery" role="status">
      <p>{t("handoffDesk.pendingWatch")}</p>
      <PngPillButton type="button" color="brand" disabled={busy || !online} onClick={onRecoverWatch}>{t("handoffDesk.checkRequest")}</PngPillButton>
    </div>}
    {!ownWatch && (stationId || current.supervisor) && <details className="handoff-disclosure">
      <summary>{t("handoffDesk.addTaskToHopper")}</summary>{stationId ? <GateTaskHopper stationId={stationId} showTitle={false} /> : itemEditor}
    </details>}
    {!ownWatch&&<div className="handoff-assume" id="watch-review"><p>{t("handoffDesk.reviewExplanation")}</p><WatchPassControl guidanceId="review-watch" active={false} label={t("handoffDesk.assume")} disabled={!mayAssume} onClick={onAssumeReviewed}/></div>}

  </section>;
}
