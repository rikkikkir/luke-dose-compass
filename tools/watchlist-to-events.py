#!/usr/bin/env python3
"""Turn Luke's Watch List into check definitions for the app.

Everything below is already in Rikki's records, on the "What to Watch For"
page in her luke-health site, sourced from the Thornwood veterinary record and
her own notes. The app knew none of it.

The most important line on that page, and the reason this tool exists:

CAUTION ON PROVENANCE. That page also described a daily "carrot count" as his
most reliable signal. Rikki says that was exaggerated in her archives: she does
not count them, he gets as many as he wants, and he pursues them. A prior audit
of that site found two outright fabrications, so treat anything here as a claim
to confirm with her rather than a fact to build on. The pursuing is real; the
number never was.

Definitions are written as events so they live in her private log rather than
in the public repository, sync like everything else, and can be edited later
without a release.

    python3 tools/watchlist-to-events.py > luke.watchlist.export.ndjson
"""

import hashlib, json, sys
from datetime import datetime, timezone

SOURCE = "Luke's Watch List — Thornwood record and owner notes. UNCONFIRMED: that page mixes clinical record with written-up notes, and one claim on it (a daily carrot count) Rikki has said was exaggerated."

# Quoted from her page, not paraphrased, so the wording she trusts is the
# wording she sees.
CHECKS = [
    dict(key="breathing", every="daily", label="Breathing looks calm at rest",
         detail="Calm, even, unlabored is the baseline. A sustained climb in resting rate, "
                "or any effort to breathe, is an early heart-fluid warning."),
    dict(key="meals", every="daily", label="Ate his meals, still pursuing his carrots",
         detail="He is a devoted eater and he loves carrots — he gets as many as he wants "
                "and he pursues them. A real loss of appetite is out of character, and him "
                "no longer chasing what he loves is the thing to notice. Not a number."),
    dict(key="lasix", every="daily", label="Both Lasix doses, about 12 hours apart",
         detail="Her records record the intent as roughly 12 hours apart. No vet has set a "
                "minimum gap, so the app does not enforce one — this is the plan, not a rule."),
    dict(key="moving", every="daily", label="Moving, rising and settling as usual, gums pink",
         detail="With his arthritis, whether he is rising, walking and settling about as "
                "usual, or noticeably more sore."),
    dict(key="cheek", every="weekly", label="Cheek bump unchanged",
         detail="A ~2 mm soft pink growth on the right cheek, unchanged for months. Likely a "
                "benign skin tag, but it carries some features of a mast cell tumour, so it "
                "is the one to watch closely. Watch for growth OR shrinking. If it changes, "
                "have it aspirated."),
    dict(key="weight", every="weekly", label="Weight steady, no quiet drift down",
         detail="He came down about 20 lb from his May 2025 peak to a healthy 79.1 lb, which "
                "was a good thing. Further unintentional loss should prompt a closer look."),
    dict(key="lumps", every="weekly", label="Other lumps unchanged",
         detail="Lipomas in the right armpit and flank fold, sampled August 2025 and "
                "confirmed harmless. A drained hematoma at the base of the left ear may "
                "slowly refill, which is expected. Note any that grow or change shape."),
]


def main() -> int:
    now = int(datetime.now(timezone.utc).timestamp() * 1000)
    for i, c in enumerate(CHECKS, start=1):
        print(json.dumps({
            "id": "checkdef-" + hashlib.sha1(c["key"].encode()).hexdigest()[:16],
            "seq": i,
            "type": "checkdef",
            "checkKey": c["key"],
            "label": c["label"],
            "detail": c["detail"],
            "every": c["every"],
            "counter": c.get("counter", False),
            "atUTC": now,
            "atOffset": 0,
            "loggedUTC": now,
            "loggedOffset": 0,
            "source": SOURCE,
        }))

    print(f"{len(CHECKS)} checks "
          f"({sum(1 for c in CHECKS if c['every'] == 'daily')} daily, "
          f"{sum(1 for c in CHECKS if c['every'] == 'weekly')} weekly).", file=sys.stderr)
    print("Note: her Watch List names Thornwood for clinic hours and leaves the emergency "
          "number blank. Thornwood is in Michigan; the app's crisis card carries the Bozeman "
          "numbers, including the one that page asks to be filled in.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
