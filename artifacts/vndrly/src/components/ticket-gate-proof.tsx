import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";
import type { TicketGateProof as Proof } from "@workspace/gate-booth";
export default function TicketGateProof({ ticketId }: { ticketId: number }) {
  const { user } = useAuth(),
    { t } = useTranslation();
  const q = useQuery({
    queryKey: [
      "ticket-gate-proof",
      user?.userId,
      user?.activeMembershipId,
      ticketId,
    ],
    queryFn: async () => {
      const r = await fetch("/api/tickets/" + ticketId + "/gate-proof", {
        credentials: "include",
      });
      if (!r.ok) throw Error(t("gateProof.unavailable"));
      return r.json() as Promise<Proof>;
    },
    retry: false,
  });
  return (
    <section
      className="space-y-3 rounded-xl border p-4"
      aria-label={t("gateProof.title")}
    >
      <h2 className="font-semibold">{t("gateProof.title")}</h2>
      {q.isLoading ? (
        <p>{t("common.loading")}</p>
      ) : q.isError ? (
        <p role="alert">{t("gateProof.unavailable")}</p>
      ) : !q.data?.visits.length ? (
        <p>{t("gateProof.missing")}</p>
      ) : (
        q.data.visits.map((v) => (
          <div key={v.id} className="space-y-2">
            <p>
              {v.siteName} / {v.gateName ?? t("gateProof.notRecorded")}
            </p>
            <p>
              {t("gateProof.entry")}:{" "}
              {v.admissionStatus === "pending"
                ? t("gateProof.notRecorded")
                : new Date(v.checkInTime).toLocaleString()}{" "}
              · {t("gateProof.exit")}:{" "}
              {v.checkOutTime
                ? new Date(v.checkOutTime).toLocaleString()
                : t("gateProof.notRecorded")}
            </p>
            {!v.capture?.images.some(image=>image.phase==="entry")&&<p>{t("gateProof.missingEntryPhoto")}</p>}
            {!v.capture?.images.some(image=>image.phase==="exit")&&<p>{t("gateProof.missingExitPhoto")}</p>}
            <div className="flex flex-wrap gap-2">
              {v.capture?.images.map((image) => (
                <a
                  key={image.objectPath}
                  href={"/api/storage"+image.originalPath}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={"/api/storage"+image.objectPath}
                    alt={t("gateProof.photo")}
                    className="h-32 w-40 object-contain"
                  />
                  <span>
                    {t(
                      image.phase === "exit"
                        ? "gateProof.exit"
                        : image.phase === "entry" ? "gateProof.entry" : "gateProof.unclassified",
                    )}{" "}
                    · {t("gateProof.original")}
                  </span>
                </a>
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
