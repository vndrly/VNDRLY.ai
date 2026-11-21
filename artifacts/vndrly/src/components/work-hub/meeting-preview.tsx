import { MeetingRecapItems } from "../meeting-recap-items";
import { Root as AgendaPopover } from "@radix-ui/react-popover";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { SpeakingBars } from "../meeting-workspace";
import { Mic, MicOff, LogOut, PhoneOff, MessageSquare, MessageSquareOff, Plus, ArrowUp, FileText, ListTodo, ListChecks, Search, CalendarDays, UserCog, UserX, UserPlus } from "lucide-react";
import { useState } from "react";
import { WorkHubMiniCardButton } from "./chrome";
import "../meeting-workspace.css";

const meetingToolIcons: Record<string, typeof FileText> = { Summary: FileText, "Action Items": ListTodo, Decisions: ListChecks, Search, Agenda: CalendarDays, "Manage Attendees": UserCog, UserX, UserPlus };
// Local visual fixture: no meeting API, invitations, microphone, or uploads.
export default function MeetingPreview({ onExit }: { onExit: () => void }) {
  const [invitedPeople, setInvitedPeople] = useState(["Jordan"]);
  const [managedPerson, setManagedPerson] = useState("");
  const [mutedPeople, setMutedPeople] = useState<string[]>([]);
  const [bootedPeople, setBootedPeople] = useState<string[]>([]);
  const [tool, setTool] = useState("Summary");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<{text: string; recipient: string | null}[]>([]);
  const [muted, setMuted] = useState(false);
  const [recipient, setRecipient] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const tools = ["Summary", "Action Items", "Decisions", "Search", "Agenda", "Manage Attendees"];
  return <section className="space-y-3" aria-label="Mock meeting preview">
    <section className="meeting-workspace" style={{ "--meeting-brand": "var(--brand-primary)" } as React.CSSProperties}>
      <div className="meeting-scroll-content">
      <header className="meeting-header"><div className="meeting-heading"><h2>Morning field coordination</h2><div className="meeting-presence-row"><span className="meeting-host">You · Host</span><span>4 present · 08:42</span><span className="meeting-current-speaker" role="status"><SpeakingBars active />Alex speaking</span></div>
        <div className="meeting-actions"><button type="button" className="meeting-icon-button" aria-label={muted ? "Unmute mic" : "Mute mic"} title={muted ? "Unmute mic" : "Mute mic"} aria-pressed={muted} onClick={() => setMuted(!muted)}>{muted ? <MicOff /> : <Mic />}</button><button type="button" className="meeting-icon-button" aria-label="Leave" title="Leave" onClick={onExit}><LogOut /></button><button type="button" className="meeting-icon-button" aria-label="End" title="End" onClick={onExit}><PhoneOff /></button></div>
      </div><details className="meeting-tools" open><summary>Meeting Tools</summary><div className="meeting-tool-actions">{tools.map(name => { const Icon = meetingToolIcons[name]; if (name === "Agenda") return <AgendaPopover key={name} open={tool === "Agenda"} onOpenChange={open => setTool(open ? "Agenda" : "")}><PopoverTrigger asChild><button type="button" className="meeting-icon-button" aria-label="Agenda" title="Agenda"><CalendarDays /></button></PopoverTrigger><PopoverContent align="start" className="meeting-agenda-flyout"><p>Assignments · Equipment delivery · Documents and receipts</p></PopoverContent></AgendaPopover>; return <button type="button" className="meeting-icon-button" key={name} aria-label={name} title={name} aria-pressed={tool === name} onClick={() => setTool(current => current === name ? "" : name)}><Icon /></button>; })}</div><div className="meeting-tool-body" aria-label={tool || undefined} hidden={!tool}>
        {tool === "Summary" && <p>The team reviewed assignments, the work plan, and equipment delivery.</p>}
        {tool === "Action Items" && <MeetingRecapItems value={[{id:"delivery",text:"Confirm equipment delivery",status:"open",owner:"Morgan",due:"Before noon"}]} />}
        {tool === "Decisions" && <MeetingRecapItems value={[{id:"plan",text:"Use the reviewed work plan for today’s assignments.",status:"confirmed"},{id:"supplier",text:"Which supplier will provide the additional equipment?",status:"open"},{id:"budget",text:"Review next week’s equipment budget.",status:"deferred"}]} />}
        {tool === "Search" && <div className="meeting-search"><input aria-label="Search preview" placeholder="Search text, names, or filenames" /></div>}
        {tool === "Manage Attendees" && <div className="meeting-manage-compact"><Select value={managedPerson} onValueChange={setManagedPerson}><SelectTrigger aria-label="Choose participant"><SelectValue placeholder="Choose participant" /></SelectTrigger><SelectContent>{["You", "Alex", "Morgan", "Taylor", ...invitedPeople].filter(name => !bootedPeople.includes(name)).map(name => <SelectItem key={name} value={name}>{invitedPeople.includes(name) && <span className="meeting-absent-label">Absent </span>}<span className={invitedPeople.includes(name) ? "meeting-absent-name" : undefined}>{name}</span></SelectItem>)}</SelectContent></Select><button type="button" className="meeting-icon-button" aria-label={recipient ? "Stop PM" : "Private message"} title={recipient ? "Stop PM" : "Private message"} disabled={!recipient && (!managedPerson || managedPerson === "You" || invitedPeople.includes(managedPerson))} onClick={() => { setRecipient(recipient ? null : managedPerson); setDraft(""); }}>{recipient ? <MessageSquareOff /> : <MessageSquare />}</button><button type="button" className="meeting-icon-button" disabled={!managedPerson || managedPerson === "You" || invitedPeople.includes(managedPerson)} aria-label={mutedPeople.includes(managedPerson) ? "Unmute attendee" : "Mute attendee"} title={mutedPeople.includes(managedPerson) ? "Unmute attendee" : "Mute attendee"} onClick={() => setMutedPeople(mutedPeople.includes(managedPerson) ? mutedPeople.filter(name => name !== managedPerson) : [...mutedPeople, managedPerson])}>{mutedPeople.includes(managedPerson) ? <Mic /> : <MicOff />}</button><button type="button" className="meeting-icon-button" disabled={!managedPerson || managedPerson === "You" || invitedPeople.includes(managedPerson)} aria-label="Boot attendee" title="Boot attendee" onClick={() => { setBootedPeople([...bootedPeople, managedPerson]); setManagedPerson(""); }}><UserX /></button><Popover><PopoverTrigger asChild><button type="button" className="meeting-icon-button" aria-label="Invite to meeting" title="Invite to meeting"><UserPlus /></button></PopoverTrigger><PopoverContent className="meeting-pm-flyout" align="start"><div className="meeting-roster">{["Casey", "Riley"].filter(name => !invitedPeople.includes(name)).map(name => <button type="button" key={name} onClick={() => setInvitedPeople(people => [...people, name])}>{name}<UserPlus size={16} /></button>)}</div></PopoverContent></Popover></div>}
      </div></details></header>
      
      <div className="meeting-timeline-label"><span>{recipient ? `Private with ${recipient}` : "Live transcript"}</span></div>
      <div className="meeting-timeline" role="log" aria-label="Preview transcript">
        {!recipient && <><article className="meeting-message"><div className="meeting-message-heading"><strong>Alex</strong><time>8:30 AM</time></div><p>The crew is ready. Let’s review today’s assignments.</p></article>
        <article className="meeting-message meeting-message-own"><div className="meeting-message-heading"><strong>You</strong><time>8:31 AM</time></div><p>I’ve added the work plan and receipt for review.</p><div className="meeting-attachment">Work plan.pdf<br/>Equipment receipt.jpg</div></article>
        <article className="meeting-message"><div className="meeting-message-heading"><strong>Morgan</strong><time>8:32 AM</time></div><p>I’ll confirm the equipment delivery before noon.</p></article>
        </>}
        {messages.filter(message => message.recipient === recipient).map((message, index) => <article key={index} className="meeting-message meeting-message-own"><strong>You</strong><p>{message.text}</p></article>)}
      </div>
      {notice && <p role="status">{notice}</p>}
      
      </div>
      <div className="meeting-composer"><div className="meeting-input-row"><Popover><PopoverTrigger asChild><button type="button" className="meeting-icon-button" aria-label="Add attachment" title="Add attachment"><Plus /></button></PopoverTrigger><PopoverContent side="top" align="start" collisionPadding={12} className="meeting-pm-flyout"><div className="meeting-roster"><button type="button" onClick={() => setNotice("Camera is available in a real meeting.")}>Camera</button><button type="button" onClick={() => setNotice("Photos is available in a real meeting.")}>Photos</button><button type="button" onClick={() => setNotice("Files is available in a real meeting.")}>Files</button></div></PopoverContent></Popover>
        <textarea aria-label="Preview message" placeholder="Message the meeting…" value={draft} onChange={event => setDraft(event.target.value)} /><button type="button" className="meeting-icon-button meeting-send" aria-label="Send" title="Send" disabled={!draft.trim()} onClick={() => { setMessages([...messages, {text: draft, recipient}]); setDraft(""); }}><ArrowUp /></button></div>
      </div>
    </section>
  </section>;
}
