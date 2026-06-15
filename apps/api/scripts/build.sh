#!/usr/bin/env sh
set -e

# 注册表依赖保持 external（含原生模块 better-sqlite3）；
# workspace 包（@hatch-radar/shared，TS 源码形态）需要打进产物，否则运行时无法解析
EXTERNALS=$(node -p "Object.entries(require('./package.json').dependencies).filter(([, v]) => !String(v).startsWith('workspace:')).map(([k]) => '--external:' + k).join(' ')")

esbuild src/index.ts src/cli.ts src/db/schema.ts src/serve.ts src/export-batch.ts \
  --bundle \
  $EXTERNALS \
  --platform=node \
  --format=esm \
  --outdir=dist
