#!/bin/sh
set -e
npx --yes tsc --project tsconfig.production.json
npx --yes terser --compress --mangle --output ./dist/cdom.min.js -- ./dist/cdom.js
