# Calendar and Ask V Parity Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the approved Calendar visual changes and complete, permission-scoped Ask V parity for every Calendar operation.

**Architecture:** Extend the existing Work Hub calendar APIs and assistant runtime instead of creating a parallel scheduling system. A focused Calendar tool pack exposes existing collaboration, scheduling, hours, and project capabilities through one confirmation-bound mutation path. The web Calendar and AssistantPanel consume the same records and exact deep links.

**Tech Stack:** React 19, TypeScript, TanStack Query, Express 5, Drizzle/PostgreSQL, Vitest.

---

### Task 1: Lock the UI contract with failing tests

Add or update tests for the exact Create Shift/Event label, Create Task card, Day Agenda flyout, field order, meeting-type autocomplete, crew/person attendees, mandatory checkbox, branded weekday headers, conditional day borders, exact item navigation, and Start/Stop V labels. Run the focused tests and observe the intended failures.

### Task 2: Implement Calendar presentation and form behavior

Reuse the sidebar image resolver for weekday headers, update month-cell states, replace raw user IDs with searchable crew/person controls, and submit meeting or shift payloads through the shared calendar command.

### Task 3: Lock the assistant contract with failing tests

Extend toolbox tests for the Calendar-specific pack, agenda/detail reads, composite create/update/reschedule/cancel actions, mandatory state, hours and project actions, and visual client commands. Run the focused tests and observe failures.

### Task 4: Implement server-side Calendar parity

Add guarded schema fields only where needed, extend tenant-scoped routes, resolve crews and individuals server-side, create meeting types when missing, preserve audit history on cancellation, and reuse notification fan-out.

### Task 5: Implement Ask V visual companion behavior

Extend the existing results event and AssistantPanel so structured results and the active-session transcript appear in the Ask V shell. Add Today’s Agenda and exact item-detail flyouts, with permission-aware links and mutations.

### Task 6: Verify the unchanged project timeline UI and full behavior

Confirm Project Timeline is untouched, then run focused web/API suites, typecheck affected workspaces, locale parity, and the full required gates. Inspect the Calendar in the browser for visual and interaction acceptance. Do not publish until separately authorized.
