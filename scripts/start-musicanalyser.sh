#!/usr/bin/env bash

cd "$(dirname "$0")"
cd ..
cd modules/controllers/music-analyser
npm run start "$@"