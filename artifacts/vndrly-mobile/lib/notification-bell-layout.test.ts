import { describe, expect, it } from "vitest";

import {
  NOTIFICATION_BADGE_MIN_WIDTH,
  NOTIFICATION_BELL_MARGIN_RIGHT,
  NOTIFICATION_BELL_ORIGINAL_MARGIN_RIGHT,
  NOTIFICATION_BELL_USER_EXTRA_PX,
  NOTIFICATION_COUNTER_FOUR_DIGIT_LABEL,
  assessNotificationCounterClipRisk,
  fourDigitBadgeMinWidth,
  resolveNotificationBellMarginRight,
} from "./notification-bell-layout";

describe("notification-bell-layout", () => {
  it("meets user minimum inset (original 10px + 2px extra) before iteration", () => {
    expect(
      NOTIFICATION_BELL_MARGIN_RIGHT,
    ).toBeGreaterThanOrEqual(
      NOTIFICATION_BELL_ORIGINAL_MARGIN_RIGHT + NOTIFICATION_BELL_USER_EXTRA_PX,
    );
  });

  it("fits a four-digit counter label inside the badge min width", () => {
    const assessment = assessNotificationCounterClipRisk(
      NOTIFICATION_BELL_MARGIN_RIGHT,
      NOTIFICATION_BADGE_MIN_WIDTH,
    );
    expect(assessment.canClip).toBe(false);
    expect(assessment.reasons).toEqual([]);
  });

  it("iterates marginRight by 1px until clip assessment passes", () => {
    const badgeMin = fourDigitBadgeMinWidth();
    let marginRight =
      NOTIFICATION_BELL_ORIGINAL_MARGIN_RIGHT + NOTIFICATION_BELL_USER_EXTRA_PX;
    let steps = 0;

    while (assessNotificationCounterClipRisk(marginRight, badgeMin).canClip) {
      marginRight += 1;
      steps += 1;
      expect(steps).toBeLessThanOrEqual(32);
    }

    expect(marginRight).toBe(resolveNotificationBellMarginRight());
    expect(marginRight).toBe(NOTIFICATION_BELL_MARGIN_RIGHT);
  });

  it("uses four-digit worst case label", () => {
    expect(NOTIFICATION_COUNTER_FOUR_DIGIT_LABEL).toBe("9999");
    expect(NOTIFICATION_BADGE_MIN_WIDTH).toBe(45);
  });
});
