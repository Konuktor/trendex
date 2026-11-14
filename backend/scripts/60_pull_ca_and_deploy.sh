#!/usr/bin/env bash
# Pull the real Central Asia frontend export from HF, swap out the sample, enable the switch, build, deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REV="${REV:-main}"
DST="$ROOT/frontend/public/data/ca/v1"
TMP="$(mktemp -d)"
"$ROOT/backend/.venv/bin/python" - "$TMP" "$REV" <<'PY'
import sys
from huggingface_hub import snapshot_download
p = snapshot_download("TrendeX90/ca-cube", repo_type="dataset", revision=sys.argv[2],
                      allow_patterns=["formula/export/ca/v1/fe/*"], local_dir=sys.argv[1])
print(p)
PY
SRC="$TMP/formula/export/ca/v1/fe"
for f in cells.json meta.json boundary.geojson regions.geojson; do test -s "$SRC/$f" || { echo "missing $f in HF export"; exit 1; }; done
python3 -c "import json,sys;m=json.load(open('$SRC/meta.json'));assert m['dataStatus']=='production',m['dataStatus'];print('CA meta ok:',m['stats'])"
cp "$SRC"/{cells.json,meta.json,boundary.geojson,regions.geojson} "$DST/"
sed -i 's/^VITE_DATASETS=.*/VITE_DATASETS=naryn,ca/' "$ROOT/frontend/.env.production"
cd "$ROOT/frontend" && npm run build && npx --yes wrangler@3 pages deploy dist --project-name trendex --branch main --commit-dirty=true
