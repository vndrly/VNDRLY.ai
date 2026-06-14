import { describe, expect, it } from "vitest";
import {
  isLifecycleCoherent,
  lifecycleStateForOfficeStatus,
  KICKBACK_ALLOWED_STATUSES,
  SUBMIT_ALLOWED_STATUSES,
} from "./ticket-lifecycle-coherence";

describe("lifecycleStateForOfficeStatus", () => {
  it("maps on-the-clock and terminal office statuses", () => {
    expect(lifecycleStateForOfficeStatus("in_progress")).toBe("on_site");
    expect(lifecycleStateForOfficeStatus("submitted")).toBe("off_site");
    expect(lifecycleStateForOfficeStatus("cancelled")).toBe("off_site");
    expect(lifecycleStateForOfficeStatus("initiated")).toBe("pending_arrival");
  });
});

describe("isLifecycleCoherent", () => {
  it("accepts canonical pairs", () => {
    expect(isLifecycleCoherent("in_progress", "on_site")).toBe(true);
    expect(isLifecycleCoherent("submitted", "off_site")).toBe(true);
    expect(isLifecycleCoherent("initiated", "en_route")).toBe(true);
    expect(isLifecycleCoherent("awaiting_acceptance", "pending_arrival")).toBe(true);
  });

  it("rejects known drift patterns", () => {
    expect(isLifecycleCoherent("in_progress", "off_site")).toBe(false);
    expect(isLifecycleCoherent("in_progress", "en_route")).toBe(false);
    expect(isLifecycleCoherent("submitted", "on_site")).toBe(false);
    expect(isLifecycleCoherent("initiated", "on_site")).toBe(false);
  });
});

describe("mutation guard allowlists", () => {
  it("submit allows post-field review states only", () => {
    expect(SUBMIT_ALLOWED_STATUSES.has("pending_review")).toBe(true);
    expect(SUBMIT_ALLOWED_STATUSES.has("initiated")).toBe(false);
    expect(SUBMIT_ALLOWED_STATUSES.has("in_progress")).toBe(false);
  });

  it("kickback allows submitted or approved only", () => {
    expect(KICKBACK_ALLOWED_STATUSES.has("submitted")).toBe(true);
    expect(KICKBACK_ALLOWED_STATUSES.has("approved")).toBe(true);
    expect(KICKBACK_ALLOWED_STATUSES.has("pending_review")).toBe(false);
  });
});
