# Local preview session isolation

Use the existing `run-api-local.mjs`, `run-vite-local.mjs`,
`run-expo-local.mjs`, or `run-expo-ios-local.mjs` launchers for local previews.
The Expo browser launcher sends API requests through `localhost:8099` to
the local API at `127.0.0.1:8080` by default. Start the local API before
signing in. This avoids tying local sign-in to a long-running process's
external network proxy credentials. An explicit
`EXPO_LOCAL_API_PROXY_TARGET` override still selects a different API.
After changing API targets, sign in again; local and production tokens
are deliberately not interchangeable.
The older `run-production-api.mjs` / `run-production-web.mjs` local
production-build wrappers use the same isolation guard.
The API package's `start` command also enters that guarded local wrapper.
The isolated database test wrapper may retain only its fixed, inert
`test-secret` fixture key; test flags never preserve an unknown signing key.
Their shared defaults always replace any inherited or `.env.local`
`SESSION_SECRET` with a random checkout-owned key in
`.local/dev-session-secret`. The ignored file is reused across launches so
the local API and web preview agree and local sessions survive restarts.
An invalid key file stops startup. The key is never printed or exposed as
a `VITE_` / `EXPO_PUBLIC_` session-secret variable.

Never retrieve the production session secret for preview authentication.
The retired Fleet Inventory preview and its SSH inspection helper have
been removed. Do not recreate that path. Use normal sign-in and the
account-scoped API when working against an explicitly authorized live
environment; local signing keys cannot validate production sessions.

Actual VPS production start/deploy commands retain their existing secret handling.
No production credential is changed by the local preview guard. Existing
processes started before the guard must be stopped before using the
secured launchers. Do not restart an old checkout's unpatched launchers.

Focused verification: `node --test scripts/tests/local-session-secret.test.mjs`.
