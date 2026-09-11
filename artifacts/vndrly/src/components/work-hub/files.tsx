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
import { WorkHubCardTitle } from "./chrome";
type Document = {
  id: string;
  createdBy: number;
  orgType: "vendor" | "partner";
  orgId: number;
  data: {
    name: string;
    scope: string;
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
export function WorkHubFiles() {
  const { user } = useAuth();
  const owner = ownerForUser(user);
  const cache = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState(() => new URLSearchParams(window.location.search).get("channel") ? "channel" : "personal");
  const [channelId, setChannelId] = useState(() => new URLSearchParams(window.location.search).get("channel") ?? "");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState<Document | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingOperationId, setPendingOperationId] = useState<string | null>(null);
  const [reservationStarted, setReservationStarted] = useState(false);
  const [reservedUpload, setReservedUpload] = useState<UploadReservation | null>(null);
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
  const queryKey = ["work-hub-file-library", user?.userId, user?.activeMembershipId, owner?.type, owner?.id];
  const query = useQuery({
    queryKey,
    enabled: !!owner,
    queryFn: () =>
      workHubRequest<Document[]>(
        `/file-library?orgType=${owner!.type}&orgId=${owner!.id}`,
      ),
  });
  const channels = useQuery({
    queryKey: ["work-hub-channels", user?.userId, user?.activeMembershipId],
    enabled: !!owner,
    queryFn: () =>
      workHubRequest<
        { id: string; name: string; ownerOrgType: string; ownerOrgId: number }[]
      >("/channels"),
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
            commandEnvelope(uploadOwner, {
              ...(replace ? { documentId: replace.id } : {}),
              scope: replace?.data.scope ?? scope,
              ...((replace?.data.channelId ?? channelId)
                ? { channelId: replace?.data.channelId ?? channelId }
                : {}),
              fileName: file.name,
              byteSize: file.size,
              contentType: file.type || "application/octet-stream",
              checksumSha256,
            }, operationId),
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
      const response = await fetch(reservation.resource.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
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
    },
  });
  if (!owner) return <p>Select a company to open your files.</p>;
  const rows = (query.data ?? []).filter(
    (doc) =>
      (filter === "recycle"
        ? doc.data.state === "recycled"
        : doc.data.state === "active") &&
      (filter !== "favorites" || doc.favorite) &&
      (filter !== "personal" || doc.data.scope === "personal") &&
      (filter !== "shared" || doc.data.scope !== "personal") &&
      doc.data.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label>
          Show{" "}
          <select
            className="bg-background border rounded p-2"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All files</option>
            <option value="personal">Personal</option>
            <option value="shared">Company & channel</option>
            <option value="favorites">Favorites</option>
            <option value="recycle">Recycle bin</option>
          </select>
        </label>
        <Input
          className="max-w-sm"
          placeholder="Search files"
          aria-label="Search files"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle><WorkHubCardTitle icon={Upload}>Upload a file</WorkHubCardTitle></CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Files stay private to the chosen audience. Replacement uploads
            preserve earlier versions. Word and Excel files can be downloaded;
            edit them in their own applications.
          </p>
          <label>
            Audience{" "}
            <select
              aria-label="File audience"
              className="bg-background border rounded p-2"
              value={scope}
              disabled={upload.isPending || reservationStarted}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="personal">Only me</option>
              <option value="company">Company members</option>
              <option value="channel">Channel members</option>
            </select>
          </label>
          {scope === "channel" && (
            <label className="block">
              Channel{" "}
              <select
                aria-label="File channel"
                className="bg-background border rounded p-2"
                value={channelId}
                disabled={upload.isPending || reservationStarted}
                onChange={(e) => setChannelId(e.target.value)}
              >
                <option value="">Choose channel</option>
                {channels.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <input
            ref={input}
            type="file"
            aria-label="Choose file to upload"
            disabled={
              upload.isPending || reservationStarted
            }
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setPendingFile(file);
              setPendingOperationId(file ? createWorkHubOperationId() : null);
              setReservationStarted(false);
              setReservedUpload(null);
            }}
          />
          <BrandPillButton
            type="button"
            tone="brand"
            className="w-fit"
            disabled={
              !pendingFile ||
              upload.isPending ||
              (!replace && scope === "channel" && !channelId)
            }
            onClick={() => pendingFile && upload.mutate(pendingFile)}
          >
            Upload File
          </BrandPillButton>
          {replace && (
            <p>
              Replacing {replace.data.name}.{" "}
              <Button variant="outline" disabled={upload.isPending || reservationStarted} onClick={() => { setReplace(null); setPendingFile(null); setPendingOperationId(null); setReservedUpload(null); if (input.current) input.current.value = ""; }}>
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
                {doc.data.name}
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
