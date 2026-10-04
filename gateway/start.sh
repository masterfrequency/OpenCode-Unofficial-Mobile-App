#!/usr/bin/env sh
set -eu

if ! command -v opencode >/dev/null 2>&1; then
  echo "OpenCode is not installed or is not on PATH." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required." >&2
  exit 1
fi
if [ -z "${OPENCODE_REMOTE_TOKEN:-}" ]; then
  echo "Set OPENCODE_REMOTE_TOKEN to a random value of at least 32 characters." >&2
  echo "Example: export OPENCODE_REMOTE_TOKEN=\$(openssl rand -hex 32)" >&2
  exit 1
fi

opencode serve --hostname 127.0.0.1 --port 4096 &
backend_pid=$!
trap 'kill "$backend_pid" 2>/dev/null || true' EXIT INT TERM
node "$(dirname "$0")/server.mjs"
