#!/usr/bin/env python3
"""Nightly: add newly released shared cooks to the open dataset and rebuild the averages.

    python3 build/build.py data [--worker URL] [--released FILE]

New records come from the Worker's /v1/released (or a file, for tests); each is checked against the published
format again (format/README.md) and anything else dropped.
Deleted cooks are removed. Writes:
  cooks.jsonl     every shared cook, one JSON record per line, sorted by its random id (so order says nothing)
  cooks.csv       the same as a table
  aggregates.json the averages the Smoker integration downloads (groups with fewer than MIN_N cooks are left out)
  README.md, LICENSE (CC0)
Standard library only.
"""

from __future__ import annotations

import csv
import json
import re
import statistics
import sys
import time
import urllib.request
from pathlib import Path

CUTS = ["Pork shoulder", "Brisket", "Ribs", "Beef roast", "Poultry", "Sausage", "Fish", "Auto"]
SEASONS = ["winter", "spring", "summer", "autumn"]
TAGS = ["juicy", "tender", "dry", "tough", "undercooked", "just right", "overcooked", "great bark", "soft bark", "good smoke", "too smoky", "too little smoke", "fat rendered", "fat not rendered"]
FIELDS = ["v", "id", "grill", "release", "season", "cut", "weight_lb", "wrapped", "pit_f", "target_f", "stall_h",
          "total_h", "outside_f", "rating", "tags"]
MIN_N = 3  # a group needs this many cooks before its averages are published
# At most this many new cooks per cut, weight and pit band in one nightly batch: real sharing is a few cooks a day,
# so a burst of look-alike uploads (someone trying to steer an average) is mostly left out. The rest are dropped,
# not queued.
MAX_NEW_PER_GROUP = 5


def _num(v, lo, hi, step, null=True):
    if v is None:
        return null
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
        return False
    return abs(round(v / step) * step - v) < 1e-6


def validate(r) -> str | None:
    """Same rules as the Worker's validate() (sharing/worker/src/index.js); a test keeps them in step."""
    if not isinstance(r, dict):
        return "record must be an object"
    for k in r:
        if k not in FIELDS:
            return f"unexpected field {k}"
    checks = {
        "v": r.get("v") == 1,
        "id": isinstance(r.get("id"), str) and re.fullmatch(r"[0-9a-f]{32}", r["id"]) is not None,
        "grill": r.get("grill") == "gravity980",
        "release": isinstance(r.get("release"), str) and re.fullmatch(r"\d{1,3}\.\d{1,3}\.\d{1,4}", r["release"]) is not None,
        "season": r.get("season") in SEASONS,
        "cut": r.get("cut") in CUTS,
        "weight_lb": _num(r.get("weight_lb"), 0.5, 25, 0.5),
        "wrapped": r.get("wrapped") is None or isinstance(r.get("wrapped"), bool),
        "pit_f": _num(r.get("pit_f"), 200, 700, 5),
        "target_f": _num(r.get("target_f"), 100, 250, 1),
        "stall_h": _num(r.get("stall_h"), 0, 24, 0.1),
        "total_h": _num(r.get("total_h"), 0.5, 36, 0.1, null=False),
        "outside_f": _num(r.get("outside_f"), -10, 110, 5),
        "tags": isinstance(r.get("tags"), list) and all(t in TAGS for t in r["tags"]) and len(set(r["tags"])) == len(r["tags"]),
        "rating": r.get("rating") is None or (isinstance(r.get("rating"), int) and not isinstance(r.get("rating"), bool) and 1 <= r["rating"] <= 5),
    }
    for k in FIELDS:
        if k not in r:
            return f"missing field {k}"
        if not checks[k]:
            return f"bad value for {k}"
    if r["stall_h"] is not None and r["stall_h"] > r["total_h"]:
        return "stall longer than the cook"
    return None


def band(v, edges, unit):
    """'8-10 lb' style label for a value, edges ascending; None stays None."""
    if v is None:
        return None
    lo = None
    for e in edges:
        if v < e:
            return f"under {e} {unit}" if lo is None else f"{lo}-{e} {unit}"
        lo = e
    return f"{lo}+ {unit}"


WEIGHT = [4, 6, 8, 10, 12, 15]
PIT = [225, 255, 280, 305]
OUTSIDE = [30, 50, 70]


