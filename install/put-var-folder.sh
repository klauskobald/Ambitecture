#!/usr/bin/env bash
#
# put-var-folder.sh — upload local var/ to the Pi.
# Only replaces Pi files when the local copy is newer (--update). Reports paths skipped.
#
# Usage: ./install/put-var-folder.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=install/config.sh
source "$SCRIPT_DIR/config.sh"
# shellcheck source=install/lib.sh
source "$SCRIPT_DIR/lib.sh"

install_require_tools
install_check_ssh

if [[ ! -d "$LOCAL_VAR_DIR" ]]; then
  err "local var/ not found at $LOCAL_VAR_DIR"
  exit 1
fi

VAR_NOT_UPDATED=()
VAR_WOULD_UPLOAD=0
local rel local_m remote_m

while IFS= read -r rel; do
  [[ -z "$rel" ]] && continue
  remote_m="$(remote_mtime "$rel")"
  if [[ -z "$remote_m" ]]; then
    VAR_WOULD_UPLOAD=$((VAR_WOULD_UPLOAD + 1))
    continue
  fi
  local_m="$(local_mtime "$REPO_ROOT/$rel")"
  if [[ "$local_m" -le "$remote_m" ]]; then
    VAR_NOT_UPDATED+=("$rel")
  else
    VAR_WOULD_UPLOAD=$((VAR_WOULD_UPLOAD + 1))
  fi
done < <(find "$LOCAL_VAR_DIR" -type f ! -name '.DS_Store' | sed "s|^$REPO_ROOT/||")

rssh "mkdir -p \"\$HOME/$REMOTE_DIR/var\""

log "Uploading var/ from ${LOCAL_VAR_DIR}/ -> ${RASPBERRY_SSH}:~/$REMOTE_DIR/var/ (local newer only)"
rsync -az --update \
  -e "$RSYNC_RSH" \
  "${LOCAL_VAR_DIR}/" "${REMOTE_VAR_RSPEC}"
ok "var/ upload finished (${VAR_WOULD_UPLOAD} file(s) newer or new on Pi)"

if [[ ${#VAR_NOT_UPDATED[@]} -gt 0 ]]; then
  echo
  warn "not updated (Pi same age or newer than local):"
  local path
  for path in "${VAR_NOT_UPDATED[@]}"; do
    echo "    $path"
  done
else
  ok "all overlapping files updated or were new on the Pi"
fi
