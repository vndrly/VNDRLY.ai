import React, { Suspense } from "react";
import { AskVFloatingLauncherMark, ASKV_LAUNCHER_HEIGHT, ASKV_LAUNCHER_WIDTH } from "@/components/askv-logo";
import AskVStatusIndicator from "@/components/askv-status-indicator";

const AssistantLauncher = React.lazy(() =>
  import("@/components/assistant-panel").then((mod) => ({
    default: mod.AssistantLauncher,
  })),
);

export default function AskVPaneControls({ closePanel }: { closePanel?: () => void } = {}) {
  return (
    <div className="relative flex shrink-0 items-center gap-0 overflow-visible" data-testid="askv-pane-controls">
      <div className="relative top-[3px] flex items-center">
        {closePanel ? (
          <button type="button" aria-label="Close Ask V pane" aria-expanded="true" onClick={closePanel}
            className="inline-flex items-center justify-center overflow-visible"
            style={{ width: ASKV_LAUNCHER_WIDTH, height: ASKV_LAUNCHER_HEIGHT }}>
            <AskVFloatingLauncherMark engaged={false} panelOpen />
          </button>
        ) : (
          <Suspense fallback={null}>
            <AssistantLauncher placement="askv-pane" />
          </Suspense>
        )}
      </div>
      <div className="-ml-[10.8px]">
        <AskVStatusIndicator placement="top-strip" />
      </div>
    </div>
  );
}
