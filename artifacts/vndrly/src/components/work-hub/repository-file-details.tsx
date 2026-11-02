import { useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { X, FileText, Layers } from "lucide-react";
import { useRepository } from "./repository-client";
import { FolderPicker } from "./repository-folders";
import OptionSwitch from "./library/option-switch";
import { emptyAudience } from "./repository-audience";
export function RepositoryFileDetails({
  document,
  onClose,
}: {
  document: {
    id: string;
    createdBy: number;
    createdAt?: string;
    updatedAt?: string;
    canManage: boolean;
    data: Record<string, any>;
  };
  onClose: () => void;
}) {
  const repo = useRepository(),
    d = repo.data;
  const [training, setTraining] = useState(
      document.data.purpose === "training",
    ),
    [folder, setFolder] = useState(document.data.folderId ?? ""),
    [trip, setTrip] = useState(document.data.tripId ?? ""),
    [categories, setCategories] = useState<string[]>(
      document.data.categoryIds ?? [],
    ),
    [target, setTarget] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        className="vendor-repository repo-flyout space-y-3 w-full sm:max-w-[560px]"
        aria-describedby={undefined}
      >
        <SheetTitle className="sr-only">File details</SheetTitle>
        <div className="flex justify-between items-center">
          <h2 className="flex items-center gap-2">
            <FileText size={18} />
            {document.data.name}
          </h2>
          <button
            className="repo-action"
            aria-label="Close file details"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <dl className="space-y-2">
          <div>
            <dt className="font-semibold">Created by</dt>
            <dd>
              {d?.creators.find((p) => p.id === document.createdBy)?.name ??
                `User ${document.createdBy}`}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Created on</dt>
            <dd>
              {document.createdAt
                ? new Date(document.createdAt).toLocaleString()
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Updated by</dt>
            <dd>
              {d?.creators.find((p) => p.id === document.data.updatedBy)
                ?.name ??
                d?.creators.find((p) => p.id === document.createdBy)?.name ??
                "—"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Last updated</dt>
            <dd>
              {document.updatedAt
                ? new Date(document.updatedAt).toLocaleString()
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Attribution/source</dt>
            <dd>
              {document.data.uploadSource ??
                (document.data.channelId ? "Conversation" : "Repository")}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Type / size</dt>
            <dd>
              {document.data.contentType ?? "File"} ·{" "}
              {Math.ceil((document.data.byteSize ?? 0) / 1024)} KB
            </dd>
          </div>
        </dl>
        {document.canManage && d && (
          <>
            <FolderPicker data={d} value={folder} onChange={setFolder} />
            <OptionSwitch
              label="Designate as training materials"
              value={training}
              onChange={setTraining}
            />
            <details>
              <summary>Categories</summary>
              {d.folders.map((f) => (
                <OptionSwitch
                  key={f.id}
                  label={f.data.name}
                  value={categories.includes(f.id)}
                  onChange={(on) =>
                    setCategories(
                      on
                        ? [...categories, f.id]
                        : categories.filter((id) => id !== f.id),
                    )
                  }
                />
              ))}
            </details>
            <label className="block">
              Travel / traveler
              <select
                aria-label="Travel association"
                className="w-full rounded border p-2"
                value={trip}
                onChange={(e) => setTrip(e.target.value)}
              >
                <option value="">Not associated with Travel</option>
                {d.trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.data.title} · {t.data.travelerName}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="repo-action"
              disabled={repo.pending}
              onClick={async () => {
                await repo.save({
                  action: "file-details",
                  version: document.data.version ?? 1,
                  payload: {
                    id: document.id,
                    training,
                    categoryIds: categories,
                    folderId: folder || null,
                    tripId: trip || null,
                  },
                });
                setNotice("File details saved.");
              }}
            >
              Save file details
            </button>
          </>
        )}
        {d?.canManageTraining && (
          <section className="repository-card space-y-2">
            <h3 className="flex items-center gap-2">
              <Layers size={16} />
              Add to…
            </h3>
            <label>
              Course / certification
              <select
                className="w-full rounded border p-2"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">
                  Choose VNDRLY/U course or certification
                </option>
                {d.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="repo-action"
              disabled={repo.pending || !target}
              onClick={async () => {
                await repo.save({
                  action: "augment",
                  payload: {
                    title: `${d.courses.find((c) => c.id === target)?.title} · Vendor augmented`,
                    baseItemId: target,
                    courseIds: [],
                    documentIds: [document.id],
                    required: true,
                    audience: emptyAudience,
                  },
                });
                setNotice(
                  "Added to Vendor Augmented. Choose its recipients in VNDRLY/U.",
                );
              }}
            >
              Add material
            </button>
          </section>
        )}
        {repo.error && <p role="alert">{repo.error}</p>}
        {notice && <p role="status">{notice}</p>}
      </SheetContent>
    </Sheet>
  );
}
