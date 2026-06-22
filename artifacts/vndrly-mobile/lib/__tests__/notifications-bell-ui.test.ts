import { describe, expect, it } from "vitest";

import {
  formatNotificationCount,
  NOTIFICATION_BELL_BADGE,
  NOTIFICATION_BELL_ICON_SIZE,
  NOTIFICATION_COUNT_BADGE_BG,
  NOTIFICATION_TILE_BADGE,
} from "../notifications-bell-ui";

describe("notifications-bell-ui", () => {
  it("matches web notifications-bell.tsx tokens", () => {
    expect(NOTIFICATION_BELL_ICON_SIZE).toBe(20);
    expect(NOTIFICATION_COUNT_BADGE_BG).toBe("#dc2626");
    expect(NOTIFICATION_BELL_BADGE.height).toBe(20);
    expect(NOTIFICATION_BELL_BADGE.minWidth).toBe(24);
    expect(NOTIFICATION_BELL_BADGE.paddingHorizontal).toBe(6);
    expect(NOTIFICATION_BELL_BADGE.fontSize).toBe(10);
  });

  it("matches web foreman-quick-actions.tsx tile badge tokens", () => {
    expect(NOTIFICATION_TILE_BADGE.height).toBe(18);
    expect(NOTIFICATION_TILE_BADGE.minWidth).toBe(18);
    expect(NOTIFICATION_TILE_BADGE.paddingHorizontal).toBe(4);
  });

  it("matches web count formatting", () => {
    expect(formatNotificationCount(44)).toBe("44");
    expect(formatNotificationCount(100)).toBe("99+");
  });
});
