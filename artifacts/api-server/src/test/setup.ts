// Pin SESSION_SECRET unconditionally so cookie signatures line up with the
// literal `"test-secret"` default in `test-utils/session.ts`. A shared dev
// shell may export a real `SESSION_SECRET` that does not match what the test
// helpers use; honoring that here would silently 401 every authenticated
// route test. See the doc comment on `DEFAULT_TEST_SESSION_SECRET` in
// `src/test-utils/session.ts` for the broader rationale.
process.env.SESSION_SECRET = "test-secret";
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://test:test@localhost:5432/test";
