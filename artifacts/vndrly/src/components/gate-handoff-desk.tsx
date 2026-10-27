import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardCheck, ClipboardList, NotebookPen } from "lucide-react";
import type { ChangeOverState } from "@workspace/gate-booth";
import { useBrand } from "@/hooks/use-brand";
import { PngPillButton, brandImagePillSrc } from "@/components/png-pill-rollover";
import WatchPassControl from "@/components/watch-pass-control";
import GateTaskHopper from "@/components/gate-task-hopper";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import "./gate-handoff-desk.css";

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
  onAddNote?: (input:{operationId:string;expectedWatchId:string;text:string}) => Promise<void>;
  onAssumeReviewed: () => void;
  pendingWatch: boolean;
  onRecoverWatch: () => void;
  reason: string;
  onReasonChange: (text: string) => void;
  onWithdraw: () => void;
}

/** Saving records the handoff. Only the incoming operator's explicit review action changes watch custody. */
export default function GateHandoffDesk(props: GateHandoffDeskProps) {
  const {
    current, stationId, ownWatch, gatekeeperOnDuty = false, busy, online, readError, notes, onNotesChange,
    itemText, onItemTextChange, itemNotes, onItemNoteChange, onItemAction,
    onAddItem, onSave, onAssumeReviewed, pendingWatch, onRecoverWatch,
  } = props;
  const { t } = useTranslation();
  const brand = useBrand();
  const [itemView, setItemView] = useState<"open" | "resolved">("open");
  const [editing,setEditing]=useState(false),[editNotes,setEditNotes]=useState(""),[editBusy,setEditBusy]=useState(false),[editError,setEditError]=useState("");
  const [newNote,setNewNote]=useState(""),[noteBusy,setNoteBusy]=useState(false),[noteError,setNoteError]=useState(""),[notesExpanded,setNotesExpanded]=useState(false);
  const [noteCommand,setNoteCommand]=useState<{operationId:string;expectedWatchId:string;text:string}|null>(null);
  const [reviewExpanded,setReviewExpanded]=useState(false);
  const preparation = current.preparation;
  const revision = current.snapshot?.revision;
  const freshSaved = Boolean(preparation && !current.stale && revision && revision === preparation.snapshot.revision);
  const ready = freshSaved && notes === preparation?.notes;
  const blocked = busy || !online || readError || pendingWatch;
  const mayEditItems = ownWatch || current.supervisor;
  const mayAssume = Boolean(!ownWatch && !blocked);
  const pillSrc = brandImagePillSrc(brand.primary, brand.name);
  const selectedItems = current.items.filter((item) => item.status === itemView);

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
      {itemView === "open" && mayEditItems && <div className="handoff-add-item">
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
        <summary><NotebookPen aria-hidden="true" /><h3>{t("handoffDesk.savedNotes")}</h3></summary>
        <div className="handoff-review-content">
        <p className="handoff-preserve">{preparation.notes || t("changeOver.none")}</p>
        </div>
      </details>
    </div>
  </div>;

  return <section className="gate-handoff-desk" aria-label={t("handoffDesk.title")}>
    <header className="handoff-heading">
      <span className="hub-card-icon"><ClipboardCheck aria-hidden="true" /></span>
      <div><h2>{t("handoffDesk.title")}</h2><p>{t(ownWatch ? "handoffDesk.outgoingIntro" : "handoffDesk.incomingIntro")}</p></div>
      {gatekeeperOnDuty && <aside className="handoff-next-actions" aria-label={t("handoffDesk.nextActions")} role="status">
        <h3>{t("handoffDesk.nextActions")}</h3>
        <p>{t(!ownWatch ? "handoffDesk.nextReview" : notes.trim() ? "handoffDesk.nextHandoff" : "handoffDesk.nextPrepare")}</p>
      </aside>}
      {current.shift&&(ownWatch||current.supervisor)&&props.onEditSave&&<button type="button" className="handoff-edit-mini-card" disabled={blocked} onClick={()=>{setEditNotes(preparation?.notes??notes);setEditError("");setEditing(true);}}>{t("handoffDesk.editShift")}</button>}
    </header>
    <Dialog open={editing} onOpenChange={setEditing}><DialogContent bare className="handoff-edit-dialog" accentHeaderStyle={{display:"none"}}>
      <DialogTitle>{t("handoffDesk.editShift")}</DialogTitle><DialogDescription>{t("handoffDesk.saveExplanation")}</DialogDescription>
      <label>{t("handoffDesk.savedNotes")}<textarea aria-label={t("handoffDesk.savedNotes")} rows={6} maxLength={8000} value={editNotes} disabled={editBusy||blocked} onChange={event=>setEditNotes(event.target.value)}/></label>
      {editError&&<p role="alert">{editError}</p>}
      <PngPillButton type="button" color="brand" activeSrc={pillSrc} disabled={editBusy||blocked||(editNotes===(preparation?.notes??notes)&&freshSaved)} onClick={()=>void (async()=>{setEditBusy(true);setEditError("");try{await props.onEditSave?.(editNotes);setEditing(false);}catch(error){setEditError(error instanceof Error?error.message:t("changeOver.failed"));}finally{setEditBusy(false);}})()}>{t("handoffDesk.save")}</PngPillButton>
    </DialogContent></Dialog>

    {(!online || readError || (preparation && !freshSaved)) && <p className="handoff-notice" role="status">
      {t(!online ? "changeOver.offline" : readError ? "handoffDesk.refreshRequired" : "handoffDesk.changed")}
    </p>}

    {ownWatch ? <>
      <div className="handoff-compose-panels">
        <section className="handoff-panel" aria-label={t("changeOver.carryForward")}>
          <h3><ClipboardList aria-hidden="true" />{t("changeOver.carryForward")}</h3>
          {stationId ? <GateTaskHopper stationId={stationId} showTitle={false} /> : itemEditor}
        </section>
        <section className="handoff-panel" aria-label={t("changeOver.outgoingNotes")}>
          <h3><NotebookPen aria-hidden="true" />{t("changeOver.outgoingNotes")}</h3>
          <textarea aria-label={t("changeOver.outgoingNotes")} placeholder={t("handoffDesk.notesHint")}
            rows={4} maxLength={8000} value={notes} disabled={blocked}
            onChange={(event) => onNotesChange(event.target.value)} />
          <div className="handoff-save-row">
            <PngPillButton type="button" color="brand" activeSrc={pillSrc}
              disabled={blocked || !current.shift || !revision || ready} onClick={onSave}>
              {t("handoffDesk.save")}
            </PngPillButton>
            <p className="handoff-muted">{t("handoffDesk.saveExplanation")}</p>
          </div>
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
      <div className="handoff-assume" id="watch-review">
        <p>{t("handoffDesk.reviewExplanation")}</p>
        <WatchPassControl active={false} label={t("handoffDesk.assume")} disabled={!mayAssume} onClick={onAssumeReviewed} />
      </div>
    </> : <div className="handoff-assume"><p className="handoff-waiting" role="status">{t(current.shift ? "handoffDesk.waiting" : "handoffDesk.noWatch", { name: current.shift?.operator_name })}</p><WatchPassControl active={false} label={t("handoffDesk.assume")} disabled={!mayAssume} onClick={onAssumeReviewed}/></div>}

    {pendingWatch && <div className="handoff-recovery" role="status">
      <p>{t("handoffDesk.pendingWatch")}</p>
      <PngPillButton type="button" color="brand" disabled={busy || !online} onClick={onRecoverWatch}>{t("handoffDesk.checkRequest")}</PngPillButton>
    </div>}
    {!ownWatch && (stationId || current.supervisor) && <details className="handoff-disclosure">
      <summary>{t("handoffDesk.addTaskToHopper")}</summary>{stationId ? <GateTaskHopper stationId={stationId} showTitle={false} /> : itemEditor}
    </details>}
    {current.shift&&props.onAddNote&&(ownWatch||current.supervisor||gatekeeperOnDuty)&&<details className="handoff-disclosure">
      <summary>{t("handoffDesk.addNewNote")}</summary>
      <div className="handoff-add-item"><textarea aria-label={t("handoffDesk.newNote")} rows={3} maxLength={2000} value={newNote} disabled={blocked||noteBusy||Boolean(noteCommand)} onChange={event=>setNewNote(event.target.value)}/>
      {ownWatch&&notes!==(preparation?.notes??"")&&<p>{t("handoffDesk.saveDraftFirst")}</p>}
      {noteError&&<p role="alert">{noteError}</p>}
      <PngPillButton type="button" color="brand" activeSrc={pillSrc} disabled={blocked||noteBusy||!newNote.trim()||(ownWatch&&notes!==(preparation?.notes??""))} onClick={()=>void (async()=>{
        const command=noteCommand??{operationId:crypto.randomUUID(),expectedWatchId:current.shift!.id,text:newNote.trim()};setNoteCommand(command);setNoteBusy(true);setNoteError("");
        try{await props.onAddNote!(command);setNewNote("");setNoteCommand(null);setNotesExpanded(true);setReviewExpanded(true);}catch(error){const status=(error as {status?:number}).status;if(status&&status>=400&&status<500)setNoteCommand(null);setNoteError(error instanceof Error?error.message:t("changeOver.failed"));}finally{setNoteBusy(false);}
      })()}>{t("handoffDesk.addNote")}</PngPillButton></div>
    </details>}
    <p className="handoff-independence">{t("handoffDesk.independent")}</p>
  </section>;
}
