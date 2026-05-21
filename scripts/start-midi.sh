#!/usr/bin/env bash

cd "$(dirname "$0")"
cd ..
cd modules/controllers/midi-v1
npm run start "$@"