"""The nightly build (build/build.py): same format rules as the Worker, averages only for groups with enough cooks,
deletions honoured. Run: python3 -m pytest build (or python3 -m unittest is not needed: plain pytest functions)."""

import importlib.util
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build", ROOT / "build/build.py")
cb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cb)
EX = json.loads((ROOT / "format/examples.json").read_text())


def test_same_rules_as_the_worker():
    for r in EX["valid"]:
        assert cb.validate(r) is None
    for change, why in EX["invalid"]:
        assert why in (cb.validate({**EX["valid"][0], **change}) or "")


def _rec(i, **kw):
    r = dict(EX["valid"][0], id=f"{i:032x}", total_h=round(10 + i * 0.3, 1))
    r.update(kw)
    return r


def test_build(tmp_path):
    data = tmp_path / "data"
    incoming = {"records": [_rec(i) for i in range(5)] + [_rec(9, cut="Ribs", total_h=5.5),
                                                         {**_rec(10), "note": "free text"}], "deleted": []}
    random.shuffle(incoming["records"])
    src = tmp_path / "released.json"
    src.write_text(json.dumps(incoming))
    assert cb.main(["x", str(data), "--released", str(src)]) == 0
    lines = (data / "cooks.jsonl").read_text().splitlines()
    assert len(lines) == 6  # the record with a note was refused
    assert [json.loads(l)["id"] for l in lines] == sorted(json.loads(l)["id"] for l in lines)
    agg = json.loads((data / "aggregates.json").read_text())
    assert agg["cooks"] == 6
    # Pork shoulder (5 cooks) is published; Ribs (1 cook) isn't.
    assert {g["cut"] for g in agg["groups"]} == {"Pork shoulder"}
    top = agg["groups"][0]
    assert top["weight"] == "8-10 lb" and top["pit"] == "225-255°F" and top["outside"] == "30-50°F" and top["n"] == 5
    assert top["total_h"] == 10.6 and top["wrapped_pct"] == 100
    assert top["tags"] == {"juicy": 100, "tender": 100, "great bark": 100} and top["with_feedback"] == 5
    assert "CC0" in (data / "LICENSE").read_text()
    # Running again adds nothing new; a deletion removes that cook.
    src.write_text(json.dumps({"records": incoming["records"], "deleted": [f"{0:032x}"]}))
    cb.main(["x", str(data), "--released", str(src)])
    assert len((data / "cooks.jsonl").read_text().splitlines()) == 5
