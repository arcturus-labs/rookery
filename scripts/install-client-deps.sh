#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

( cd clients/web-client && npm install )
