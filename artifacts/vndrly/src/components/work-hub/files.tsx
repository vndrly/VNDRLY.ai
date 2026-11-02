import { useRepository } from "./repository-client";
import { FolderPicker } from "./repository-folders";
import { RepositoryFileDetails } from "./repository-file-details";
import OptionSwitch from "./library/option-switch";
import "./repository-theme.css";
import {
  ShareFileToChannel,
  type FileShareChannel,
} from "./share-file-to-channel";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  ownerForUser,
  workHubRequest,
  commandEnvelope,
  createWorkHubOperationId,
} from "@/lib/work-hub-client";
import { Button } from "@/components/ui/button";
import BrandPillButton from "@/components/brand-pill-button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  FileText,
  Star,
  Download,
  History,
  Trash2,
  RotateCcw,
  Share2,
  Upload,
} from "lucide-react";
import { BrandedSelect, WorkHubCardTitle } from "./chrome";
import { useMeetingSession } from "@/components/meeting-session-provider";
import { withRequestDeadline } from "@/lib/request-deadline";
type Document = {
  id: string;
  createdBy: number;
  createdAt?: string;
  updatedAt?: string;
  orgType: "vendor" | "partner";
  orgId: number;
  data: {
    name: string;
    scope: string;
    purpose?: string;
    folderId?: string;
    tripId?: string;
    uploadSource?: string;
    categoryIds?: string[];
    channelId: string | null;
    state: string;
    contentType?: string;
    byteSize?: number;
    versions: string[];
    currentFileId: string | null;
  };
  favorite: boolean;
  canManage: boolean;
};
type UploadReservation = {
  file: File;
  uploadOwner: { type: "vendor" | "partner"; id: number };
  finalizeOperationId: string;
  resource: { documentId: string; fileId: string; uploadURL: string };
};
export function WorkHubFiles({
  fixedChannelId,
  initialFile,
  onInitialFileConsumed,
  defaultScope = "company",
  trainingMaterials = false,
  tripId,
  folderView,
}: {
  folderView?: string | null;
  tripId?: string;
  trainingMaterials?: boolean;
  defaultScope?: "personal" | "company";
  fixedChannelId?: string;
  initialFile?: File;
  onInitialFileConsumed?: () => void;
} = {}) {
  const { user } = useAuth();
  const repository = useRepository();
  const [folderId, setFolderId] = useState("");
  const [isTraining, setIsTraining] = useState(trainingMaterials);
  const [details, setDetails] = useState<Document | null>(null);
  const [sort, setSort] = useState("updated");
  const owner = ownerForUser(user);
  const cache = useQueryClient();
  const meetingSession = useMeetingSession();
  const input = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState(() =>
    trainingMaterials
      ? "company"
      : fixedChannelId ||
          new URLSearchParams(window.location.search).get("channel")
        ? "channel"
        : meetingSession?.occurrenceId
          ? "meeting"
          : defaultScope,
  );
  const [channelId, setChannelId] = useState(
    () =>
      fixedChannelId ??
      new URLSearchParams(window.location.search).get("channel") ??
      "",
  );
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState<Document | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingOperationId, setPendingOperationId] = useState<string | null>(
    null,
  );
  const [reservationStarted, setReservationStarted] = useState(false);
  const [reservedUpload, setReservedUpload] =
    useState<UploadReservation | null>(null);
  const [versions, setVersions] = useState<string | null>(null);
  const [share, setShare] = useState<{
    token: string;
    expiresAt: string;
  } | null>(null);
  useEffect(() => {
    setShare(null);
    setReplace(null);
    setPendingFile(null);
    setPendingOperationId(null);
    setReservationStarted(false);
    setReservedUpload(null);
    setVersions(null);
    if (input.current) input.current.value = "";
  }, [user?.userId, user?.activeMembershipId, owner?.type, owner?.id]);
  useEffect(() => {
    if (!initialFile || !fixedChannelId) return;
    setPendingFile(initialFile);
    setPendingOperationId(createWorkHubOperationId());
    onInitialFileConsumed?.();
  }, [initialFile, fixedChannelId, onInitialFileConsumed]);
  useEffect(() => {
    if (
      !trainingMaterials &&
      !fixedChannelId &&
      meetingSession?.occurrenceId &&
      !pendingFile &&
      !replace
    )
      setScope("meeting");
  }, [fixedChannelId, meetingSession?.occurrenceId, pendingFile, replace]);
  const queryKey = [
    "work-hub-file-library",
    user?.userId,
    user?.activeMembershipId,
    owner?.type,
    owner?.id,
    trainingMaterials,
    tripId,
  ];
  const query = useQuery({
    queryKey,
    enabled: !!owner,
    queryFn: async () => {
      await workHubRequest("/file-library/sync-references", {
        method: "POST",
        body: JSON.stringify(owner),
      });
      return workHubRequest<Document[]>(
        `/file-library?orgType=${owner!.type}&orgId=${owner!.id}${trainingMaterials ? "&purpose=training" : ""}`,
      );
    },
  });
  const channels = useQuery({
    queryKey: ["work-hub-channels", user?.userId, user?.activeMembershipId],
    enabled: !!owner,
    queryFn: () => workHubRequest<FileShareChannel[]>("/channels?limit=100"),
  });
  const change = useMutation({
    mutationFn: async ({
      action,
      payload,
    }: {
      action: string;
      payload: unknown;
    }) => {
      const target = query.data?.find(
        (doc) => doc.id === (payload as { id?: string }).id,
      );
      const targetOwner = target
        ? { type: target.orgType, id: target.orgId }
        : owner!;
      const result = await workHubRequest<{ resource: any }>(
        `/file-library/${action}`,
        {
          method: "POST",
          body: JSON.stringify(commandEnvelope(targetOwner, payload)),
        },
      );
      if (action === "share") setShare(result.resource);
      return result;
    },
    onSuccess: () => cache.invalidateQueries({ queryKey }),
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size <= 0 || file.size > 25 * 1024 * 1024)
        throw new Error("Choose a non-empty file no larger than 25 MB.");
      if (scope === "meeting" && meetingSession?.occurrenceId && !replace) {
        const operationId = pendingOperationId ?? createWorkHubOperationId();
        if (!pendingOperationId) setPendingOperationId(operationId);
        setReservationStarted(true);
        await workHubRequest(
          `/meetings/${meetingSession.occurrenceId}/files/${operationId}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": file.type || "application/octet-stream",
              "x-file-name": encodeURIComponent(file.name),
            },
            body: file,
          },
        );
        return;
      }
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await file.arrayBuffer(),
      );
      const checksumSha256 = [...new Uint8Array(digest)]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
      setReservationStarted(true);
      const channel = channels.data?.find((c) => c.id === channelId);
      const uploadOwner = replace
        ? { type: replace.orgType, id: replace.orgId }
        : scope === "channel" && channel
          ? {
              type: channel.ownerOrgType as "vendor" | "partner",
              id: channel.ownerOrgId,
            }
          : owner!;
      let reservation = reservedUpload?.file === file ? reservedUpload : null;
      if (!reservation) {
        const operationId = pendingOperationId ?? createWorkHubOperationId();
        if (!pendingOperationId) setPendingOperationId(operationId);
        const reserved = await workHubRequest<{
          resource: { documentId: string; fileId: string; uploadURL: string };
        }>("/file-library/reserve", {
          method: "POST",
          body: JSON.stringify(
            commandEnvelope(
              uploadOwner,
              {
                ...(replace ? { documentId: replace.id } : {}),
                scope: trainingMaterials
                  ? "company"
                  : (replace?.data.scope ?? scope),
                ...(isTraining ? { purpose: "training" } : {}),
                ...(!replace && folderId ? { folderId } : {}),
                ...(!replace && tripId ? { tripId } : {}),
                uploadSource: tripId
                  ? "travel"
                  : trainingMaterials
                    ? "training"
                    : fixedChannelId
                      ? "conversation"
                      : "repository",
                ...((replace?.data.channelId ?? channelId)
                  ? { channelId: replace?.data.channelId ?? channelId }
                  : {}),
                fileName: file.name,
                byteSize: file.size,
                contentType: file.type || "application/octet-stream",
                checksumSha256,
              },
              operationId,
            ),
          ),
        });
        reservation = {
          file,
          uploadOwner,
          finalizeOperationId: createWorkHubOperationId(),
          resource: reserved.resource,
        };
        setReservedUpload(reservation);
      }
      const response = await withRequestDeadline(
        (signal) =>
          fetch(reservation.resource.uploadURL, {
            method: "PUT",
            headers: {
              "Content-Type": file.type || "application/octet-stream",
            },
            body: file,
            signal,
          }),
        {
          timeoutMs: 120_000,
          timeoutMessage:
            "File transfer was not confirmed in time. No new version has been confirmed; check the library before retrying this staged upload.",
        },
      );
      if (!response.ok)
        throw new Error(
          `File upload failed (${response.status}). No new version was published.`,
        );
      await workHubRequest("/file-library/finalize", {
        method: "POST",
        body: JSON.stringify(
          commandEnvelope(
            reservation.uploadOwner,
            {
              id: reservation.resource.documentId,
              fileId: reservation.resource.fileId,
            },
            reservation.finalizeOperationId,
          ),
        ),
      });
    },
    onSuccess: () => {
      setReplace(null);
      setPendingFile(null);
      setPendingOperationId(null);
      setReservationStarted(false);
      setReservedUpload(null);
      if (input.current) input.current.value = "";
      cache.invalidateQueries({ queryKey });
      cache.invalidateQueries({ queryKey: ["travel-documents"] });
      cache.invalidateQueries({ queryKey: ["vendor-repository"] });
      if (meetingSession?.occurrenceId)
        cache.invalidateQueries({
          queryKey: [
            "work-hub",
            "meeting-workspace",
            meetingSession.occurrenceId,
          ],
        });
    },
  });
  if (!owner) return <p>Select a company to open your files.</p>;
  const rows = (query.data ?? []).filter(
    (doc) =>
      (!trainingMaterials ||
        (doc.data.purpose === "training" && doc.data.scope === "company")) &&
      (!tripId || doc.data.tripId === tripId) &&
      (!folderView ||
        doc.data.folderId === folderView ||
        doc.data.categoryIds?.includes(folderView)) &&
      (!fixedChannelId || doc.data.channelId === fixedChannelId) &&
      (filter === "recycle"
        ? doc.data.state === "recycled"
        : doc.data.state === "active") &&
      (filter !== "favorites" || doc.favorite) &&
      (filter !== "personal" || doc.data.scope === "personal") &&
      (filter !== "shared" || doc.data.scope !== "personal") &&
      doc.data.name.toLowerCase().includes(search.toLowerCase()),
  );
  rows.sort((a, b) => {
    if (sort === "size") return (b.data.byteSize ?? 0) - (a.data.byteSize ?? 0);
    const value = (row: Document) =>
      sort === "name"
        ? row.data.name
        : sort === "creator"
          ? (repository.data?.creators?.find((p) => p.id === row.createdBy)
              ?.name ?? "")
          : sort === "type"
            ? row.data.contentType
            : sort === "source"
              ? row.data.uploadSource
              : sort === "folder"
                ? (repository.data?.folders?.find(
                    (f) => f.id === row.data.folderId,
                  )?.data.name ?? "")
                : sort === "created"
                  ? row.createdAt
                  : row.updatedAt;
    return (
      String(value(a) ?? "").localeCompare(String(value(b) ?? "")) *
      (sort === "updated" || sort === "created" ? -1 : 1)
    );
  });
  return (
    <div className="vendor-repository company-file-library space-y-4">
      <label>
        Sort by{" "}
        <BrandedSelect
          aria-label="Sort files"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="updated">Last updated</option>
          <option value="created">Created on</option>
          <option value="name">Name</option>
          <option value="creator">Created by</option>
          <option value="size">Size</option>
          <option value="type">File type</option>
          <option value="source">Attribution/source</option>
          <option value="folder">Folder</option>
        </BrandedSelect>
      </label>
      {details && (
        <RepositoryFileDetails
          document={details}
          onClose={() => setDetails(null)}
        />
      )}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_125px] items-center gap-2">
        <label className="order-last min-w-0">
          <BrandedSelect
            aria-label="File filter"
            style={{
              backgroundColor: "#242426",
              color: "#ececec",
              colorScheme: "dark",
            }}
            className="w-full text-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">
              {trainingMaterials ? "All" : "All files"}
            </option>
            {!fixedChannelId && !trainingMaterials && (
              <option value="personal">Personal</option>
            )}
            {!fixedChannelId && !trainingMaterials && (
              <option value="shared">Company & channel</option>
            )}
            <option value="favorites">Favorites</option>
            <option value="recycle">Recycle bin</option>
          </BrandedSelect>
        </label>
        <Input
          className="min-w-0 w-full"
          placeholder="Search files"
          aria-label="Search files"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <Card
        className={
          fixedChannelId ? "border-0 shadow-none !bg-transparent" : undefined
        }
      >
        {!fixedChannelId && (
          <CardHeader>
            <CardTitle>
              <WorkHubCardTitle icon={Upload}>
                {trainingMaterials
                  ? "Upload training material"
                  : "Upload a file"}
              </WorkHubCardTitle>
            </CardTitle>
          </CardHeader>
        )}
        <CardContent
          className={fixedChannelId ? "!p-0 space-y-2" : "space-y-3"}
        >
          {!fixedChannelId && !trainingMaterials && (
            <>
              <p>
                Files are visible to the chosen audience and authorized
                administrators. Replacement uploads preserve earlier versions.
                Word and Excel files can be downloaded; edit them in their own
                applications.
              </p>
              {(meetingSession?.occurrenceId || new URLSearchParams(window.location.search).has("channel")) && <label>Destination <BrandedSelect aria-label="File audience" value={scope} onChange={e=>setScope(e.target.value)} disabled={upload.isPending || reservationStarted}><option value="personal">Personal</option><option value="company">Company</option><option value="channel">Channel</option>{meetingSession?.occurrenceId && <option value="meeting">Active meeting</option>}</BrandedSelect></label>}
              <FolderPicker
                data={repository.data}
                value={folderId}
                onChange={setFolderId}
                disabled={upload.isPending || reservationStarted}
              />
              <OptionSwitch
                label="Designate as training materials"
                value={isTraining}
                onChange={setIsTraining}
                disabled={upload.isPending || reservationStarted}
              />
              {scope === "meeting" && meetingSession?.occurrenceId && (
                <p role="status">
                  <strong>
                    Sharing to:{" "}
                    {meetingSession.snapshot?.meeting.title ?? "active meeting"}
                  </strong>{" "}
                  · Change the audience above to choose somewhere else.
                </p>
              )}
              {scope === "channel" && (
                <label className="block">
                  Channel{" "}
                  <BrandedSelect
                    aria-label="File channel"
                    className="w-full text-sm"
                    style={{
                      backgroundColor: "#242426",
                      color: "#ececec",
                      colorScheme: "dark",
                    }}
                    value={channelId}
                    disabled={
                      !!fixedChannelId || upload.isPending || reservationStarted
                    }
                    onChange={(e) => setChannelId(e.target.value)}
                  >
                    <option value="">Choose channel</option>
                    {channels.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </BrandedSelect>
                </label>
              )}
            </>
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {!fixedChannelId && (
              <button
                type="button"
                className="library-action"
                disabled={upload.isPending || reservationStarted}
                onClick={() => input.current?.click()}
              >
                <Upload className="mr-2 h-4 w-4" />
                Choose file
              </button>
            )}
            {!fixedChannelId && (
              <span className="min-w-0 break-all text-sm">
                {pendingFile?.name ?? "No file selected"}
              </span>
            )}
            {fixedChannelId && (
              <BrandPillButton
                type="button"
                tone="brand"
                disabled={upload.isPending || reservationStarted}
                onClick={() => input.current?.click()}
              >
                <Upload className="mr-1 h-4 w-4" />
                Choose file
              </BrandPillButton>
            )}
            <input
              className="hidden"
              ref={input}
              type="file"
              aria-label="Choose file to upload"
              disabled={upload.isPending || reservationStarted}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setPendingFile(file);
                setPendingOperationId(file ? createWorkHubOperationId() : null);
                setReservationStarted(false);
                setReservedUpload(null);
              }}
            />
            {(!fixedChannelId || pendingFile) && (
              <BrandPillButton
                type="button"
                tone="brand"
                className={fixedChannelId ? "w-fit" : "library-action w-fit"}
                disabled={
                  !pendingFile ||
                  upload.isPending ||
                  (!replace && scope === "channel" && !channelId)
                }
                onClick={() => pendingFile && upload.mutate(pendingFile)}
              >
                Upload
              </BrandPillButton>
            )}
            {fixedChannelId && pendingFile && (
              <span
                className="min-w-0 truncate text-sm"
                title={pendingFile.name}
              >
                {pendingFile.name}
              </span>
            )}
          </div>
          {replace && (
            <p>
              Replacing {replace.data.name}.{" "}
              <Button
                variant="outline"
                disabled={upload.isPending || reservationStarted}
                onClick={() => {
                  setReplace(null);
                  setPendingFile(null);
                  setPendingOperationId(null);
                  setReservedUpload(null);
                  if (input.current) input.current.value = "";
                }}
              >
                Cancel replacement
              </Button>
            </p>
          )}
          {upload.isPending && (
            <p role="status">Uploading and verifying file…</p>
          )}
        </CardContent>
      </Card>
      {(query.error || upload.error || change.error) && (
        <p role="alert">
          {(query.error || upload.error || change.error)?.message}
        </p>
      )}
      {query.isLoading && <p>Loading files…</p>}
      {!query.isLoading && rows.length === 0 && (
        <p>No files match this view.</p>
      )}
      {share && (
        <p className="border rounded p-3">
          Public link expires {new Date(share.expiresAt).toLocaleString()}:{" "}
          <a
            className="underline break-all"
            href={`/api/work-hub/file-library/public/${share.token}`}
            target="_blank"
            rel="noreferrer"
          >{`${window.location.origin}/api/work-hub/file-library/public/${share.token}`}</a>
        </p>
      )}
      <div className="grid gap-3">
        {rows.map((doc) => (
          <Card key={doc.id}>
            <CardHeader>
              <CardTitle className="flex gap-2 items-center">
                <FileText className="h-5 w-5" />
                <button
                  type="button"
                  className="text-left break-words"
                  onClick={() => setDetails(doc)}
                >
                  {doc.data.name}
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p>
                {doc.data.scope} ·{" "}
                {doc.data.byteSize
                  ? `${Math.ceil(doc.data.byteSize / 1024)} KB`
                  : "Upload not completed"}{" "}
                · {doc.data.versions.length} version(s)
              </p>
              <p>
                Created by{" "}
                {repository.data?.creators?.find((p) => p.id === doc.createdBy)
                  ?.name ?? `User ${doc.createdBy}`}{" "}
                ·{" "}
                {doc.createdAt ? new Date(doc.createdAt).toLocaleString() : "—"}{" "}
                · Source: {doc.data.uploadSource ?? doc.data.scope}
                {doc.data.purpose === "training" ? " · Training materials" : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {doc.data.state === "active" ? (
                  <>
                    {doc.data.currentFileId && (
                      <>
                        <a
                          className="underline inline-flex items-center gap-1"
                          href={`/api/work-hub/file-library/${doc.id}/download`}
                        >
                          <Download className="h-4 w-4" />
                          Download
                        </a>
                        <a
                          className="underline"
                          href={`/api/work-hub/file-library/${doc.id}/download?preview=1`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Preview
                        </a>
                      </>
                    )}
                    <Button
                      variant="outline"
                      disabled={change.isPending}
                      onClick={() =>
                        change.mutate({
                          action: "favorite",
                          payload: { id: doc.id, active: !doc.favorite },
                        })
                      }
                    >
                      <Star
                        className="mr-1 h-4 w-4"
                        fill={doc.favorite ? "currentColor" : "none"}
                      />
                      {doc.favorite ? "Unfavorite" : "Favorite"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        setVersions(versions === doc.id ? null : doc.id)
                      }
                    >
                      <History className="mr-1 h-4 w-4" />
                      Versions
                    </Button>
                    {!trainingMaterials &&
                      doc.canManage &&
                      doc.data.scope !== "meeting" &&
                      doc.data.currentFileId && (
                        <ShareFileToChannel
                          key={doc.id}
                          source={doc}
                          channels={channels.data ?? []}
                          onShare={(channelId) =>
                            change.mutateAsync({
                              action: "share-to-channel",
                              payload: { id: doc.id, channelId },
                            })
                          }
                        />
                      )}
                    {doc.canManage && (
                      <>
                        <Button
                          variant="outline"
                          disabled={upload.isPending || reservationStarted}
                          onClick={() => {
                            setReplace(doc);
                            setPendingFile(null);
                            setPendingOperationId(null);
                            setReservationStarted(false);
                            setReservedUpload(null);
                            if (input.current) input.current.value = "";
                            input.current?.click();
                          }}
                        >
                          Replace file
                        </Button>
                        <Button
                          variant="outline"
                          disabled={change.isPending || !doc.data.currentFileId}
                          onClick={() =>
                            change.mutate({
                              action: "share",
                              payload: { id: doc.id, expiresInDays: 7 },
                            })
                          }
                        >
                          <Share2 className="mr-1 h-4 w-4" />
                          Share for 7 days
                        </Button>
                        <Button
                          variant="outline"
                          disabled={change.isPending}
                          onClick={() => {
                            setShare(null);
                            change.mutate({
                              action: "revoke-share",
                              payload: { id: doc.id },
                            });
                          }}
                        >
                          Revoke public links
                        </Button>
                        <Button
                          variant="outline"
                          disabled={change.isPending}
                          onClick={() =>
                            change.mutate({
                              action: "recycle",
                              payload: { id: doc.id },
                            })
                          }
                        >
                          <Trash2 className="mr-1 h-4 w-4" />
                          Recycle
                        </Button>
                      </>
                    )}
                  </>
                ) : (
                  doc.canManage && (
                    <Button
                      variant="outline"
                      disabled={change.isPending}
                      onClick={() =>
                        change.mutate({
                          action: "restore",
                          payload: { id: doc.id },
                        })
                      }
                    >
                      <RotateCcw className="mr-1 h-4 w-4" />
                      Restore file
                    </Button>
                  )
                )}
              </div>
              {versions === doc.id && doc.data.state === "active" && (
                <ol>
                  {doc.data.versions.map((id, i) => (
                    <li key={id}>
                      <a
                        className="underline"
                        href={`/api/work-hub/file-library/${doc.id}/download?version=${id}`}
                      >
                        Download version {i + 1}
                        {id === doc.data.currentFileId ? " (current)" : ""}
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
