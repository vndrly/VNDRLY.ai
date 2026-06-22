/** Layout constants for the home header notification bell + counter only. */

export const NOTIFICATION_BELL_ORIGINAL_MARGIN_RIGHT = 10;
/** User order: 2px extra beyond clearing a four-digit counter. */
export const NOTIFICATION_BELL_USER_EXTRA_PX = 2;
export const NOTIFICATION_BRAND_ROW_PADDING = 16;
export const NOTIFICATION_BADGE_RIGHT_OFFSET = 4;
export const NOTIFICATION_BELL_BTN_PADDING = 6;
export const NOTIFICATION_BELL_ICON_SIZE = 28;
export const NOTIFICATION_BADGE_PADDING_HORIZONTAL = 8;
export const NOTIFICATION_BADGE_BORDER_WIDTH = 1.5;
export const NOTIFICATION_BADGE_FONT_SIZE = 10;
/** Worst-case counter label per user spec (four digits). */
export const NOTIFICATION_COUNTER_FOUR_DIGIT_LABEL = "9999";
/** Conservative per-glyph width for Inter 700 @ 10px (verified in unit test). */
export const NOTIFICATION_BADGE_CHAR_WIDTH = 6.5;

export function fourDigitBadgeMinWidth(): number {
  return Math.ceil(
    NOTIFICATION_BADGE_CHAR_WIDTH * NOTIFICATION_COUNTER_FOUR_DIGIT_LABEL.length +
      NOTIFICATION_BADGE_PADDING_HORIZONTAL * 2 +
      NOTIFICATION_BADGE_BORDER_WIDTH * 2,
  );
}

export function bellButtonWidth(): number {
  return NOTIFICATION_BELL_BTN_PADDING * 2 + NOTIFICATION_BELL_ICON_SIZE;
}

export type ClipAssessment = {
  canClip: boolean;
  reasons: string[];
};

/** Returns true while any user-spec clip risk remains for the counter bubble. */
export function assessNotificationCounterClipRisk(
  marginRight: number,
  badgeMinWidth: number,
): ClipAssessment {
  const reasons: string[] = [];
  const userMinimumMargin =
    NOTIFICATION_BELL_ORIGINAL_MARGIN_RIGHT + NOTIFICATION_BELL_USER_EXTRA_PX;
  const requiredBadgeMin = fourDigitBadgeMinWidth();

  if (marginRight < userMinimumMargin) {
    reasons.push(
      `marginRight ${marginRight}px is below user minimum ${userMinimumMargin}px (original ${NOTIFICATION_BELL_ORIGINAL_MARGIN_RIGHT} + ${NOTIFICATION_BELL_USER_EXTRA_PX}px extra)`,
    );
  }

  if (badgeMinWidth < requiredBadgeMin) {
    reasons.push(
      `badge minWidth ${badgeMinWidth}px is below four-digit minimum ${requiredBadgeMin}px for "${NOTIFICATION_COUNTER_FOUR_DIGIT_LABEL}"`,
    );
  }

  const badgeRightClearanceFromScreen =
    NOTIFICATION_BRAND_ROW_PADDING + marginRight - NOTIFICATION_BADGE_RIGHT_OFFSET;
  if (badgeRightClearanceFromScreen < NOTIFICATION_BELL_USER_EXTRA_PX) {
    reasons.push(
      `counter bubble is ${badgeRightClearanceFromScreen}px from screen edge; need at least ${NOTIFICATION_BELL_USER_EXTRA_PX}px`,
    );
  }

  const textWidth =
    NOTIFICATION_BADGE_CHAR_WIDTH * NOTIFICATION_COUNTER_FOUR_DIGIT_LABEL.length;
  const innerWidth = badgeMinWidth - NOTIFICATION_BADGE_BORDER_WIDTH * 2;
  const textArea = innerWidth - NOTIFICATION_BADGE_PADDING_HORIZONTAL * 2;
  if (textArea < textWidth) {
    reasons.push(
      `counter text area ${textArea}px cannot fit four-digit label (~${textWidth}px)`,
    );
  }

  return { canClip: reasons.length > 0, reasons };
}

/**
 * User order: start at original inset + 2px, then move 1px left (increase
 * marginRight) while assessNotificationCounterClipRisk still reports risk.
 */
export function resolveNotificationBellMarginRight(): number {
  const badgeMin = fourDigitBadgeMinWidth();
  let marginRight =
    NOTIFICATION_BELL_ORIGINAL_MARGIN_RIGHT + NOTIFICATION_BELL_USER_EXTRA_PX;

  for (let step = 0; step < 32; step += 1) {
    const assessment = assessNotificationCounterClipRisk(marginRight, badgeMin);
    if (!assessment.canClip) {
      return marginRight;
    }
    marginRight += 1;
  }

  return marginRight;
}

export const NOTIFICATION_BELL_MARGIN_RIGHT = resolveNotificationBellMarginRight();
export const NOTIFICATION_BADGE_MIN_WIDTH = fourDigitBadgeMinWidth();
