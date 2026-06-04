#!/usr/bin/env bash
#
# install-on-raspberry-debian.sh
#
# Provision a fresh Debian 12 (bookworm) Raspberry Pi 4 into a working Ambitecture host.
# Runs FROM the Mac/dev machine and pushes to the Pi over SSH + rsync.
#
# It installs everything: system packages, Node.js, PM2, native build deps, deploys the
# repo (working tree, including the gitignored .env / var/ / config.DEMO), autodetects the
# USB-DMX device, and brings the full PM2 stack (ecosystem.config.js) up — surviving reboot.
#
# The script is idempotent: re-running never fails. The common case (mode 3) just pushes
# Node app updates and restarts PM2.
#
# Usage:
#   ./install/install-on-raspberry-debian.sh                 # interactive menu
#   ./install/install-on-raspberry-debian.sh <mode> [envflag]
#     mode:    1 = Full Install (wipe first)
#              2 = Install (apt update/upgrade + update apps)
#              3 = Update Apps (deploy code + npm install + restart)  [default]
#     envflag: y = include .env + web config.json in the overwrite prompt (if present on Pi)
#              n = never push .env / config.json [default]
#   Modes 2/3: before deploy, lists var/ + (optional) host-config paths that would change the
#   Pi; enter space-separated numbers to allow overwrite (default none). var/ is never bulk-synced.
#
# Target host / SSH: install/config.sh (RASPBERRY_SSH, RASPBERRY_HOST only).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=install/config.sh
source "$SCRIPT_DIR/config.sh"
# shellcheck source=install/lib.sh
source "$SCRIPT_DIR/lib.sh"

# ----------------------------------------------------------------------------------------
# Argument / menu handling
# ----------------------------------------------------------------------------------------
MODE="${1:-}"
ENV_FLAG="${2:-}"

prompt_menu() {
  echo
  echo "Ambitecture — Raspberry Pi installer"
  echo "Target: ${RASPBERRY_SSH}  (host ${RASPBERRY_HOST})"
  echo
  echo "  1) Full Install - Wipe First"
  echo "  2) Install - Run package update, then Update Apps"
  echo "  3) Update Apps - TypeScript, Config, etc. (default)"
  echo
  read -r -p "Select [1/2/3] (default 3): " MODE
  MODE="${MODE:-3}"
  echo
  read -r -p "Transfer (patch) host config — .env + web config.json — to the Pi? [y/N]: " ENV_FLAG
  ENV_FLAG="${ENV_FLAG:-n}"
}

if [[ -z "$MODE" ]]; then
  if [[ -t 0 ]]; then
    prompt_menu
  else
    MODE=3
  fi
fi
ENV_FLAG="${ENV_FLAG:-n}"

case "$MODE" in
  1|2|3) ;;
  *) err "invalid mode '$MODE' (expected 1, 2 or 3)"; exit 1 ;;
esac

case "$ENV_FLAG" in
  y|Y|yes) TRANSFER_ENV=1 ;;
  *)       TRANSFER_ENV=0 ;;
esac

MODE_NAME=$([[ "$MODE" == 1 ]] && echo "Full Install (wipe first)" || ([[ "$MODE" == 2 ]] && echo "Install + package update" || echo "Update Apps"))
log "Mode $MODE — $MODE_NAME"
log "Transfer .env: $([[ $TRANSFER_ENV == 1 ]] && echo yes || echo no)"

# ----------------------------------------------------------------------------------------
# Preflight
# ----------------------------------------------------------------------------------------
install_require_tools
install_check_ssh

# ----------------------------------------------------------------------------------------
# Mode 1: wipe
# ----------------------------------------------------------------------------------------
if [[ "$MODE" == 1 ]]; then
  log "Wiping previous install on the Pi ..."
  rssh "command -v pm2 >/dev/null 2>&1 && pm2 delete all >/dev/null 2>&1; rm -rf ~/$REMOTE_DIR" || true
  ok "wiped ~/$REMOTE_DIR"
fi

# ----------------------------------------------------------------------------------------
# Pi overwrite guard (modes 2/3): detect conflicts BEFORE deploy, prompt, apply picks after
# ----------------------------------------------------------------------------------------
PI_OVERWRITE_CANDIDATES=()
PI_OVERWRITE_PICKED=()
HOST_CONFIG_TRANSFER_AUTO=()

