#!/usr/bin/env bash

cd "$(dirname "$0")"
cd ..
cd modules/hub
npm run start "$HUB_PROJECT"