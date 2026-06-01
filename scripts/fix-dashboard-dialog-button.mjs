import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const p = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../artifacts/vndrly/src/pages/dashboard.tsx",
);
let c = fs.readFileSync(p, "utf8");

const old = `              <button
                type="button"
                className={dashPillBtnClass}
                style={{ height: 22 }}
                onClick={() => {
                  if (passDialogId === null) return;
                  const reason = passReason.trim();
                  passDirect.mutate(
                    {
                      id: passDialogId,
                      data: { reason: reason === "" ? null : reason },
                    },
                    {
                      onSuccess: () => {
                        toast({ title: t("directAssignment.passedToast") });
                        setPassDialogId(null);
                        setPassReason("");
                        void refetchPendingDirect();
                      },
                      onError: () => {
                        toast({
                          title: t("directAssignment.passFailedToast"),
                          variant: "destructive",
                        });
                      },
                    },
                  );
                }}
                disabled={passDirect.isPending}
                data-testid="button-pass-dialog-confirm"
              >
                <PillBg src={idlePill} imageAspect={DASH_PILL_ASPECT} className="transition-opacity duration-200 opacity-100 group-hover:opacity-0" />
                <PillBg src={redPill} imageAspect={DASH_PILL_ASPECT} className="transition-opacity duration-200 opacity-0 group-hover:opacity-100" />
                <span className={dashPillLabelClass}>
                  {passDirect.isPending
                    ? t("directAssignment.passing")
                    : t("directAssignment.confirmPass")}
                </span>
              </button>`;

const neu = `              <BakerPillButton
                testId="button-pass-dialog-confirm"
                fullWidth={false}
                height={22}
                idleSrc={PILL_IDLE_SRC}
                activeSrc={hoverPillForTone("red")}
                activeFadesIn
                onClick={() => {
                  if (passDialogId === null) return;
                  const reason = passReason.trim();
                  passDirect.mutate(
                    {
                      id: passDialogId,
                      data: { reason: reason === "" ? null : reason },
                    },
                    {
                      onSuccess: () => {
                        toast({ title: t("directAssignment.passedToast") });
                        setPassDialogId(null);
                        setPassReason("");
                        void refetchPendingDirect();
                      },
                      onError: () => {
                        toast({
                          title: t("directAssignment.passFailedToast"),
                          variant: "destructive",
                        });
                      },
                    },
                  );
                }}
                disabled={passDirect.isPending}
              >
                {passDirect.isPending
                  ? t("directAssignment.passing")
                  : t("directAssignment.confirmPass")}
              </BakerPillButton>`;

if (!c.includes(old)) {
  console.error("dialog button block not found");
  process.exit(1);
}
c = c.replace(old, neu);
fs.writeFileSync(p, c);
console.log("dashboard dialog button fixed");
