# Ambitecture install helpers — source after install/config.sh

if [[ -n "${AMBI_INSTALL_LIB_LOADED:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi
AMBI_INSTALL_LIB_LOADED=1

if [[ -z "${RASPBERRY_SSH:-}" || -z "${RASPBERRY_HOST:-}" ]]; then
  echo "ERROR: source install/config.sh before install/lib.sh" >&2
  return 1 2>/dev/null || exit 1
fi

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$INSTALL_DIR/.." && pwd)"

REMOTE_DIR='Ambitecture'
NODE_MAJOR=22

LOCAL_VAR_DIR="$REPO_ROOT/var"
REMOTE_VAR_RSPEC="${RASPBERRY_SSH}:${REMOTE_DIR}/var/"

ENV_OVERRIDES=(
  "AMBITECTURE_HUB_URL=http://${RASPBERRY_HOST}:2612"
  "PLUGIN_PUBLIC_HOST=${RASPBERRY_HOST}"
)

HUB_URL_VALUE="http://${RASPBERRY_HOST}:2612"

ENV_MODULES=(
  "modules/hub"
  "modules/renderers/dmx-ts"
  "modules/renderers/neewer"
  "modules/controllers/midi-v1"
  "modules/controllers/music-analyser"
)

WEB_CONFIGS=(
  "modules/controllers/surface-v2/config.json"
  "modules/renderers/simulator-2d/src/config.json"
  "modules/renderers/starter-web-app/config.json"
  "modules/renderers/screen/config.json"
)

if [[ -t 1 ]]; then
  C_BLUE=$'\033[1;34m'
  C_GREEN=$'\033[1;32m'
  C_YELLOW=$'\033[1;33m'
  C_RED=$'\033[1;31m'
  C_RESET=$'\033[0m'
else
  C_BLUE=''
  C_GREEN=''
  C_YELLOW=''
  C_RED=''
  C_RESET=''
fi

log()  { echo "${C_BLUE}==>${C_RESET} $*"; }
ok()   { echo "${C_GREEN}  ok${C_RESET} $*"; }
warn() { echo "${C_YELLOW}  !!${C_RESET} $*"; }
err()  { echo "${C_RED} ERR${C_RESET} $*" >&2; }

SSH_OPTS=(-o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)
RSYNC_RSH="ssh ${SSH_OPTS[*]}"

rssh() {
  ssh "${SSH_OPTS[@]}" "$RASPBERRY_SSH" "$@"
}

local_mtime() {
  local path="$1"
  if [[ -f "$path" ]]; then
    stat -f %m "$path"
  else
    echo 0
  fi
}

remote_mtime() {
  local rel="$1"
  local remote="\$HOME/$REMOTE_DIR/$rel"
  rssh "if [[ -f '$remote' ]]; then stat -c %Y '$remote'; fi" 2>/dev/null || true
}

remote_exists() {
  local rel="$1"
  local remote="\$HOME/$REMOTE_DIR/$rel"
  rssh "[[ -f '$remote' ]]" 2>/dev/null
}

install_require_tools() {
  command -v rsync >/dev/null 2>&1 || { err "rsync not found on this machine"; return 1; }
  command -v ssh   >/dev/null 2>&1 || { err "ssh not found on this machine"; return 1; }
}

install_check_ssh() {
  log "Checking SSH connectivity to ${RASPBERRY_SSH} ..."
  if ! ssh "${SSH_OPTS[@]}" -o BatchMode=yes "$RASPBERRY_SSH" 'echo ok' >/dev/null 2>&1; then
    err "cannot SSH to ${RASPBERRY_SSH} (set up key auth: ssh-copy-id ${RASPBERRY_SSH})"
    return 1
  fi
  ok "SSH reachable"
}
