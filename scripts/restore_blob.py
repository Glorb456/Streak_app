#!/usr/bin/env python3
"""Restore an encrypted buddy snapshot into a (fresh) Streak stack.

The blob is what the host's blob job pushed to the buddy: gzip(JSON snapshot)
sealed with AES-256-GCM under BUDDY_BLOB_KEY. The buddy never had the key;
you do. Recovery is two steps:

  1. fetch the blob from the buddy (or have them send the file):
       curl -H "X-Sync-Token: <their SYNC_TOKEN>" \
            https://buddy.tailXXXX.ts.net/api/sync/peer/blob/latest -o latest.blob
  2. bring up a fresh stack (docker compose up -d --build) somewhere, then:
       python3 scripts/restore_blob.py latest.blob "<BUDDY_BLOB_KEY>" \
            http://localhost:3000 "<SYNC_TOKEN of the fresh stack>"

The tasks database is applied through /api/sync/peer/import (so it lands with
its original uids and timestamps), and every notes file is written back
byte-for-byte with its original mtime.

Needs: pip install cryptography httpx
"""
import base64
import gzip
import hashlib
import json
import sys

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def main():
    if len(sys.argv) != 5:
        print(__doc__)
        sys.exit(2)
    blob_path, key, base, token = sys.argv[1:5]
    base = base.rstrip("/")

    raw = open(blob_path, "rb").read()
    cipher = AESGCM(hashlib.sha256(key.encode()).digest())
    snap = json.loads(gzip.decompress(cipher.decrypt(raw[:12], raw[12:], b"streak.blob.v1")))
    assert snap.get("format") == "streak.snapshot", "not a streak snapshot"

    headers = {"X-Sync-Token": token}
    with httpx.Client(headers=headers, timeout=120) as http:
        tasks = snap["tasks"]
        tasks["since"] = None
        r = http.post(f"{base}/api/sync/peer/import", json=tasks)
        r.raise_for_status()
        print(f"tasks db: {r.json()}")

        for f in snap.get("notes", []):
            r = http.put(
                f"{base}/api/notes/sync/file",
                params={"path": f["path"], "mtime": str(f["mtime"])},
                content=base64.b64decode(f["data"]),
                headers={"Content-Type": "application/octet-stream"},
            )
            r.raise_for_status()
        print(f"notes: {len(snap.get('notes', []))} files restored")
    print("done — open the app and check your data.")


if __name__ == "__main__":
    main()
