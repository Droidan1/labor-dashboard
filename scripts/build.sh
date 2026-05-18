#!/usr/bin/env bash
# Stage ONLY the static frontend into dist/ for Cloudflare Pages.
# Deliberately excludes: worker.js, wrangler.toml (live secrets!),
# migration-*.sql, schema.sql, package*.json, node_modules, .git, docs/.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
mkdir -p dist/html

cp index.html sw.js manifest.json tailwind.css \
   BLlogo.svg icon-192.png icon-512.png apple-touch-icon.png \
   dist/

# Per-store pages + their stylesheet (filenames contain spaces).
find html -type f ! -name '.DS_Store' -exec cp {} dist/html/ \;

# PWA correctness: never let the service worker / shell go stale on Pages.
cat > dist/_headers <<'EOF'
/sw.js
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
EOF

echo "dist/ built:"
ls -1 dist
