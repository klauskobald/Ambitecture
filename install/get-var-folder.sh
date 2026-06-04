#!/usr/bin/env bash
#
# get-var-folder.sh — download the Pi's var/ tree into the local repo (mirror).
# Overwrites local files; removes local paths that are not on the Pi (--delete).
#
# Usage: ./install/get-var-folder.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=install/config.sh
source "$SCRIPT_DIR/config.sh"
# shellcheck source=install/lib.sh
source "$SCRIPT_DIR/lib.sh"

install_require_tools
install_check_ssh

if ! rssh "[[ -d \"\$HOME/$REMOTE_DIR/var\" ]]"; then
  err "remote var/ not found at ~/$REMOTE_DIR/var on ${RASPBERRY_SSH}"
  exit 1
fi

mkdir -p "$LOCAL_VAR_DIR"

log "Downloading var/ from ${RASPBERRY_SSH}:~/$REMOTE_DIR/var/ -> ${LOCAL_VAR_DIR}/"
rsync -az --delete \
  -e "$RSYNC_RSH" \
  "${RASPBERRY_SSH}:${REMOTE_DIR}/var/" "${LOCAL_VAR_DIR}/"
ok "var/ mirrored from Pi"
