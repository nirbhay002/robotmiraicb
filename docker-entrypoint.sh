#!/bin/sh
set -eu

DATA_DIR="/data"

mkdir -p "${DATA_DIR}"
chown -R node:node "${DATA_DIR}"

exec gosu node "$@"
