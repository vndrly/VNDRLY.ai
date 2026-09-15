import { useCallback, useEffect, useRef, useState } from "react";
import { evaluateFieldMode, type FieldModeEffect, type FieldModeEvent, type FieldModeSnapshot } from "@/lib/field-mode-policy";

export type FieldModeActions = {
  startTracking: () => Promise<void>;
  stopTracking: (input: { reason: "end_of_work" | "unattended_timeout"; needsSupervisorConfirmation: boolean }) => Promise<void>;
  announceReady: () => Promise<void>;
  recordArrival: () => Promise<void>;
  recordDeparture: () => Promise<void>;
  promptEndWork: () => Promise<void>;
  promptExtendedStop: () => Promise<void>;
  createSupervisorException: (reason: "end_work_unanswered" | "extended_stop_unanswered") => Promise<void>;
};

export type FieldModeEventSource = {
  subscribe: (listener: (event: FieldModeEvent) => void) => () => void;
};

async function executeEffect(effect: FieldModeEffect, actions: FieldModeActions) {
  switch (effect.type) {
    case "start_tracking": return actions.startTracking();
    case "stop_tracking": return actions.stopTracking({ reason: effect.reason, needsSupervisorConfirmation: effect.needsSupervisorConfirmation });
    case "announce_ready": return actions.announceReady();
    case "record_arrival": return actions.recordArrival();
    case "record_departure": return actions.recordDeparture();
    case "prompt_end_work": return actions.promptEndWork();
    case "prompt_extended_stop": return actions.promptExtendedStop();
    case "supervisor_exception": return actions.createSupervisorException(effect.reason);
  }
}

export function useFieldMode(input: { initialSnapshot: FieldModeSnapshot; source: FieldModeEventSource; actions: FieldModeActions }) {
  const [snapshot, setSnapshot] = useState(input.initialSnapshot);
  const actionsRef = useRef(input.actions);
  const queueRef = useRef(Promise.resolve());
  actionsRef.current = input.actions;

  const dispatch = useCallback((event: FieldModeEvent) => {
    setSnapshot((current) => {
      const result = evaluateFieldMode(current, event);
      if (result.effects.length > 0) {
        queueRef.current = queueRef.current.then(async () => {
          for (const effect of result.effects) await executeEffect(effect, actionsRef.current);
        });
      }
      return result.snapshot;
    });
  }, []);

  useEffect(() => input.source.subscribe(dispatch), [input.source, dispatch]);

  return { snapshot, dispatch };
}
