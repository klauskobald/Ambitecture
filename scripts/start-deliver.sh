#!/usr/bin/env bash

cd "$(dirname "$0")"
cd ..
cd modules/deliver
npm run start "$@"