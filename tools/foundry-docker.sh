#!/usr/bin/env bash
set -euo pipefail

IMAGE="${FOUNDRY_NODE_IMAGE:-node:20.19-bookworm}"
TOOL="forge"
CAST_SEND_PRIVATE=0

if [[ "${1:-}" == "cast-send-private" ]]; then
  TOOL="cast"
  CAST_SEND_PRIVATE=1
  shift
elif [[ "${1:-}" == "forge" || "${1:-}" == "cast" || "${1:-}" == "anvil" ]]; then
  TOOL="$1"
  shift
fi

if [[ $# -eq 0 ]]; then
  set -- test -vvv
fi

DOCKER_ARGS=(
  docker run --rm --pull=never
  -v "$PWD":/src:ro
  -w /tmp
)

if [[ -f ".env" ]]; then
  DOCKER_ARGS+=(--env-file .env)
fi

"${DOCKER_ARGS[@]}" \
  "$IMAGE" \
  bash -lc '
    set -euo pipefail

    mkdir -p /tmp/work
    cp -a /src/. /tmp/work/
    cd /tmp/work

    npm init -y >/tmp/npm-init.log
    npm install --ignore-scripts --save-dev \
      @foundry-rs/forge@1.7.1 \
      @foundry-rs/anvil@1.7.1 \
      @foundry-rs/cast@1.7.1 >/tmp/npm-install.log

    TOOL="$1"
    CAST_SEND_PRIVATE="$2"
    shift 2

    if [[ "$TOOL" == "cast" && "$CAST_SEND_PRIVATE" == "1" ]]; then
      TARGET_TOOL="$TOOL" node "node_modules/@foundry-rs/$TOOL/bin.mjs" send "$@" --private-key "$PRIVATE_KEY"
    else
      TARGET_TOOL="$TOOL" node "node_modules/@foundry-rs/$TOOL/bin.mjs" "$@"
    fi
  ' bash "$TOOL" "$CAST_SEND_PRIVATE" "$@"
