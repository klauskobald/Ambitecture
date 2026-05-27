#!/usr/bin/env bash

cd "$(dirname "$0")"
cd ..
cd modules/renderers/neewer
npm run start "$@"