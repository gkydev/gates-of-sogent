#!/usr/bin/env bash
set -euo pipefail

CONTAINER="${FOUNDRY_DEV_CONTAINER:-gates-foundry-dev}"
IMAGE="${FOUNDRY_NODE_IMAGE:-node:20.19-bookworm}"
TOOL_ROOT="/opt/foundry-tools"

usage() {
  cat <<'EOF'
Usage:
  ./tools/foundry-dev.sh start
  ./tools/foundry-dev.sh stop
  ./tools/foundry-dev.sh restart
  ./tools/foundry-dev.sh status
  ./tools/foundry-dev.sh shell
  ./tools/foundry-dev.sh [forge args...]
  ./tools/foundry-dev.sh forge [args...]
  ./tools/foundry-dev.sh cast [args...]
  ./tools/foundry-dev.sh anvil [args...]
  ./tools/foundry-dev.sh cast-send-private <to> <sig> [args...] --rpc-url ...

Examples:
  ./tools/foundry-dev.sh test -vvv
  ./tools/foundry-dev.sh cast call $GAME_ADDRESS "contractVersion()(string)" --rpc-url $SOMNIA_RPC_URL
EOF
}

is_running() {
  docker inspect -f '{{.State.Running}}' "$CONTAINER" >/dev/null 2>&1 &&
    [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" == "true" ]]
}

exists() {
  docker inspect "$CONTAINER" >/dev/null 2>&1
}

start_container() {
  if is_running; then
    echo "$CONTAINER is already running."
    return
  fi

  if exists; then
    docker start "$CONTAINER" >/dev/null
  else
    docker run -d \
      --name "$CONTAINER" \
      --pull=never \
      -v "$PWD":/src:ro \
      -w /tmp \
      "$IMAGE" \
      sleep infinity >/dev/null
  fi

  install_tools
  echo "$CONTAINER is ready."
}

stop_container() {
  if exists; then
    docker rm -f "$CONTAINER" >/dev/null
    echo "$CONTAINER stopped and removed."
  else
    echo "$CONTAINER is not present."
  fi
}

install_tools() {
  docker exec "$CONTAINER" bash -lc '
    set -euo pipefail

    if [[ -f "'"$TOOL_ROOT"'/.ready" ]]; then
      exit 0
    fi

    mkdir -p "'"$TOOL_ROOT"'"
    cd "'"$TOOL_ROOT"'"
    npm init -y >/tmp/foundry-dev-npm-init.log
    npm install --ignore-scripts --save-dev \
      @foundry-rs/forge@1.7.1 \
      @foundry-rs/anvil@1.7.1 \
      @foundry-rs/cast@1.7.1 >/tmp/foundry-dev-npm-install.log
    touch "'"$TOOL_ROOT"'/.ready"
  '
}

run_tool() {
  local tool="$1"
  local cast_send_private="$2"
  shift 2

  start_container >/dev/null

  docker exec "$CONTAINER" bash -lc '
    set -euo pipefail

    if [[ -f /src/.env ]]; then
      set -a
      # shellcheck disable=SC1091
      source /src/.env
      set +a
    fi

    work_root="$(mktemp -d /tmp/gates-foundry-work.XXXXXX)"
    cleanup() {
      rm -rf "$work_root"
    }
    trap cleanup EXIT

    cp -a /src/. "$work_root"/
    cd "$work_root"

    tool="$1"
    cast_send_private="$2"
    shift 2

    if [[ "$tool" == "cast" && "$cast_send_private" == "1" ]]; then
      if [[ -z "${PRIVATE_KEY:-}" ]]; then
        echo "PRIVATE_KEY is missing. Add it to .env." >&2
        exit 1
      fi
      TARGET_TOOL="$tool" node "'"$TOOL_ROOT"'/node_modules/@foundry-rs/$tool/bin.mjs" send "$@" --private-key "$PRIVATE_KEY"
    else
      TARGET_TOOL="$tool" node "'"$TOOL_ROOT"'/node_modules/@foundry-rs/$tool/bin.mjs" "$@"
    fi
  ' bash "$tool" "$cast_send_private" "$@"
}

if [[ $# -eq 0 ]]; then
  run_tool forge 0 test -vvv
  exit 0
fi

case "$1" in
  start)
    start_container
    ;;
  stop)
    stop_container
    ;;
  restart)
    stop_container
    start_container
    ;;
  status)
    if is_running; then
      docker ps --filter "name=^/${CONTAINER}$"
    elif exists; then
      docker ps -a --filter "name=^/${CONTAINER}$"
    else
      echo "$CONTAINER is not present."
    fi
    ;;
  shell)
    start_container >/dev/null
    docker exec -it "$CONTAINER" bash
    ;;
  help|-h|--help)
    usage
    ;;
  cast-send-private)
    shift
    run_tool cast 1 "$@"
    ;;
  forge|cast|anvil)
    tool="$1"
    shift
    run_tool "$tool" 0 "$@"
    ;;
  *)
    run_tool forge 0 "$@"
    ;;
esac
