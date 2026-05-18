#!/bin/bash
set -e
pnpm install --frozen-lockfile
yes "" | pnpm --filter db push-force || true
