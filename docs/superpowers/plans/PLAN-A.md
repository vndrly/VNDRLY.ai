# Plan A — Canonical Execution Manifes

**Status:** Consistency-reviewed and ready for execution
**Command:** `Implement Plan A`
**Release:** One coordinated full ship through TestFligh

An executor must read these files in order before changing product code:

1. `docs/plans/2026-09-13-implementation-a-design.md` — approved product and architecture specification.
2. `docs/superpowers/plans/2026-09-13-implementation-a.md` — twenty-three test-first implementation stages.
3. `docs/superpowers/plans/2026-09-13-implementation-a-consistency.md` — binding corrections from the final consistency review.

The consistency file overrides conflicting wording in the detailed task plan. It does not add another release or optional phase. All three files together are **Plan A**.

Execution must use `superpowers:executing-plans` for one-session work or `superpowers:subagent-driven-development` when delegation is explicitly authorized. Continue stage by stage, preserve checkpoint commits, and do not claim completion until the full-ship criteria in Task 23 are verified.
