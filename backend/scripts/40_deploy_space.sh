#!/usr/bin/env bash
# Deploy backend (code + artifacts) to the HF Docker Space, then smoke-test it.
set -euo pipefail
SPACE="${SPACE:-TrendeX90/trendex-api}"
cd "$(dirname "$0")/.."
hf repos create "$SPACE" --type space --space-sdk docker --public --exist-ok >/dev/null
hf upload "$SPACE" . . --repo-type space \
  --exclude ".venv/*" "data/cube_mock/*" "data/cube_real/*" "data/osm/*" "tests/*" "**/__pycache__/*" "*.pyc" ".pytest_cache/*" \
  --commit-message "deploy $(date -u +%FT%TZ) mode=$(python3 -c "import json;print(json.load(open('artifacts/core.json'))['data_mode'])")"
URL="https://$(echo "$SPACE" | tr '[:upper:]/' '[:lower:]-').hf.space"
echo "Space: https://huggingface.co/spaces/$SPACE  API: $URL"