def _q(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    f = int(k)
    c = min(f + 1, len(xs) - 1)
    return round(xs[f] + (xs[c] - xs[f]) * (k - f), 1)


def aggregate(records: list[dict]) -> dict:
    groups: dict[tuple, list[dict]] = {}
    for r in records:
        if r["cut"] == "Auto":
            continue
        w = band(r["weight_lb"], WEIGHT, "lb") or "any weight"
        p = (band(r["pit_f"], PIT, "°F") or "any pit").replace("under 225 °F", "under 225°F").replace(" °F", "°F")
        o = (band(r["outside_f"], OUTSIDE, "°F") or "any weather").replace(" °F", "°F")
        for key in ((r["cut"], w, p, o), (r["cut"], w, p, "any weather"), (r["cut"], "any weight", "any pit", "any weather")):
            groups.setdefault(key, []).append(r)
    out = []
    for (cut, w, p, o), rs in groups.items():
        if len(rs) < MIN_N:
            continue
        totals = [r["total_h"] for r in rs]
        stalls = [r["stall_h"] for r in rs if r["stall_h"] is not None]
        wraps = [r["wrapped"] for r in rs if r["wrapped"] is not None]
        ratings = [r["rating"] for r in rs if r["rating"] is not None]
        told = [r for r in rs if r["tags"]]  # cooks with "How was it?" feedback
        tag_pct = {t: round(100 * sum(t in r["tags"] for r in told) / len(told)) for t in TAGS} if told else {}
        tag_pct = dict(sorted(((t, p) for t, p in tag_pct.items() if p), key=lambda x: -x[1]))
        out.append({"cut": cut, "weight": w, "pit": p, "outside": o, "n": len(rs),
                    "total_h": _q(totals, 0.5), "total_p25": _q(totals, 0.25), "total_p75": _q(totals, 0.75),
                    "stall_h": _q(stalls, 0.5) if stalls else None,
                    "wrapped_pct": round(100 * sum(wraps) / len(wraps)) if wraps else None,
                    "rating": round(statistics.mean(ratings), 1) if ratings else None,
                    "tags": tag_pct, "with_feedback": len(told)})
    # Most specific first, then most cooks.
    spec = lambda g: sum(x.startswith("any") for x in (g["weight"], g["pit"], g["outside"]))  # noqa: E731
    out.sort(key=lambda g: (g["cut"], spec(g), -g["n"]))
    return {"v": 1, "cooks": len(records), "min_n": MIN_N, "updated": time.strftime("%Y-%m-%d", time.gmtime()),
            "groups": out}


README = """# Open Pitmaster data

Shared smoker cooks: {n} so far. Every record is anonymous and was shared by choice (see ../PRIVACY.md).

- `cooks.jsonl` / `cooks.csv`: every shared cook (format: ../format/README.md).
- `aggregates.json`: typical times and how cooks turned out, by cut, weight, pit and outside temperature (groups
  with at least {min_n} cooks).

Rebuilt nightly by ../.github/workflows/nightly.yml. Licence: CC0 1.0 (public domain); see LICENSE.
"""

CC0 = """CC0 1.0 Universal (public domain dedication). To the extent possible under law, the contributors have waived all
copyright and related or neighboring rights to this data. https://creativecommons.org/publicdomain/zero/1.0/
"""


def main(argv: list[str]) -> int:
    data = Path(argv[1])
    worker = argv[argv.index("--worker") + 1] if "--worker" in argv else None
    released_file = argv[argv.index("--released") + 1] if "--released" in argv else None
    if released_file:
        incoming = json.loads(Path(released_file).read_text())
    else:
        req = urllib.request.Request(worker.rstrip("/") + "/v1/released",
                                     headers={"User-Agent": "open-pitmaster-nightly-build"})
        with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310 - fixed https URL
            incoming = json.load(r)
    path = data / "cooks.jsonl"
    have = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if line.strip():
                r = json.loads(line)
                have[r["id"]] = r
    added = dropped = capped = 0
    per_group: dict[tuple, int] = {}
    for r in incoming.get("records", []):
        if validate(r) is not None:
            dropped += 1
            continue
        if r["id"] in have:
            continue
        g = (r["cut"], band(r["weight_lb"], WEIGHT, "lb"), band(r["pit_f"], PIT, "F"))
        if per_group.get(g, 0) >= MAX_NEW_PER_GROUP:
            capped += 1
            continue
        per_group[g] = per_group.get(g, 0) + 1
        have[r["id"]] = {k: r[k] for k in FIELDS}
        added += 1
    removed = 0
    for i in incoming.get("deleted", []):
        if have.pop(i, None) is not None:
            removed += 1
    records = [have[k] for k in sorted(have)]
    data.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, separators=(",", ":"), ensure_ascii=False) + "\n" for r in records))
    with open(data / "cooks.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows({**r, "tags": "|".join(r["tags"])} for r in records)
    (data / "aggregates.json").write_text(json.dumps(aggregate(records), indent=1, ensure_ascii=False) + "\n")
    (data / "README.md").write_text(README.format(n=len(records), min_n=MIN_N))
    (data / "LICENSE").write_text(CC0)
    print(f"{len(records)} cooks: {added} added, {removed} removed (deleted by their owners), {dropped} refused, "
          f"{capped} over the per-group limit")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
