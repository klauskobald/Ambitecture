#!/usr/bin/env bash

cd "$(dirname "$0")"
cd ..
cd modules/hub
if [ -n "$HUB_PROJECT" ]; then
  npm run start -- "$HUB_PROJECT"
else
  npm run start
fi