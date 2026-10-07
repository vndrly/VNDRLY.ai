import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  WorkHubAwayChannelsSchema,
  WorkHubAwayCommandSchema,
  WorkHubAwayReadSchema,
  WorkHubAwayReadbackSchema,
  type WorkHubAwayCommand,
  type WorkHubAwayRead,
} from "@workspace/api-zod";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PngPillButton } from "@/components/png-pill-rollover";
import { createWorkHubOperationId } from "@/lib/work-hub-client";
import {
  awayRequest,
  AwayRequestError,
  clearAwayAttempt,
  loadAwayAttempt,
  matchAwayReceipt,
  storeAwayAttempt,
  type AwayAttempt,
} from "@/lib/work-hub-away-client";
type Props = {
  identity: string;
  actorId: number;
  owner: { type: "vendor" | "partner"; id: number };
  request?: typeof awayRequest;
  storage?: Storage;
};
const localTime = (value: Date) =>
  new Date(value.getTime() - value.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
export function WorkHubAwaySettings({
  identity,
  actorId,
  owner,
  request = awayRequest,
  storage = window.sessionStorage,
}: Props) {
  const scope = `${identity}:${actorId}:${owner.type}:${owner.id}`;
  const { i18n } = useTranslation();
  const es = i18n.language.startsWith("es");
  const copy = (en: string, spanish: string) => (es ? spanish : en);
  const [snapshot, setSnapshot] = useState<WorkHubAwayRead | null>(null),
    [channels, setChannels] = useState<{ id: string; name: string }[]>([]),
    [truncated, setTruncated] = useState(false);
  const [starts, setStarts] = useState(""),
    [ends, setEnds] = useState(""),
    [text, setText] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [approved, setApproved] = useState(false);
  const [pending, setPending] = useState<AwayAttempt | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const generation = useRef(0),
    currentIdentity = useRef(scope),
    alive = useRef(false),
    controllers = useRef(new Set<AbortController>());
  currentIdentity.current = scope;
  const active = (epoch: number, bound: string) =>
    alive.current &&
    generation.current === epoch &&
    currentIdentity.current === bound;
  async function refresh(
    epoch: number,
    bound: string,
    intent: AwayAttempt | null,
  ) {
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const [raw, choices] = await Promise.all([
        request("/away-responder", { signal: controller.signal }),
        request("/away-responder/channels", { signal: controller.signal }),
      ]);
      const read = WorkHubAwayReadSchema.parse(raw),
        available = WorkHubAwayChannelsSchema.parse(choices);
      if (!active(epoch, bound)) return;
      setSnapshot(read);
      setChannels(available.channels);
      setTruncated(available.truncated);
      const command = intent?.command;
      if (command?.action === "configure") {
        setStarts(localTime(new Date(command.startsAt)));
        setEnds(localTime(new Date(command.endsAt)));
        setText(command.replyText);
        setSelected(command.channelIds);
      } else {
        setStarts(localTime(new Date(read.rule?.startsAt ?? Date.now())));
        setEnds(
          localTime(new Date(read.rule?.endsAt ?? Date.now() + 86400000)),
        );
        setText(
          read.rule?.replyText ??
            copy(
              "I am away. I will review your message when I return.",
              "Estoy ausente. Revisaré tu mensaje cuando regrese.",
            ),
        );
        setSelected(read.rule?.channelIds ?? []);
      }
      setApproved(false);
    } catch {
      if (active(epoch, bound)) {
        setSnapshot(null);
        setChannels([]);
        setMessage(
          copy(
            "The current setting could not be read. Refresh before saving.",
            "No se pudo leer la configuración actual. Actualiza antes de guardar.",
          ),
        );
      }
    } finally {
      controllers.current.delete(controller);
    }
  }
  useEffect(() => {
    alive.current = true;
    const epoch = ++generation.current;
    const retained = loadAwayAttempt(storage, scope);
    setPending(retained);
    setSnapshot(null);
    setChannels([]);
    setMessage(
      retained
        ? copy(
            "This request is unverified. Check the saved request before retrying.",
            "Esta solicitud no está verificada. Comprueba la solicitud guardada antes de reintentar.",
          )
        : "",
    );
    setBusy(false);
    void refresh(epoch, scope, retained);
    return () => {
      alive.current = false;
      generation.current++;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
    };
  }, [scope]);
  async function submit(command: WorkHubAwayCommand, retry = false) {
    if (busy) return;
    const epoch = generation.current,
      bound = scope;
    const intent = pending ?? {
      identity: bound,
      actorId,
      owner: { ...owner },
      command: WorkHubAwayCommandSchema.parse(command),
    };
    if (intent.identity !== bound) return;
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      storeAwayAttempt(storage, intent);
    } catch {
      setMessage(
        copy(
          "This browser could not retain the exact request. No change was sent.",
          "Este navegador no pudo conservar la solicitud exacta. No se envió ningún cambio.",
        ),
      );
      controllers.current.delete(controller);
      return;
    }
    setPending(intent);
    setBusy(true);
    setMessage("");
    let posted = false;
    try {
      let receipt: unknown = null;
      if (retry) {
        const readback = WorkHubAwayReadbackSchema.parse(
          await request(
            `/away-responder/operations/${intent.command.operationId}`,
            { signal: controller.signal },
          ),
        );
        receipt = readback.receipt;
      }
      if (!active(epoch, bound)) return;
      if (receipt === null) {
        posted = true;
        receipt = await request("/away-responder", {
          method: "POST",
          body: JSON.stringify(intent.command),
          signal: controller.signal,
        });
      }
      matchAwayReceipt(receipt, intent);
      if (!active(epoch, bound)) return;
      clearAwayAttempt(storage, bound);
      setPending(null);
      setMessage(
        copy(
          "The exact request was saved. Replies depend on current conversation access; delivery is not verified.",
          "Se guardó la solicitud exacta. Las respuestas dependen del acceso actual a la conversación; la entrega no está verificada.",
        ),
      );
      await refresh(epoch, bound, null);
    } catch (error) {
      if (!active(epoch, bound)) return;
      if (
        error instanceof AwayRequestError &&
        posted &&
        [400, 409].includes(error.status)
      ) {
        clearAwayAttempt(storage, bound);
        setPending(null);
        await refresh(epoch, bound, null);
        if (active(epoch, bound))
          setMessage(
            copy(
              "The request was refused or the setting changed. Review the current setting before creating a new request.",
              "La solicitud fue rechazada o la configuración cambió. Revisa la configuración actual antes de crear otra solicitud.",
            ),
          );
      } else
        setMessage(
          copy(
            "The result is unverified. Keep this exact request and check it before retrying.",
            "El resultado no está verificado. Conserva esta solicitud exacta y compruébala antes de reintentar.",
          ),
        );
    } finally {
      controllers.current.delete(controller);
      if (active(epoch, bound)) setBusy(false);
    }
  }
  const locked = busy || pending !== null || snapshot === null;
  function configure() {
    try {
      const command = WorkHubAwayCommandSchema.parse({
        operationId: createWorkHubOperationId(),
        action: "configure",
        expectedVersion: snapshot!.version,
        startsAt: new Date(starts).toISOString(),
        endsAt: new Date(ends).toISOString(),
        replyText: text,
        channelIds: selected,
      });
      if (
        command.action !== "configure" ||
        Date.parse(command.endsAt) <= Date.now() ||
        Date.parse(command.endsAt) <= Date.parse(command.startsAt) ||
        Date.parse(command.endsAt) - Date.parse(command.startsAt) >
          31 * 86400000
      )
        throw Error("window");
      void submit(command);
    } catch {
      setMessage(
        copy(
          "Choose a future end, a window of up to 31 days, a reply, and at least one conversation.",
          "Elige un final futuro, un período de hasta 31 días, una respuesta y al menos una conversación.",
        ),
      );
    }
  }
  return (
    <Card id="away-replies">
      <CardHeader>
        <CardTitle>
          {copy("Away replies", "Respuestas durante tu ausencia")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {copy(
            "Save one neutral reply per selected conversation and time window. VNDRLY checks current access before replying. No email, SMS, or delivery confirmation is included.",
            "Guarda una respuesta neutral por conversación seleccionada y período. VNDRLY comprueba el acceso actual antes de responder. No incluye correo, SMS ni confirmación de entrega.",
          )}
        </p>
        {snapshot?.rule && (
          <p>
            {copy("Saved setting:", "Configuración guardada:")}{" "}
            {snapshot.rule.status === "active"
              ? copy("Configured", "Configurada")
              : snapshot.rule.status === "paused"
                ? copy("Paused", "Pausada")
                : copy("Revoked", "Revocada")}
          </p>
        )}
        {snapshot?.rule === null && snapshot.version > 0 && (
          <p>
            {copy(
              "Saving will replace your previous away setting.",
              "Al guardar, se reemplazará tu configuración de ausencia anterior.",
            )}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {copy(
            "Times use this device's local timezone.",
            "Las horas utilizan la zona horaria local de este dispositivo.",
          )}
        </p>
        <label className="block">
          {copy("Starts", "Inicio")}
          <input
            aria-label={copy("Starts", "Inicio")}
            type="datetime-local"
            value={starts}
            disabled={locked}
            onChange={(e) => {
              setStarts(e.target.value);
              setApproved(false);
            }}
            className="block rounded border p-2"
          />
        </label>
        <label className="block">
          {copy("Ends", "Fin")}
          <input
            aria-label={copy("Ends", "Fin")}
            type="datetime-local"
            value={ends}
            disabled={locked}
            onChange={(e) => {
              setEnds(e.target.value);
              setApproved(false);
            }}
            className="block rounded border p-2"
          />
        </label>
        <label className="block">
          {copy("Exact reply", "Respuesta exacta")}
          <textarea
            aria-label={copy("Exact reply", "Respuesta exacta")}
            maxLength={500}
            value={text}
            disabled={locked}
            onChange={(e) => {
              setText(e.target.value);
              setApproved(false);
            }}
            className="block w-full rounded border p-2"
          />
        </label>
        <fieldset disabled={locked}>
          <legend>
            {copy(
              "Joined conversations you can write to",
              "Conversaciones a las que te uniste y puedes escribir",
            )}
          </legend>
          {channels.map((channel) => (
            <label className="block" key={channel.id}>
              <input
                type="checkbox"
                checked={selected.includes(channel.id)}
                onChange={(e) => {
                  setSelected((values) =>
                    e.target.checked
                      ? [...values, channel.id]
                      : values.filter((id) => id !== channel.id),
                  );
                  setApproved(false);
                }}
              />{" "}
              {channel.name}
            </label>
          ))}
        </fieldset>
        {channels.length === 0 && snapshot !== null && (
          <p>
            {copy(
              "No joined writable conversations are available in this account.",
              "No hay conversaciones disponibles a las que te hayas unido y puedas escribir en esta cuenta.",
            )}
          </p>
        )}
        {truncated && (
          <p>
            {copy(
              "Only the first 100 available conversations are shown.",
              "Solo se muestran las primeras 100 conversaciones disponibles.",
            )}
          </p>
        )}
        <label className="block">
          <input
            type="checkbox"
            checked={approved}
            disabled={locked}
            onChange={(e) => setApproved(e.target.checked)}
          />{" "}
          {copy(
            "Use this exact reply in the selected conversations during this window.",
            "Utilizar esta respuesta exacta en las conversaciones seleccionadas durante este período.",
          )}
        </label>
        <div className="flex flex-wrap gap-2">
          <PngPillButton
            color="blue"
            disabled={
              locked ||
              !approved ||
              selected.length === 0 ||
              selected.length > 20
            }
            onClick={configure}
          >
            {copy("Save away reply", "Guardar respuesta de ausencia")}
          </PngPillButton>
          {snapshot?.rule &&
            ["pause", "revoke"].map((action) => (
              <PngPillButton
                key={action}
                color={action === "pause" ? "amber" : "red"}
                disabled={
                  locked ||
                  snapshot.rule?.status ===
                    action
                      .replace("pause", "paused")
                      .replace("revoke", "revoked")
                }
                onClick={() =>
                  void submit({
                    operationId: createWorkHubOperationId(),
                    action: action as "pause" | "revoke",
                    expectedVersion: snapshot.version,
                    ruleId: snapshot.rule!.id,
                  })
                }
              >
                {action === "pause"
                  ? copy("Pause", "Pausar")
                  : copy("Revoke", "Revocar")}
              </PngPillButton>
            ))}
          {pending && (
            <PngPillButton
              color="amber"
              disabled={busy}
              onClick={() => void submit(pending.command, true)}
            >
              {copy(
                "Check / retry exact request",
                "Comprobar / reintentar solicitud exacta",
              )}
            </PngPillButton>
          )}
          <PngPillButton
            color="blue"
            disabled={busy}
            onClick={() => void refresh(generation.current, scope, pending)}
          >
            {copy("Refresh saved setting", "Actualizar configuración guardada")}
          </PngPillButton>
        </div>
        {message && <p role="status">{message}</p>}
      </CardContent>
    </Card>
  );
}
