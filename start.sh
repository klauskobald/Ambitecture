#!/usr/bin/env bash

cd "$(dirname "$0")"


export HUB_PROJECT="$1"

if [ -z "$HUB_PROJECT" ]; then
  echo "Usage: $0 <hub-project>"
  exit 1
fi

pm2 start ecosystem.config.js --update-env
pm2 logs 
