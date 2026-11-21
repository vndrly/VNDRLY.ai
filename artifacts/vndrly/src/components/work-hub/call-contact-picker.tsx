import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Star } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { workHubRequest } from "@/lib/work-hub-client";
import { cn } from "@/lib/utils";
import { directoryRoleLabel, type DirectoryPerson } from "./collaboration";

type Props = {
  people: readonly DirectoryPerson[];
  loading: boolean;
  value: string;
  onChange: (value: string) => void;
  speedDial: readonly number[];
  speedDialBusy: boolean;
  onToggleSpeedDial: (contactId: number, saved: boolean) => void;
  sameCompanyFieldEmployeeLabel?: string;
};

function normalizeSearch(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();
}

export default function CallContactPicker({
  people, loading, value, onChange, speedDial, speedDialBusy, onToggleSpeedDial,
  sameCompanyFieldEmployeeLabel,
}: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [directorySearch, setDirectorySearch] = useState("");
  const [highlightedId, setHighlightedId] = useState<number>();
  const input = useRef<HTMLInputElement>(null);
  const popupId = useId();
  const term = search?.trim() ?? "";

  useEffect(() => {
    if (!open || !term) return;
    const timeout = window.setTimeout(() => setDirectorySearch(term), 200);
    return () => window.clearTimeout(timeout);
  }, [open, term]);
  const lookup = useQuery<DirectoryPerson[]>({
    queryKey: ["work-hub", "call-contact-search", user?.userId, user?.activeMembershipId, directorySearch],
    queryFn: () => workHubRequest(`/people?directory=calls&search=${encodeURIComponent(directorySearch)}`),
    enabled: open && !!term && directorySearch === term && term.length <= 100,
  });
  // The directory also matches email server-side without exposing addresses in the picker.
  const matchedIds = new Set(directorySearch === term && term ? lookup.data?.map(person => person.id) : []);
  const savedIds = new Set(speedDial);
  const words = normalizeSearch(term).split(/\s+/).filter(Boolean);
  const contacts = people
    .map(person => ({
      ...person,
      roleLabel: directoryRoleLabel(person, sameCompanyFieldEmployeeLabel),
      saved: savedIds.has(person.id),
    }))
    .filter(person => {
      const label = normalizeSearch([person.displayName, person.organizationName, person.roleLabel].filter(Boolean).join(" "));
      return matchedIds.has(person.id) || words.every(word =>
        label.includes(word) || (word.length > 3 && word.endsWith("s") && label.includes(word.slice(0, -1))),
      );
    })
    .sort((left, right) => Number(right.saved) - Number(left.saved));
  const active = contacts.find(person => person.id === highlightedId) ?? contacts[0];
  const cellId = (id: number) => `${popupId}-contact-${id}`;
  const starId = (id: number) => `${popupId}-star-${id}`;
  const selected = people.find(person => String(person.id) === value);
  const pendingSearch = !!term && term.length <= 100 && (directorySearch !== term || lookup.isFetching);

  function close() {
    setOpen(false);
    setSearch(null);
    setHighlightedId(undefined);
  }

  function choose(person: DirectoryPerson) {
    onChange(String(person.id));
    input.current?.focus();
    close();
  }

  function moveHighlight(direction: number, focusStar = false) {
    if (!contacts.length) return;
    const index = active ? contacts.indexOf(active) : 0;
    const next = contacts[(index + direction + contacts.length) % contacts.length];
    setHighlightedId(next.id);
    document.getElementById(cellId(next.id))?.scrollIntoView?.({ block: "nearest" });
    if (focusStar) document.getElementById(starId(next.id))?.focus();
  }

  return (
    <div
      className="relative"
      data-call-contact-picker
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onKeyDown={event => {
        if (!open || event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        input.current?.focus();
        close();
      }}
    >
      <div className="relative">
        <input
          ref={input}
          className="app-select-trigger h-9 w-full px-3 pr-9 text-sm"
          role="combobox"
          aria-label="Find a call contact"
          aria-autocomplete="list"
          aria-haspopup="grid"
          aria-expanded={open}
          aria-controls={open ? popupId : undefined}
          aria-activedescendant={open && active ? cellId(active.id) : undefined}
          autoComplete="off"
          placeholder="Search by name, company, or role"
          value={search ?? selected?.displayName ?? ""}
          onFocus={() => setOpen(true)}
          onClick={() => {
            setOpen(true);
            if (search === null && selected) input.current?.select();
          }}
          onChange={event => {
            if (value) onChange("");
            setSearch(event.target.value);
            setHighlightedId(undefined);
            setOpen(true);
          }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (open) moveHighlight(event.key === "ArrowDown" ? 1 : -1);
              else setOpen(true);
            } else if (event.key === "Enter" && open && active) {
              event.preventDefault();
              choose(active);
            }
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? "Hide call contacts" : "Show call contacts"}
          aria-expanded={open}
          className="absolute inset-y-0 right-0 grid w-9 place-items-center border-0 bg-transparent text-[var(--brand-primary)]"
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            if (open) close();
            else {
              input.current?.focus();
              setOpen(true);
            }
          }}
        >
          <ChevronDown aria-hidden="true" className="size-4" />
        </button>
      </div>
      {open && (
        <div className="app-select-menu absolute z-50 mt-1 w-full overflow-hidden border shadow-md">
          <div role="grid" id={popupId} aria-label="Call contacts" className="max-h-[min(60vh,24rem)] overflow-y-auto p-1">
            {contacts.map(person => (
              <div
                key={person.id}
                role="row"
                aria-selected={value === String(person.id)}
                data-highlighted={active?.id === person.id ? "" : undefined}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-sm px-1 transition-colors"
                onMouseDown={event => event.preventDefault()}
                onPointerMove={event => {
                  if (event.pointerType === "mouse" && active?.id !== person.id) setHighlightedId(person.id);
                }}
              >
                <div role="gridcell" id={cellId(person.id)} className="min-w-0">
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={[person.displayName, person.organizationName, person.roleLabel].filter(Boolean).join(", ")}
                    className="w-full cursor-pointer rounded-sm border-0 bg-transparent px-2 py-2 text-left focus-visible:outline-2"
                    onClick={() => choose(person)}
                  >
                    <span className="block break-words text-sm font-medium">{person.displayName}</span>
                    <span className="block break-words text-xs text-muted-foreground">
                      {[person.organizationName, person.roleLabel].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </div>
                <div role="gridcell">
                  <button
                    type="button"
                    id={starId(person.id)}
                    tabIndex={active?.id === person.id ? 0 : -1}
                    aria-label={person.saved ? `Remove ${person.displayName} from speed dial` : `Add ${person.displayName} to speed dial`}
                    aria-pressed={person.saved}
                    aria-disabled={speedDialBusy || undefined}
                    title={person.saved ? "Remove from speed dial" : "Add to speed dial"}
                    className="grid size-10 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-[var(--brand-primary)] hover:brightness-125 focus-visible:outline-2 aria-disabled:opacity-50"
                    onFocus={() => setHighlightedId(person.id)}
                    onClick={() => {
                      if (!speedDialBusy) onToggleSpeedDial(person.id, !person.saved);
                    }}
                    onKeyDown={event => {
                      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                      event.preventDefault();
                      moveHighlight(event.key === "ArrowDown" ? 1 : -1, true);
                    }}
                  >
                    <Star aria-hidden="true" className={cn("size-4", person.saved && "fill-current")} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {!contacts.length && (
            <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
              {loading || pendingSearch ? "Finding contacts…" : "No matching contacts."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
