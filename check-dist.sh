#!/bin/sh
set -e
# Rebuilds into a temp directory and compares against the committed artifacts.
#
# This is two checks in one, and which one it is depends on when you run it:
#   - on a clean checkout, it proves the committed dist/ is what src/ actually builds to
#     (the "you edited the source and forgot to rebuild" check);
#   - after a build, it proves the build is deterministic (the byte-reproducibility this
#     repo documents and, until now, never verified).
# `npm run verify` runs it last, so it covers the second. CI or a fresh clone covers both.
if [ ! -x node_modules/.bin/tsc ] || [ ! -x node_modules/.bin/terser ]; then
	echo "check-dist.sh: run 'npm install' first." >&2
	exit 1
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

./build.sh "$TMP_DIR" >/dev/null

STATUS=0
for f in cdom.min.js cdom.d.ts; do
	if ! cmp -s "$TMP_DIR/$f" "./dist/$f"; then
		echo "check-dist.sh: dist/$f does not match a fresh build of src/cdom.ts." >&2
		STATUS=1
	fi
done

if [ "$STATUS" -ne 0 ]; then
	echo "check-dist.sh: run 'npm run build' and commit the result, or investigate a non-reproducible build (tsc/terser must stay pinned)." >&2
	exit 1
fi

echo "check-dist.sh: dist/cdom.min.js and dist/cdom.d.ts reproduce byte-for-byte from src/cdom.ts."
