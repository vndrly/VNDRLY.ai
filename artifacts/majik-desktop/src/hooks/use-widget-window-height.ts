import { useEffect, useState } from "react";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { majikWidgetHeightPx } from "@workspace/majik";

export function useWidgetWindowHeight(memberCount: number): void {
  const [height, setHeight] = useState(() => majikWidgetHeightPx(memberCount));

  useEffect(() => {
    const next = majikWidgetHeightPx(memberCount);
    setHeight(next);
    void getCurrentWindow()
      .setSize(new LogicalSize(280, next))
      .catch(() => undefined);
  }, [memberCount]);

  useEffect(() => {
    void getCurrentWindow()
      .setSize(new LogicalSize(280, height))
      .catch(() => undefined);
  }, [height]);
}
