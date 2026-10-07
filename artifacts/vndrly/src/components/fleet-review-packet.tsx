import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { FleetRun } from "@workspace/api-zod";
import { fleetClient } from "@/lib/fleet-client";
import { fleetCopy } from "@/lib/fleet-copy";
export function FleetReviewPacketPanel({
  run,
  identity,
}: {
  run: FleetRun;
  identity: string;
}) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  const query = useQuery({
    queryKey: ["fleet", identity, "review-packet", run.id, run.version],
    queryFn: () => fleetClient.reviewPacket(run.id),
    retry: false,
  });
  const packet =
    !query.isError &&
    query.data?.runId === run.id &&
    query.data.runVersion === run.version
      ? query.data
      : undefined;
  const kinds = {
    photo: c.packetPhoto,
    scale: c.packetScale,
    receipt: c.packetReceipt,
    signature: c.packetSignature,
  };
  return (
    <section className="space-y-2 rounded border p-3">
      <h3>{c.packetTitle}</h3>
      <p className="text-sm">{c.packetSource}</p>
      {!packet ? (
        <p role="status">{c.packetUnavailable}</p>
      ) : (
        <>
          <p>
            {c.packetMissing}: {packet.missingRequiredCount}
          </p>
          <p>
            {packet.readyForOperationalReview
              ? c.packetReady
              : c.packetIncomplete}
          </p>
          <p>
            {c.packetInspectionComplete}:{" "}
            {packet.inspectionComplete
              ? c.packetComplete
              : c.packetIncompleteState}{" "}
            · {c.packetManifestComplete}:{" "}
            {packet.manifestComplete
              ? c.packetComplete
              : c.packetIncompleteState}{" "}
            · {c.packetCloseoutComplete}:{" "}
            {packet.closeoutRecordsComplete
              ? c.packetComplete
              : c.packetIncompleteState}
          </p>
          <p>
            {c.packetInspections}: {packet.inspectionExceptions} ·{" "}
            {c.packetLoads}: {packet.undeliveredLoadCount}
          </p>
          <ul>
            {packet.requirements.map((item) => (
              <li
                key={item.id + ":" + (item.loadId ?? "run")}
                className="rounded border p-2"
              >
                {item.label} · {kinds[item.kind]} ·{" "}
                {item.loadId
                  ? c.attachmentLoad + " " + item.loadId
                  : c.attachmentRun}{" "}
                · {item.required ? c.required : c.optional}
                <p>
                  {item.missing ? c.packetMissingFile : c.packetRecorded}:{" "}
                  {item.evidenceIds.length}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
