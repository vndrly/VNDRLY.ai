/**
 * Canonical 900×229 pill PNG palette (PillsV1 — clean edges, no shadow artifacts).
 * All pill surfaces import from here — do not reference attached_assets pill PNGs directly.
 */
import pillGrey from "@assets/pills/pill_grey.png";
import pillLightGrey from "@assets/pills/pill_light_grey.png";
import pillLightGreyV2r from "@assets/pills/pill_light_grey_v2r.png";
import pillWhite from "@assets/pills/pill_white.png";
import pillBlack from "@assets/pills/pill_black.png";
import pillBlue from "@assets/pills/pill_blue.png";
import pillBabyBlue from "@assets/pills/pill_baby_blue.png";
import pillNavy from "@assets/pills/pill_navy.png";
import pillDarkBlue from "@assets/pills/pill_dark_blue.png";
import pillIndigo from "@assets/pills/pill_indigo.png";
import pillPurple from "@assets/pills/pill_purple.png";
import pillPink from "@assets/pills/pill_pink.png";
import pillHotPink from "@assets/pills/pill_hot_pink.png";
import pillRed from "@assets/pills/pill_red.png";
import pillDarkRed from "@assets/pills/pill_dark_red.png";
import pillAmber from "@assets/pills/pill_amber.png";
import pillDarkAmber from "@assets/pills/pill_dark_amber.png";
import pillOrange from "@assets/pills/pill_orange.png";
import pillDarkOrange from "@assets/pills/pill_dark_orange.png";
import pillTan from "@assets/pills/pill_tan.png";
import pillGreen from "@assets/pills/pill_green.png";
import pillDarkGreen from "@assets/pills/pill_dark_green.png";
import pillLime from "@assets/pills/pill_lime.png";
import pillTeal from "@assets/pills/pill_teal.png";
import pillLightTeal from "@assets/pills/pill_light_teal.png";
import pillCoffee from "@assets/pills/pill_coffee.png";
import pillDarkGrey from "@assets/pills/pill_dark_grey.png";
import pillVndrly from "@assets/pills/pill_vndrly.png";
import pillBaker from "@assets/pills/pill_baker.png";
import pillWinchester from "@assets/pills/pill_winchester.png";
import pillGlossOverlay from "@assets/pills/pill_gloss_overlay.png";
import pillLifecycleApproval1 from "@assets/pills/pill_lifecycle_approval1.png";
import pillLifecycleApproval2 from "@assets/pills/pill_lifecycle_approval2.png";
import pillLifecycleApproval3 from "@assets/pills/pill_lifecycle_approval3.png";
import pillLifecycleSubmitted from "@assets/pills/pill_lifecycle_submitted.png";
import pillLifecyclePendingReview from "@assets/pills/pill_lifecycle_pending_review.png";
import pillLifecycleInProgress from "@assets/pills/pill_lifecycle_in_progress.png";
import pillLifecycleInitiated from "@assets/pills/pill_lifecycle_initiated.png";
import pillLifecycleAwaitingAcceptance from "@assets/pills/pill_lifecycle_awaiting_acceptance.png";

export {
  pillGrey,
  pillLightGrey,
  pillLightGreyV2r,
  pillWhite,
  pillBlack,
  pillBlue,
  pillBabyBlue,
  pillNavy,
  pillDarkBlue,
  pillIndigo,
  pillPurple,
  pillPink,
  pillHotPink,
  pillRed,
  pillDarkRed,
  pillAmber,
  pillDarkAmber,
  pillOrange,
  pillDarkOrange,
  pillTan,
  pillGreen,
  pillDarkGreen,
  pillLime,
  pillTeal,
  pillLightTeal,
  pillCoffee,
  pillDarkGrey,
  pillVndrly,
  pillBaker,
  pillWinchester,
  pillGlossOverlay,
  pillLifecycleApproval1,
  pillLifecycleApproval2,
  pillLifecycleApproval3,
  pillLifecycleSubmitted,
  pillLifecyclePendingReview,
  pillLifecycleInProgress,
  pillLifecycleInitiated,
  pillLifecycleAwaitingAcceptance,
};

/** Interactive pill idle/rest chrome. */
export const PILL_IDLE = pillLightGreyV2r;

/** Inactive half of EN/ES + dark/light toggles. */
export const PILL_TOGGLE_IDLE = pillWhite;

/** Semantic action colors (PngPill / PngPillButton). */
export const PILL_ACTION = {
  blue: pillBlue,
  green: pillGreen,
  red: pillRed,
  amber: pillAmber,
} as const;

/** Brand-named pills (vndrly / baker / winchester are palette colors). */
export const PILL_BRAND = {
  vndrly: pillVndrly,
  baker: pillBaker,
  winchester: pillWinchester,
} as const;
