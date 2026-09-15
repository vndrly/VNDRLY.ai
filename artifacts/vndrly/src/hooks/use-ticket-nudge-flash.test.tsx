import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKFLOW_NUDGE_TYPE } from "@workspace/ticket-nudge-ui";
import {
  NOTIFICATION_CREATED_BROWSER_EVENT,
} from "@/lib/notifications-api";
import { useTicketNudgeFlash } from "./use-ticket-nudge-flash";

const mocks = vi.hoisted(() => ({
  list: vi.fn(async () => []),
}));

vi.mock("@/lib/notifications-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/notifications-api")>();
  return {
    ...actual,
    notificationsApi: {
      ...actual.notificationsApi,
      list: mocks.list,
    },
  };
});

describe("useTicketNudgeFlash", () => {
  beforeEach(() => {
    mocks.list.mockClear();
  });

  it("uses the shared browser event without opening another live stream", async () => {
    const eventSource = vi.fn();
    vi.stubGlobal("EventSource", eventSource);
    const { result, unmount } = renderHook(() =>
      useTicketNudgeFlash({ ticketId: 42 }),
    );
    await waitFor(() => expect(mocks.list).toHaveBeenCalledOnce());

    act(() => {
      window.dispatchEvent(
        new CustomEvent(NOTIFICATION_CREATED_BROWSER_EVENT, {
          detail: {
            type: "notification.created",
            notifType: WORKFLOW_NUDGE_TYPE,
            link: "/tickets/42",
          },
        }),
      );
    });

    expect(result.current.nudgeFlashingTicketIds.has(42)).toBe(true);
    expect(eventSource).not.toHaveBeenCalled();
    unmount();
    vi.unstubAllGlobals();
  });
});
