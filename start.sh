#!/usr/bin/env bash

cd "$(dirname "$0")"


export HUB_PROJECT="${1:-}"

if [ -n "$HUB_PROJECT" ]; then
  echo "Starting stack with hub project: $HUB_PROJECT"
else
  echo "Starting stack (hub uses persisted active project; fails if none)"
fi

pm2 start ecosystem.config.js --update-env
# pm2 logs 
