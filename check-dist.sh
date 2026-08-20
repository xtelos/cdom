#!/bin/sh
set -e
# Rebuilds into a temp directory and compares against the committed artifacts, twice
# over, because the two questions have different answers:
#
#   1. Does a fresh build match what is in dist/ right now? After a build that is a
#      byte-reproducibility check, which this repo documented and never verified.
#   2. Does a fresh build match the dist/ committed at HEAD? That is the vendoring
#      contract: cas copies the committed bundle, so a commit whose src/ and dist/
#      disagree ships a bundle nobody built. `npm run verify` cannot see this on its
#      own, because pretest rebuilds dist/ before the comparison and would quietly
#      repair the working tree instead of failing. Check 2 only runs when the working
#      tree's build inputs already match HEAD, so it never fires mid-edit.
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

HEAD_CHECKED=no
if git rev-parse --is-inside-work-tree >/dev/null 2>&1 &&
	git diff --quiet HEAD -- src build.sh tsconfig.production.json 2>/dev/null; then
	HEAD_CHECKED=yes
	for f in cdom.min.js cdom.d.ts; do
		if git show "HEAD:dist/$f" > "$TMP_DIR/head-$f" 2>/dev/null; then
			if ! cmp -s "$TMP_DIR/$f" "$TMP_DIR/head-$f"; then
				echo "check-dist.sh: the dist/$f committed at HEAD is not a build of the src/ committed at HEAD." >&2
				echo "check-dist.sh: rebuild and amend the commit, or cas will vendor a bundle nobody built." >&2
				STATUS=1
			fi
		fi
	done
fi

if [ "$STATUS" -ne 0 ]; then
	echo "check-dist.sh: run 'npm run build' and commit the result, or investigate a non-reproducible build (tsc/terser must stay pinned)." >&2
	exit 1
fi

if [ "$HEAD_CHECKED" = yes ]; then
	echo "check-dist.sh: dist/ matches a fresh build of src/cdom.ts, and so does the dist/ committed at HEAD."
else
	# Never claim a check that did not run. src/ differs from HEAD, which is the normal
	# mid-edit state, so only the working-tree comparison is meaningful right now.
	echo "check-dist.sh: dist/ matches a fresh build of src/cdom.ts. HEAD comparison skipped: src/ differs from HEAD."
fi
