#!/usr/bin/env python3
"""Turn Oura sleep records into wake and sleep events for Luke's log.

Rikki and Luke wake and sleep together, so her ring already knows his cycle.
Rather than asking her what time they woke, the app can read what was already
measured — and it reaches back through the whole archive, so the cycle length
that every countdown depends on stops being a default and becomes his.

Reads:  the circadian archive's data/sleep_raw.jsonl
Writes: newline-delimited events, ready for the app's "bring in a log" control.

This only ever ADDS wake and sleep marks. It touches no dose, and the archive
is opened read-only.

    python3 tools/oura-to-events.py --since 2026-09-01 > luke.oura.export.ndjson
"""

import argparse, hashlib, json, sys
from datetime import datetime
from pathlib import Path

DEFAULT_ARCHIVE = Path.home() / "Rikki/Projects/circadian/circadian-archive/data/sleep_raw.jsonl"

# Naps are not a wake cycle. Only a main sleep sets the anchor everything else
# is measured from, so short records are reported and skipped rather than
# silently shaping the log.
MIN_MAIN_SLEEP_HOURS = 3.0


def stable_id(kind: str, iso: str) -> str:
    """Same input, same id — so importing twice adds nothing the second time."""
    return "oura-" + kind + "-" + hashlib.sha1(f"{kind}|{iso}".encode()).hexdigest()[:16]


def to_event(kind: str, iso: str, seq: int) -> dict:
    dt = datetime.fromisoformat(iso)
    at = int(dt.timestamp() * 1000)
    offset = int(dt.utcoffset().total_seconds() // 60) if dt.utcoffset() else 0
    return {
        "id": stable_id(kind, iso),
        "seq": seq,
        "type": kind,                 # 'wake' | 'sleep'
        "atUTC": at,
        "atOffset": offset,
        "loggedUTC": at,
        "loggedOffset": offset,
        "source": "oura",             # never claimed as something she typed
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    ap.add_argument("--since", default="2026-09-01", help="YYYY-MM-DD")
    args = ap.parse_args()

    if not args.archive.exists():
        print(f"no archive at {args.archive}", file=sys.stderr)
        return 1

    records, skipped_short = [], 0
    for line in args.archive.read_text().splitlines():
        try:
            blob = json.loads(line)
        except json.JSONDecodeError:
            continue
        r = blob.get("data", blob)
        if not isinstance(r, dict) or not r.get("bedtime_start"):
            continue
        if (r.get("day") or "") < args.since:
            continue
        hours = (r.get("total_sleep_duration") or 0) / 3600
        if hours < MIN_MAIN_SLEEP_HOURS:
            skipped_short += 1
            continue
        records.append(r)

    records.sort(key=lambda r: r["bedtime_start"])

    seq = 1
    for r in records:
        # bedtime_end is when she woke, which is when Luke woke.
        print(json.dumps(to_event("sleep", r["bedtime_start"], seq))); seq += 1
        if r.get("bedtime_end"):
            print(json.dumps(to_event("wake", r["bedtime_end"], seq))); seq += 1

    print(
        f"{len(records)} sleep periods since {args.since} "
        f"-> {seq - 1} events. Skipped {skipped_short} under {MIN_MAIN_SLEEP_HOURS}h "
        f"(naps, not cycle anchors).",
        file=sys.stderr,
    )
    if records:
        print(f"Most recent wake: {records[-1].get('bedtime_end')}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
