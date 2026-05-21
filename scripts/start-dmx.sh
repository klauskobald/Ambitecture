#!/usr/bin/env bash

cd "$(dirname "$0")"
cd ..
cd modules/renderers/dmx-ts
npm run start "$@"