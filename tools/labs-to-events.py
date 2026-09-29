#!/usr/bin/env python3
"""Turn Luke's compendium lab history into events for his log.

Everything here is already in Rikki's own records — `luke-labs-data.js` on the
compendium holds every recorded laboratory and body-metric value. The app has
been carrying a handful of them hardcoded from a dated snapshot instead, which
means it could not see a trend and could not notice when a figure went stale.

Weight is the sharpest example: the app treated 79.1 lb as current when the
measurement is from March 2026.

Reads the published file over the network, read-only. Writes newline-delimited
events for the app's "bring in a log from a file" control.

    python3 tools/labs-to-events.py > luke.labs.export.ndjson
"""

import argparse, hashlib, json, re, sys, urllib.request
from datetime import datetime, timezone

SOURCE = "https://rikkikkir.github.io/LukeVonDogRecords/luke-labs-data.js"

# The markers that change what the app says about him. Others are carried too,
# but these are the ones the body view and the vet document reason about.
KG_PER_LB = 0.45359237


def fetch(url: str) -> str:
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def parse(js: str):
    """The file is JavaScript, not JSON. Each series is a block with an id and a
    run of p("YYYY-MM-DD", value) points, so read those directly rather than
    pretending it can be json.loads()ed."""
    out = []
    for block in re.split(r"\n\s*\{\s*\n", js):
        m_id = re.search(r'id:\s*"([^"]+)"', block)
        if not m_id:
            continue
        m_name = re.search(r'name:\s*"([^"]+)"', block)
        m_unit = re.search(r'unit:\s*"([^"]*)"', block)
        m_lo = re.search(r"refLow:\s*([\d.]+)", block)
        m_hi = re.search(r"refHigh:\s*([\d.]+)", block)
        points = re.findall(r'p\(\s*"(\d{4}-\d{2}-\d{2})"\s*,\s*(-?[\d.]+)', block)
        if not points:
            continue
        out.append({
            "key": m_id.group(1),
            "name": m_name.group(1) if m_name else m_id.group(1),
            "unit": m_unit.group(1) if m_unit else "",
            "refLow": float(m_lo.group(1)) if m_lo else None,
            "refHigh": float(m_hi.group(1)) if m_hi else None,
            "points": [(d, float(v)) for d, v in points],
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2024-01-01", help="YYYY-MM-DD")
    ap.add_argument("--url", default=SOURCE)
    args = ap.parse_args()

    try:
        series = parse(fetch(args.url))
    except Exception as err:                       # noqa: BLE001 - reported, not swallowed
        print(f"could not read {args.url}: {err}", file=sys.stderr)
        return 1

    seq, written = 1, 0
    for s in series:
        for day, value in s["points"]:
            if day < args.since:
                continue
            # Midday local, because a lab result carries a date and not a time.
            at = int(datetime.fromisoformat(day + "T12:00:00+00:00").timestamp() * 1000)
            event = {
                "id": "lab-" + hashlib.sha1(f"{s['key']}|{day}".encode()).hexdigest()[:16],
                "seq": seq,
                "type": "lab",
                "labKey": s["key"],
                "name": s["name"],
                "value": value,
                "unit": s["unit"],
                "refLow": s["refLow"],
                "refHigh": s["refHigh"],
                "atUTC": at,
                "atOffset": 0,
                "loggedUTC": at,
                "loggedOffset": 0,
                "source": "compendium",
                "dateOnly": True,      # no time was recorded, only a day
            }
            # Weight is published in pounds; the app reasons in kilograms.
            if s["key"] == "weight":
                event["valueKg"] = round(value * KG_PER_LB, 2)
            print(json.dumps(event))
            seq += 1
            written += 1

    print(f"{written} lab points from {len(series)} series since {args.since}.", file=sys.stderr)
    latest = {s["name"]: s["points"][-1] for s in series if s["points"]}
    for name, (day, value) in sorted(latest.items()):
        print(f"  most recent {name}: {value} on {day}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
