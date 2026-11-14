"""Upload export/v1 to Supabase Storage (public bucket 'trendex') and deploy the Edge Function.

Needs backend/.env.supabase (never commit it):
  SUPABASE_URL=https://<ref>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=...
  SUPABASE_PROJECT_REF=<ref>
and a one-time `npx supabase login` for the function deploy.

python scripts/50_deploy_supabase.py [--skip-upload] [--skip-function] [--only cards|static]
"""
from __future__ import annotations

import argparse
import mimetypes
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
EXPORT = ROOT / "export" / "v1"
BUCKET = "trendex"
PREFIX = "v1"


def env() -> dict:
    p = ROOT / ".env.supabase"
    vals = dict(os.environ)
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip().strip('"').strip("'")
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PROJECT_REF") if not vals.get(k)]
    if missing:
        sys.exit(f"missing {missing} in {p}")
    return vals


def ensure_bucket(cl: httpx.Client, url: str):
    r = cl.get(f"{url}/storage/v1/bucket/{BUCKET}")
    if r.status_code == 200:
        if not r.json().get("public"):
            cl.put(f"{url}/storage/v1/bucket/{BUCKET}", json={"public": True}).raise_for_status()
        return
    r = cl.post(f"{url}/storage/v1/bucket", json={"id": BUCKET, "name": BUCKET, "public": True,
                                                    "file_size_limit": 52428800})
    if r.status_code not in (200, 201) and "already exists" not in r.text:
        raise RuntimeError(f"bucket create failed: {r.status_code} {r.text}")


def upload(only: str | None):
    e = env()
    url = e["SUPABASE_URL"].rstrip("/")
    key = e["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"Authorization": f"Bearer {key}", "apikey": key}
    files = [p for p in EXPORT.rglob("*") if p.is_file()]
    if only == "cards":
        files = [p for p in files if "cards" in p.parts]
    elif only == "static":
        files = [p for p in files if "cards" not in p.parts]
    t0 = time.time()
    with httpx.Client(headers=headers, timeout=120) as cl:
        ensure_bucket(cl, url)

        def put(p: Path):
            rel = p.relative_to(EXPORT).as_posix()
            ctype = {"geojson": "application/geo+json", "bin": "application/octet-stream", "csv": "text/csv; charset=utf-8",
                     "json": "application/json"}.get(p.suffix.lstrip("."), mimetypes.guess_type(p.name)[0] or "application/octet-stream")
            for attempt in range(4):
                r = cl.post(f"{url}/storage/v1/object/{BUCKET}/{PREFIX}/{rel}", content=p.read_bytes(),
                            headers={"Content-Type": ctype, "x-upsert": "true", "Cache-Control": "max-age=300"})
                if r.status_code in (200, 201):
                    return rel
                time.sleep(1 + attempt)
            raise RuntimeError(f"{rel}: {r.status_code} {r.text[:200]}")

        done = 0
        with ThreadPoolExecutor(16) as ex:
            for f in as_completed([ex.submit(put, p) for p in files]):
                f.result()
                done += 1
                if done % 200 == 0:
                    print(f"  {done}/{len(files)}")
    print(f"uploaded {len(files)} files in {time.time() - t0:.0f}s -> {url}/storage/v1/object/public/{BUCKET}/{PREFIX}/")


def deploy_function():
    e = env()
    cmd = ["npx", "--yes", "supabase", "functions", "deploy", "trendex-api", "--no-verify-jwt",
           "--project-ref", e["SUPABASE_PROJECT_REF"], "--use-api"]
    print(" ".join(cmd))
    subprocess.run(cmd, cwd=ROOT.parent, check=True)
    print(f"API: {e['SUPABASE_URL'].rstrip('/')}/functions/v1/trendex-api/api/health")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-upload", action="store_true")
    ap.add_argument("--skip-function", action="store_true")
    ap.add_argument("--only", choices=["cards", "static"])
    a = ap.parse_args()
    if not a.skip_upload:
        upload(a.only)
    if not a.skip_function:
        deploy_function()