rel_in_list() {
  local needle="$1"
  shift
  local item
  [[ $# -eq 0 ]] && return 1
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

# Strip optional " (…)" suffix from a numbered list entry back to a repo-relative path.
pi_overwrite_rel_path() {
  local entry="$1"
  if [[ "$entry" == *" ("* ]]; then
    printf '%s' "${entry%% (*}"
  else
    printf '%s' "$entry"
  fi
}

prompt_read_tty() {
  local varname="$1"
  local prompt_text="$2"
  if [[ -t 0 ]]; then
    read -r -p "$prompt_text" "$varname"
  elif [[ -r /dev/tty ]]; then
    read -r -p "$prompt_text" "$varname" </dev/tty
  else
    printf -v "$varname" ''
  fi
}

# prompt_pi_overwrite_picks — sets PI_OVERWRITE_PICKED (default none).
prompt_pi_overwrite_picks() {
  PI_OVERWRITE_PICKED=()
  local -a candidates=("$@")
  local count="${#candidates[@]}"
  [[ "$count" -eq 0 ]] && return 0

  echo
  warn "These files will get overridden on the Pi:"
  local i=1 entry
  for entry in "${candidates[@]}"; do
    echo "  $i) $entry"
    i=$((i + 1))
  done
  echo

  local picks=""
  prompt_read_tty picks "Enter numbers to overwrite (space-separated, default none): "
  if [[ -z "$picks" && ! -t 0 && ! -r /dev/tty ]]; then
    warn "non-interactive — not overwriting any of the above (default none)"
    return 0
  fi

  local num idx picked
  for num in $picks; do
    if [[ ! "$num" =~ ^[0-9]+$ ]]; then
      warn "ignoring invalid entry: $num"
      continue
    fi
    if (( num < 1 || num > count )); then
      warn "ignoring out-of-range number: $num"
      continue
    fi
    idx=$((num - 1))
    picked="${candidates[$idx]}"
    if rel_in_list "$picked" ${PI_OVERWRITE_PICKED[@]+"${PI_OVERWRITE_PICKED[@]}"}; then
      continue
    fi
    PI_OVERWRITE_PICKED+=("$picked")
  done
}

collect_var_pi_conflicts() {
  [[ "$MODE" == "1" ]] && return 0
  [[ ! -d "$REPO_ROOT/var" ]] && return 0

  local rel local_path
  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    if remote_exists "$rel"; then
      PI_OVERWRITE_CANDIDATES+=("$rel")
    fi
  done < <(find "$REPO_ROOT/var" -type f ! -name '.DS_Store' | sed "s|^$REPO_ROOT/||")

  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    local_path="$REPO_ROOT/$rel"
    if [[ ! -e "$local_path" ]]; then
      PI_OVERWRITE_CANDIDATES+=("$rel (Pi-only — would be removed)")
    fi
  done < <(rssh "cd \"\$HOME/$REMOTE_DIR\" && find var -type f ! -name '.DS_Store' 2>/dev/null" || true)
}

collect_host_config_pi_conflicts() {
  [[ "$TRANSFER_ENV" != 1 ]] && return 0

  local mod cfg rel
  for mod in "${ENV_MODULES[@]}"; do
    rel="$mod/.env"
    if [[ -f "$REPO_ROOT/$rel" ]] && remote_exists "$rel"; then
      PI_OVERWRITE_CANDIDATES+=("$rel")
    fi
  done
  for cfg in "${WEB_CONFIGS[@]}"; do
    if [[ -f "$REPO_ROOT/$cfg" ]] && remote_exists "$cfg"; then
      PI_OVERWRITE_CANDIDATES+=("$cfg")
    fi
  done
}

build_host_config_auto_transfer() {
  HOST_CONFIG_TRANSFER_AUTO=()
  local mod cfg rel
  if [[ "$TRANSFER_ENV" != 1 ]]; then
    return 0
  fi
  for mod in "${ENV_MODULES[@]}"; do
    rel="$mod/.env"
    if [[ -f "$REPO_ROOT/$rel" ]] && ! remote_exists "$rel"; then
      HOST_CONFIG_TRANSFER_AUTO+=("$rel")
    fi
  done
  for cfg in "${WEB_CONFIGS[@]}"; do
    if [[ -f "$REPO_ROOT/$cfg" ]] && ! remote_exists "$cfg"; then
      HOST_CONFIG_TRANSFER_AUTO+=("$cfg")
    fi
  done
}

if [[ "$MODE" != "1" ]]; then
  log "Checking Pi data that would be overridden (var/ and host config) ..."
  collect_var_pi_conflicts
  collect_host_config_pi_conflicts
  if [[ ${#PI_OVERWRITE_CANDIDATES[@]} -gt 0 ]]; then
    prompt_pi_overwrite_picks "${PI_OVERWRITE_CANDIDATES[@]}"
  else
    ok "no Pi host-data conflicts detected"
  fi
  build_host_config_auto_transfer
else
  if [[ "$TRANSFER_ENV" == 1 ]]; then
    build_host_config_auto_transfer
  fi
fi

# ----------------------------------------------------------------------------------------
# Deploy code (rsync working tree; excludes .env, config.json; var/ only on mode 1)
# ----------------------------------------------------------------------------------------
log "Deploying code to ${RASPBERRY_SSH}:~/$REMOTE_DIR ..."
RSYNC_EXCLUDES=(
  --exclude='.env'
  --exclude='config.json'
  --exclude='node_modules/'
  --exclude='.git/'
  --exclude='dist/'
  --exclude='.DS_Store'
  --exclude='_scratch/'
  --exclude='.claude/'
  --exclude='.cursor/'
  --exclude='.vscode/'
)
if [[ "$MODE" != "1" ]]; then
  RSYNC_EXCLUDES+=(--exclude='var/')
fi
rsync -az --delete \
  "${RSYNC_EXCLUDES[@]}" \
  -e "$RSYNC_RSH" \
  "$REPO_ROOT"/ "$RASPBERRY_SSH:$REMOTE_DIR/"
ok "code synced"

# ----------------------------------------------------------------------------------------
# Apply overwrite picks + host-config auto-transfer
# ----------------------------------------------------------------------------------------
upsert_env() {
  # upsert_env <src-env-file> <dst-staged-file>: copy src, then replace/append each override key.
  local src="$1" dst="$2"
  cp "$src" "$dst"
  local override key
  for override in "${ENV_OVERRIDES[@]}"; do
    key="${override%%=*}"
    if grep -qE "^[[:space:]]*${key}=" "$dst"; then
      # Replace existing line (use | delimiter; values contain / and :).
      sed -i.bak -E "s|^[[:space:]]*${key}=.*|${override}|" "$dst" && rm -f "$dst.bak"
    else
      printf '%s\n' "$override" >> "$dst"
    fi
  done
}

# patch_web_config <src-json> <dst-staged>: copy src, then rewrite the AMBITECTURE_HUB_URL
# string value to the Pi hub, preserving the rest of the JSON (layout, guids, etc.).
patch_web_config() {
  local src="$1" dst="$2"
  cp "$src" "$dst"
  sed -i.bak -E "s|(\"AMBITECTURE_HUB_URL\"[[:space:]]*:[[:space:]]*\")[^\"]*(\")|\1${HUB_URL_VALUE}\2|" "$dst" && rm -f "$dst.bak"
}

# stage_host_config <repo-relative-path> — write patched file into $STAGE; echo staged path.
stage_host_config() {
  local rel="$1"
  local src="$REPO_ROOT/$rel"
  local staged
  if [[ "$rel" == */.env ]]; then
    staged="$STAGE/$(echo "${rel%/.env}" | tr '/' '_').env"
    upsert_env "$src" "$staged"
  else
    staged="$STAGE/$(echo "$rel" | tr '/' '_')"
    patch_web_config "$src" "$staged"
  fi
  printf '%s' "$staged"
}

transfer_host_config() {
  local rel="$1"
  local staged
  staged="$(stage_host_config "$rel")"
  rsync -az -e "$RSYNC_RSH" "$staged" "$RASPBERRY_SSH:$REMOTE_DIR/$rel"
  ok "$rel"
}

is_host_config_rel() {
  [[ "$1" == */.env || "$1" == */config.json ]]
}

HOST_CONFIG_TO_TRANSFER=()

queue_host_config_transfer() {
  local rel="$1"
  if ! rel_in_list "$rel" ${HOST_CONFIG_TO_TRANSFER[@]+"${HOST_CONFIG_TO_TRANSFER[@]}"}; then
    HOST_CONFIG_TO_TRANSFER+=("$rel")
  fi
}

if (( ${#HOST_CONFIG_TRANSFER_AUTO[@]} > 0 )); then
  for rel in "${HOST_CONFIG_TRANSFER_AUTO[@]}"; do
    queue_host_config_transfer "$rel"
  done
fi

apply_var_overwrite_pick() {
  local rel="$1"
  local src="$REPO_ROOT/$rel"
  local remote_dir
  remote_dir="$(dirname "$rel")"
  rssh "mkdir -p \"\$HOME/$REMOTE_DIR/$remote_dir\""
  rsync -az -e "$RSYNC_RSH" "$src" "$RASPBERRY_SSH:$REMOTE_DIR/$rel"
  ok "$rel"
}

apply_pi_overwrite_pick() {
  local entry="$1"
  local rel
  rel="$(pi_overwrite_rel_path "$entry")"

  if is_host_config_rel "$rel"; then
    queue_host_config_transfer "$rel"
    return 0
  fi

  if [[ "$rel" == var/* ]]; then
    if [[ -f "$REPO_ROOT/$rel" ]]; then
      apply_var_overwrite_pick "$rel"
    elif [[ "$entry" == *"Pi-only"* ]]; then
      rssh "rm -f \"\$HOME/$REMOTE_DIR/$rel\"" || true
      ok "removed Pi-only $rel"
    fi
  fi
}

if [[ ${#PI_OVERWRITE_PICKED[@]} -gt 0 || ${#HOST_CONFIG_TO_TRANSFER[@]} -gt 0 ]]; then
  log "Applying selected overwrites ..."
fi

if (( ${#PI_OVERWRITE_PICKED[@]} > 0 )); then
  for entry in "${PI_OVERWRITE_PICKED[@]}"; do
    apply_pi_overwrite_pick "$entry"
  done
fi

if [[ ${#HOST_CONFIG_TO_TRANSFER[@]} -gt 0 ]]; then
  STAGE="$(mktemp -d)"
  trap 'rm -rf "$STAGE"' EXIT
  if (( ${#HOST_CONFIG_TO_TRANSFER[@]} > 0 )); then
    for rel in "${HOST_CONFIG_TO_TRANSFER[@]}"; do
      transfer_host_config "$rel"
    done
  fi
fi

if [[ "$MODE" != "1" && -d "$REPO_ROOT/var" ]]; then
  log "Syncing new var/ files from Mac (existing Pi paths untouched) ..."
  rsync -az --ignore-existing \
    -e "$RSYNC_RSH" \
    "$REPO_ROOT/var/" "$RASPBERRY_SSH:$REMOTE_DIR/var/" || true
  ok "var/ new-file sync done"
fi

if (( ${#PI_OVERWRITE_CANDIDATES[@]} > 0 )); then
  for entry in "${PI_OVERWRITE_CANDIDATES[@]}"; do
    if ! rel_in_list "$entry" ${PI_OVERWRITE_PICKED[@]+"${PI_OVERWRITE_PICKED[@]}"}; then
      warn "left untouched on Pi: $entry"
    fi
  done
fi

if [[ "$TRANSFER_ENV" != 1 ]]; then
  warn "host .env / config.json not transferred (envflag n)"
fi

# ----------------------------------------------------------------------------------------
# Remote provisioning (embedded). Runs on the Pi. Arg = MODE.
# ----------------------------------------------------------------------------------------
log "Running remote provisioning (mode $MODE) on the Pi ..."
ssh "${SSH_OPTS[@]}" "$RASPBERRY_SSH" \
  "MODE='$MODE' APP_DIR=\"\$HOME/$REMOTE_DIR\" NODE_MAJOR='$NODE_MAJOR' bash -s" <<'REMOTE_EOF'
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive

rlog()  { echo "  [pi] $*"; }
rwarn() { echo "  [pi] !! $*"; }
die()   { echo "  [pi] ERR $*" >&2; exit 1; }

cd "$APP_DIR" || die "app dir $APP_DIR missing"

# ---- apt deps + node + pm2 (modes 1 and 2) ----
if [[ "$MODE" == "1" || "$MODE" == "2" ]]; then
  if [[ "$MODE" == "2" ]]; then
    rlog "apt-get update && upgrade"
    sudo apt-get update -y
    sudo apt-get upgrade -y
  else
    rlog "apt-get update"
    sudo apt-get update -y
  fi

  rlog "installing system packages"
  sudo apt-get install -y \
    curl ca-certificates git rsync \
    build-essential python3 pkg-config \
    libasound2-dev libudev-dev \
    sox alsa-utils \
    bluetooth bluez libcap2-bin rfkill || die "apt package install failed"

  # Node.js
  NODE_OK=0
  if command -v node >/dev/null 2>&1; then
    CUR="$(node -v | sed 's/v//' | cut -d. -f1)"
    [[ "$CUR" -ge 20 ]] && NODE_OK=1
  fi
  if [[ "$NODE_OK" == "0" ]]; then
    rlog "installing Node.js ${NODE_MAJOR}.x via NodeSource"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash - || die "nodesource setup failed"
    sudo apt-get install -y nodejs || die "nodejs install failed"
  fi
  rlog "node $(node -v)  npm $(npm -v)"

  # PM2
  if ! command -v pm2 >/dev/null 2>&1; then
    rlog "installing pm2 globally"
    sudo npm install -g pm2 || die "pm2 install failed"
  fi
  rlog "configuring pm2 boot persistence"
  sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null 2>&1 || rwarn "pm2 startup config skipped"

  # Bluetooth runtime for neewer BLE: enable service, clear RF-kill, bring the adapter up,
  # and grant node raw HCI access so noble can scan without root.
  rlog "enabling bluetooth for BLE (service + rfkill unblock + setcap on node)"
  sudo systemctl enable --now bluetooth >/dev/null 2>&1 || rwarn "bluetooth service not enabled"
  sudo rfkill unblock bluetooth 2>/dev/null || true
  sudo hciconfig hci0 up 2>/dev/null || true
  NODE_BIN="$(readlink -f "$(command -v node)")"
  sudo setcap cap_net_raw+eip "$NODE_BIN" 2>/dev/null || rwarn "setcap on node failed (neewer BLE may need root)"
fi

# Sanity: node/npm/pm2 must exist for any mode
command -v node >/dev/null 2>&1 || die "node not installed (run mode 1 or 2 first)"
command -v pm2  >/dev/null 2>&1 || die "pm2 not installed (run mode 1 or 2 first)"

# ---- DMX device autodetect (all modes) ----
DMX_ENV="$APP_DIR/modules/renderers/dmx-ts/.env"
if [[ -f "$DMX_ENV" ]]; then
  DMX_DEV=""
  for d in /dev/serial/by-id/usb-FTDI* /dev/serial/by-id/usb-*FTDI*; do
    [[ -e "$d" ]] && { DMX_DEV="$d"; break; }
  done
  [[ -z "$DMX_DEV" ]] && for d in /dev/ttyUSB*; do [[ -e "$d" ]] && { DMX_DEV="$d"; break; }; done
  if [[ -n "$DMX_DEV" ]]; then
    if grep -qE '^[[:space:]]*DMX_DEVICE=' "$DMX_ENV"; then
      sed -i -E "s|^[[:space:]]*DMX_DEVICE=.*|DMX_DEVICE='${DMX_DEV}'|" "$DMX_ENV"
    else
      printf "DMX_DEVICE='%s'\n" "$DMX_DEV" >> "$DMX_ENV"
    fi
    rlog "DMX device set to $DMX_DEV"
  else
    rwarn "no USB-DMX (FTDI) device found — dmx renderer will have no hardware output"
  fi
else
  rwarn "dmx-ts/.env not present — skipping DMX autodetect"
fi

# ---- USB microphone → default ALSA capture device (for music-analyser) (all modes) ----
# music-analyser records via node-record-lpcm16 -> sox `rec` on the ALSA *default* capture
# device. A fresh Pi's default often resolves to the wrong card (e.g. a MIDI keyboard),
# making sox exit with error 2. Point the default capture at the first real capture card
# (the USB mic). arecord -l only lists capture-capable cards, so [0] is the mic.
if command -v arecord >/dev/null 2>&1; then
  CAP_CARD="$(arecord -l 2>/dev/null | sed -n 's/^card [0-9][0-9]*: \([^ ]*\) \[.*/\1/p' | head -1)"
  if [[ -n "$CAP_CARD" ]]; then
    cat > "$HOME/.asoundrc" <<EOF
pcm.!default {
    type asym
    playback.pcm "plughw:Headphones"
    capture.pcm "plughw:$CAP_CARD"
}
ctl.!default {
    type hw
    card $CAP_CARD
}
EOF
    rlog "ALSA default capture set to USB card '$CAP_CARD' (~/.asoundrc)"
  else
    rwarn "no ALSA capture device found — music-analyser will have no mic input"
  fi
else
  rwarn "arecord not present — skipping mic/ALSA setup"
fi

# ---- npm install per module (all modes), resilient ----
MODULES=(
  "modules/hub"
  "modules/renderers/dmx-ts"
  "modules/controllers/midi-v1"
  "modules/controllers/music-analyser"
  "modules/deliver"
  "modules/renderers/neewer"
)
FAILED=()
for mod in "${MODULES[@]}"; do
  if [[ ! -f "$APP_DIR/$mod/package.json" ]]; then
    rwarn "$mod has no package.json — skipping"
    continue
  fi
  rlog "npm install: $mod"
  if ( cd "$APP_DIR/$mod" && npm install --no-fund --no-audit ); then
    rlog "  -> ok ($mod)"
  else
    rwarn "  -> FAILED ($mod)"
    FAILED+=("$mod")
  fi
done

# ---- start / restart PM2 (all modes) ----
rlog "starting PM2 stack"
cd "$APP_DIR"
HUB_PROJECT=""
if [[ -f "$APP_DIR/var/hub/activeProject.json" ]]; then
  HUB_PROJECT="$(sed -n 's/.*"spec"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$APP_DIR/var/hub/activeProject.json" | head -1)"
fi
export HUB_PROJECT
pm2 delete ecosystem.config.js >/dev/null 2>&1 || true
pm2 start ecosystem.config.js --update-env || die "pm2 start failed"
pm2 save >/dev/null 2>&1 || true

echo
rlog "===== PM2 status ====="
pm2 list
echo
if [[ "${#FAILED[@]}" -gt 0 ]]; then
  rwarn "npm install FAILED for: ${FAILED[*]}"
else
  rlog "all module npm installs succeeded"
fi
REMOTE_EOF

REMOTE_RC=$?
echo
if [[ "$REMOTE_RC" -ne 0 ]]; then
  err "remote provisioning exited with code $REMOTE_RC"
fi

# ----------------------------------------------------------------------------------------
# Verification (from the Mac)
# ----------------------------------------------------------------------------------------
log "Verifying services (allowing time for ts-node to compile on the Pi) ..."

# Retry a check until it succeeds or attempts run out.
wait_for() { local attempts="$1" delay="$2"; shift 2; local i
  for ((i=1; i<=attempts; i++)); do "$@" && return 0; sleep "$delay"; done; return 1; }

# The hub is a WebSocket-upgrade server: it accepts TCP but never answers a plain GET.
# A successful upgrade returns HTTP 101 (curl then times out holding the socket — fine).
hub_ws_up() { local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 3 \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
    "http://${RASPBERRY_HOST}:2612/" 2>/dev/null || true)"
  [[ "$code" == "101" ]]; }

deliver_up() { local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 6 "http://${RASPBERRY_HOST}:8080/" 2>/dev/null || true)"
  [[ "$code" =~ ^(200|301|302|304|403|404)$ ]]; }

if wait_for 25 2 hub_ws_up; then
  ok "hub WebSocket up (HTTP 101) — ws://${RASPBERRY_HOST}:2612/"
else
  warn "hub did not answer WS upgrade in time — check: ssh ${RASPBERRY_SSH} pm2 logs hub"
fi
if wait_for 10 2 deliver_up; then
  ok "deliver static host up — http://${RASPBERRY_HOST}:8080/"
else
  warn "deliver not responding — check: ssh ${RASPBERRY_SSH} pm2 logs deliver"
fi

echo
log "PM2 process list on the Pi:"
rssh "pm2 list" || true

echo
ok "Done (mode $MODE). Open the hub at: http://${RASPBERRY_HOST}:2612/"
