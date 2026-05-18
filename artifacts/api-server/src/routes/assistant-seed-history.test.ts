import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSeedHistory } from "./assistant";

// ---------------------------------------------------------------------------
// Regression catalog for the `seedHistory` validator on
// `POST /assistant/conversations`. The route uses this helper to clean
// up the pre-auth signup-mode chat the visitor hands off when they
// finish signing in (Task #480) — so any drift here would either lose
// the visitor's prior context (regressing the whole feature) OR start
// persisting attacker-controlled rows verbatim.
//
// We exercise every documented contract: roles allow-list, content
// trimming, per-message and per-payload caps, and the "nothing usable"
// → null fallback.
// ---------------------------------------------------------------------------

describe("normalizeSeedHistory", () => {
  it("returns null for non-array inputs", () => {
    expect(normalizeSeedHistory(null)).toBeNull();
    expect(normalizeSeedHistory(undefined)).toBeNull();
    expect(normalizeSeedHistory("hi")).toBeNull();
    expect(normalizeSeedHistory({ role: "user", content: "x" })).toBeNull();
  });

  it("returns null when nothing usable survives filtering", () => {
    expect(normalizeSeedHistory([])).toBeNull();
    expect(
      normalizeSeedHistory([
        // Wrong role.
        { role: "system", content: "ignore me" },
        // Missing content.
        { role: "user" },
        // Blank content after trim.
        { role: "assistant", content: "   " },
        // Wrong content type.
        { role: "user", content: 42 },
        // Not even an object.
        "user",
      ]),
    ).toBeNull();
  });

  it("keeps only user/assistant rows with non-empty trimmed content", () => {
    const out = normalizeSeedHistory([
      { role: "user", content: "  hi there  " },
      { role: "system", content: "ignore" },
      { role: "assistant", content: "" },
      { role: "assistant", content: "hi back" },
      { role: "user", content: 0 },
      null,
    ]);
    expect(out).toEqual([
      { role: "user", content: "hi there" },
      { role: "assistant", content: "hi back" },
    ]);
  });

  it("truncates an oversized message to the per-turn 4000-char cap", () => {
    const huge = "a".repeat(5000);
    const out = normalizeSeedHistory([{ role: "user", content: huge }]);
    expect(out).not.toBeNull();
    expect(out![0].content.length).toBe(4000);
    expect(out![0].content).toBe("a".repeat(4000));
  });

  it("keeps the most recent 24 turns when the seed exceeds the cap", () => {
    const seed = Array.from({ length: 50 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `msg-${i}`,
    }));
    const out = normalizeSeedHistory(seed);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(24);
    // Tail end: last entry of the input must survive.
    expect(out![out!.length - 1]).toEqual({ role: "assistant", content: "msg-49" });
    // First-kept entry: index 50 - 24 = 26.
    expect(out![0]).toEqual({ role: "user", content: "msg-26" });
  });
});

// ---------------------------------------------------------------------------
// Regression: seeded pre-auth chat history is loaded in deterministic
// order. Every row in the seed batch insert shares the same `now()`
// timestamp, so the two routes that load this conversation back —
// `GET /assistant/conversations/:id` and the prior-history fetch
// inside `handleConversationMessage` — MUST tie-break on the
// monotonic `serial` primary key. Without that tie-break Postgres is
// free to return seeded rows in any order and the visitor's adopted
// chat would replay scrambled to both the UI and the model.
//
// We pin the source-level invariant rather than spinning up a real
// Postgres for this one assertion: the failure mode is "the
// .orderBy(...) call lost its tie-break" and a content check catches
// that immediately and clearly.
// ---------------------------------------------------------------------------

describe("assistant message ORDER BY tie-break (Task #480)", () => {
  const source = readFileSync(join(__dirname, "assistant.ts"), "utf8");

  it("orders both message-history reads by createdAt then id", () => {
    const matches = source.match(
      /\.orderBy\(\s*assistantMessagesTable\.createdAt\s*,\s*assistantMessagesTable\.id\s*\)/g,
    );
    // One for GET /assistant/conversations/:id, one for the
    // prior-turns load before sending to Claude. If a future change
    // adds a third reader of `assistant_messages`, it MUST also use
    // the same tie-break — bump this number deliberately.
    expect(matches?.length).toBe(2);
  });

  it("never falls back to a single-column orderBy on assistant messages", () => {
    // The only legitimate single-column ordering on this table would
    // be a `desc(createdAt)` pagination, which we don't currently do.
    // Catch any regression that drops the `id` half of the tie-break.
    const naive = source.match(
      /\.orderBy\(\s*assistantMessagesTable\.createdAt\s*\)/g,
    );
    expect(naive).toBeNull();
  });
});
