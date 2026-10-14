#!/bin/sh
# sp-mp — start Stronghold-Protocol with the multiplayer capacity overlay (4 / 8 / 12-seat co-op rooms).
# Nothing in the install is modified: see README.md. Extra arguments go to start.mjs.
set -e
cd "$(dirname "$0")/.."
exec node sp-mp/start.mjs "$@"
