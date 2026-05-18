#!/bin/bash
# Sync the local dev environment to the currently-checked-out code.
#
# Run this after `git pull` or switching branches so the dev database
# matches `lib/db/src/schema` and node_modules matches `pnpm-lock.yaml`.
# The post-merge hook (`scripts/post-merge.sh`) does the same thing
# automatically when a task is merged; this script is the manual
# equivalent for plain `git pull` / branch switches.
#
# Steps:
#   1. Reinstall workspace deps from the lockfile.
#   2. Force-push the Drizzle schema to the dev DB (non-interactive,
#      data-loss prompts auto-accepted -- this is a dev DB).
#   3. Verify with the schema-drift check so the script exits non-zero
#      if anything is still out of sync.
set -e

pnpm install --frozen-lockfile
yes "" | pnpm --filter @workspace/db run push-force
pnpm --filter @workspace/db run check-schema
