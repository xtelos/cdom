#!/bin/sh
set -e
# Deliberately NOT npx: `npx --yes` silently downloads the latest tsc/terser when
# node_modules is absent, and the byte-reproducibility this repo relies on is a
# property of the pinned versions in package.json.
if [ ! -x node_modules/.bin/tsc ] || [ ! -x node_modules/.bin/terser ]; then
	echo "build.sh: run 'npm install' first (pinned tsc + terser are what make this build reproducible)." >&2
	exit 1
fi

# Optional first argument: an alternate output directory. check-dist.sh builds into a
# temp dir so it can compare against the committed artifact without overwriting it.
OUT_DIR="${1:-./dist}"
mkdir -p "$OUT_DIR"

node_modules/.bin/tsc --project tsconfig.production.json --outDir "$OUT_DIR"
node_modules/.bin/terser --compress --mangle --output "$OUT_DIR/cdom.min.js" -- "$OUT_DIR/cdom.js"
