#!/usr/bin/env python3
"""Read-only checks of what is released and running (the regression's `live` stage): GET the public page, the
published data files and the daily snapshot. Never uploads or deletes. Exit 77 (skip) when the hosts can't be reached
from this session; otherwise prints one line per check and exits 1 if any fails."""
import json
import sys
import urllib.error
import urllib.request

WORKER = "https://api.open-pitmaster.workers.dev"
DATA = "https://raw.githubusercontent.com/Legal-Copy7045/open-pitmaster/main/data/"


def get(url: str) -> tuple[int, dict, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": "open-pitmaster-regression"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def main() -> int:
    try:
        checks = {}
        code, headers, body = get(WORKER + "/")
        checks["page answers"] = code == 200 and b"How long smoker cooks really take" in body
        checks["page sets no cookie"] = not any(k.lower() == "set-cookie" for k in headers)
        code, _, body = get(DATA + "aggregates.json")
        agg = json.loads(body) if code == 200 else {}
        checks["aggregates.json"] = agg.get("v") == 1 and agg.get("min_n", 0) >= 5 and isinstance(agg.get("groups"), list)
        checks["no group under min_n"] = all(g.get("n", 0) >= agg.get("min_n", 5) for g in agg.get("groups", []))
        code, _, body = get(DATA + "cooks.jsonl")
        lines = [json.loads(x) for x in body.decode().splitlines() if x.strip()] if code == 200 else None
        checks["cooks.jsonl"] = lines is not None and len(lines) == agg.get("cooks")
        code, _, _ = get(DATA + "cooks.csv")
        checks["cooks.csv"] = code == 200
        code, _, body = get(WORKER + "/v1/released")
        rel = json.loads(body) if code == 200 else {}
        checks["daily snapshot"] = isinstance(rel.get("records"), list) and isinstance(rel.get("deleted"), list)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        print(f"live: hosts not reachable from here ({e}); skipped")
        return 77
    for k, ok in checks.items():
        print(("pass " if ok else "FAIL ") + k)
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
