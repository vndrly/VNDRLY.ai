/**
 * Prints one-time Replit deploy credentials setup (run once from Cursor terminal).
 */
console.log(`
One-time setup so "pnpm run save" updates vndrly.ai without opening Replit:

1. In your browser, log into replit.com as v@vndrly.ai
2. Open your VNDRLY Repl (the project that powers vndrly.ai)
3. Copy the Repl ID from the URL or Repl settings (UUID format)
4. Create a Replit API / deploy token (Account settings → API / Tokens)
5. Add to .env.local:

   REPL_ID=paste-uuid-here
   REPLIT_DEPLOY_TOKEN=paste-token-here
   PRODUCTION_HEALTH_URL=https://vndrly.ai/api/healthz

6. Connect the Repl to GitHub repo vndrly/VNDRLY.ai branch main
   (Repl settings → Git / GitHub — one time)

After that, from Cursor only:
   pnpm run save

That commits, pushes to GitHub, triggers Replit deploy, and waits for vndrly.ai.
You never open Replit again for daily updates.
`);
