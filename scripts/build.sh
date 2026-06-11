#!/usr/bin/env sh
set -e

esbuild src/index.ts src/cli.ts src/db/schema.ts \
  --bundle \
  --packages=external \
  --platform=node \
  --format=esm \
  --outdir=dist

cp src/db/schema.sql dist/db/schema.sql
