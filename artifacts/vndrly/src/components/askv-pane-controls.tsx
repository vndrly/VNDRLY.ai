import React, { Suspense } from "react";
import AskVStatusIndicator from "@/components/askv-status-indicator";

const AssistantLauncher = React.lazy(() =>
  import("@/components/assistant-panel").then((mod) => ({
    default: mod.AssistantLauncher,
  })),
);

export default function AskVPaneControls() {
  return (
    <div className="relative flex shrink-0 items-center gap-0 overflow-visible" data-testid="askv-pane-controls">
      <div className="relative top-[3px] flex items-center">
        <Suspense fallback={null}>
          <AssistantLauncher placement="askv-pane" />
        </Suspense>
      </div>
      <div className="-ml-[10.8px]">
        <AskVStatusIndicator placement="top-strip" />
      </div>
    </div>
  );
}
