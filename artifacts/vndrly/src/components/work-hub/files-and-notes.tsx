import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { WorkHubFiles } from "./files";
import { HubError } from "./collaboration";
import BrandPillButton from "@/components/brand-pill-button";
import {
  PngPillButton,
  brandImagePillSrc,
} from "@/components/png-pill-rollover";
import { useBrand } from "@/hooks/use-brand";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { commandEnvelope, workHubRequest } from "@/lib/work-hub-client";
type Channel = {
  id: string;
  name: string;
  ownerOrgType: "vendor" | "partner";
  ownerOrgId: number;
};
type Note = {
  id: string;
  title: string;
  body: string;
  version: number;
  updatedAt: string;
};
export function NativeNotes() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState(
    () => new URLSearchParams(window.location.search).get("channel") ?? "",
  );
  const [edit, setEdit] = useState<Note | null>(null);
  const [form, setForm] = useState({ title: "", body: "" });
  const channels = useQuery<Channel[]>({
    queryKey: ["work-hub", "channels", user?.userId, user?.activeMembershipId],
    queryFn: () => workHubRequest("/channels"),
  });
  const active = selected || channels.data?.[0]?.id;
  const channel = channels.data?.find((c) => c.id === active);
  const notes = useQuery<Note[]>({
    queryKey: ["work-hub", "notes", active, user?.userId, user?.activeMembershipId],
    queryFn: () => workHubRequest(`/channels/${active}/notes`),
    enabled: !!active,
  });
  const save = useMutation({
    mutationFn: () =>
      workHubRequest(`/channels/${active}/notes${edit ? `/${edit.id}` : ""}`, {
        method: edit ? "PATCH" : "POST",
        body: JSON.stringify(
          commandEnvelope(
            { type: channel!.ownerOrgType, id: channel!.ownerOrgId },
            form,
            undefined,
            edit?.version,
          ),
        ),
      }),
    onSuccess: () => {
      setEdit(null);
      setForm({ title: "", body: "" });
      return qc.invalidateQueries({ queryKey: ["work-hub"] });
    },
  });
  return (
    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside>
        <label className="grid gap-2 text-sm font-semibold">
          Notes shared with
          <select
            className="h-10 rounded border bg-background px-3"
            value={active ?? ""}
            onChange={(e) => {
              setSelected(e.target.value);
              setEdit(null);
              setForm({ title: "", body: "" });
            }}
          >
            <option value="">Choose a channel</option>
            {channels.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-3 text-xs text-muted-foreground">
          Native notes stay with the channel and retain version history when
          edited.
        </p>
      </aside>
      <main className="space-y-4">
        <HubError error={channels.error ?? notes.error ?? save.error} />
        {notes.isLoading && <p role="status">Loading notes…</p>}
        {notes.data?.map((note) => (
          <article key={note.id} className="rounded-lg border bg-card p-4">
            <h2 className="font-semibold">{note.title}</h2>
            <p className="my-3 whitespace-pre-wrap text-sm">{note.body}</p>
            <div className="flex items-center justify-between gap-3">
              <time className="text-xs text-muted-foreground">
                Updated {new Date(note.updatedAt).toLocaleString()} · Version{" "}
                {note.version}
              </time>
              <BrandPillButton
                tone="blue"
                onClick={() => {
                  setEdit(note);
                  setForm({ title: note.title, body: note.body });
                }}
              >
                Edit note
              </BrandPillButton>
            </div>
          </article>
        ))}
        {!notes.isLoading && !notes.data?.length && (
          <p className="text-sm text-muted-foreground">
            No native notes in this channel yet.
          </p>
        )}
        {channel && (
          <form
            className="grid gap-3 rounded-lg border bg-card p-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <h2 className="font-semibold">
              {edit ? "Edit note" : "New native note"}
            </h2>
            <Input
              aria-label="Note title"
              placeholder="Note title"
              required
              maxLength={180}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <Textarea
              aria-label="Note text"
              placeholder="Write a working note"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
            <div className="flex gap-3">
              <BrandPillButton
                tone="blue"
                type="submit"
                disabled={save.isPending}
              >
                Save note
              </BrandPillButton>
              {edit && (
                <BrandPillButton
                  tone="image"
                  onClick={() => {
                    setEdit(null);
                    setForm({ title: "", body: "" });
                  }}
                >
                  Cancel edit
                </BrandPillButton>
              )}
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
function ExistingUploads() {
  const { user } = useAuth();
  const files = useQuery<
    Array<{
      id: string;
      fileName: string;
      contentType: string;
      byteSize: number;
      finalizedAt: string;
    }>
  >({
    queryKey: ["work-hub", "legacy-files", user?.userId, user?.activeMembershipId],
    queryFn: () => workHubRequest("/file-library/legacy"),
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Files uploaded before the new library remain available with their
        original access permissions.
      </p>
      <HubError error={files.error} />
      {files.isLoading && <p role="status">Loading existing uploads…</p>}
      {files.data?.map((file) => (
        <article
          key={file.id}
          className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-4"
        >
          <div>
            <h2 className="font-semibold">{file.fileName}</h2>
            <p className="text-xs text-muted-foreground">
              {file.contentType} · {Math.ceil(file.byteSize / 1024)} KB ·{" "}
              {new Date(file.finalizedAt).toLocaleString()}
            </p>
          </div>
          <div className="flex gap-4 text-sm">
            <a
              className="underline"
              href={`/api/work-hub/file-library/legacy/${file.id}/download`}
            >
              Download
            </a>
            <a
              className="underline"
              href={`/api/work-hub/file-library/legacy/${file.id}/download?preview=1`}
              target="_blank"
              rel="noreferrer"
            >
              Preview
            </a>
          </div>
        </article>
      ))}
      {!files.isLoading && !files.data?.length && (
        <p className="text-sm text-muted-foreground">
          No earlier uploads are available in your current memberships.
        </p>
      )}
    </div>
  );
}
export function FilesAndNotes() {
  const [tab, setTab] = useState("files");
  const brand = useBrand();
  const brandPillSrc = brandImagePillSrc(brand.primary, brand.name);
  return (
    <section className="mx-auto max-w-7xl rounded-xl border bg-card p-4 shadow-sm md:p-6">
      <h1 className="text-2xl font-semibold">Files & Notes</h1>
      <div className="my-5 flex flex-wrap gap-2" role="tablist">
        {["files", "notes", "existing"].map((key) => (
          <PngPillButton
            key={key}
            role="tab"
            aria-selected={tab === key}
            aria-pressed={tab === key}
            activeSrc={brandPillSrc}
            idleSrc={tab === key ? brandPillSrc : undefined}
            onClick={() => setTab(key)}
          >
            {key === "files"
              ? "File library"
              : key === "notes"
                ? "Native notes"
                : "Existing uploads"}
          </PngPillButton>
        ))}
      </div>
      {tab === "files" ? (
        <WorkHubFiles />
      ) : tab === "notes" ? (
        <NativeNotes />
      ) : (
        <ExistingUploads />
      )}
    </section>
  );
}
