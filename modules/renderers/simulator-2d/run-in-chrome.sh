#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_HTML="${SCRIPT_DIR}/index.html"
TARGET_URL="file://${TARGET_HTML}"
TMP_PROFILE_DIR="$(mktemp -d /tmp/ambitecture-chrome-no-cors.XXXXXX)"

open -na "Google Chrome" --args \
  --disable-web-security \
  --allow-file-access-from-files \
  --user-data-dir="${TMP_PROFILE_DIR}" \
  --profile-directory=Default \
  --no-first-run \
  --no-default-browser-check \
  --new-window \
  --app="${TARGET_URL}"
