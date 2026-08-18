#!/usr/bin/env python3
"""Normalize Apify scrape output into the resident-voices asset.

Two Apify actors run against the corner: a Google Maps places scraper (reviews of
businesses on the plaza) and a Reddit scraper (posts naming the intersection).
Their output shapes differ, so both are flattened to {source, stars, text, when}
and written to public/data/voices-<slug>.json, which the Worker serves.

Reviewer names are deliberately dropped. Only text that mentions the street
environment is kept, so the panel shows what people say about the corner rather
than what they say about a burrito.

Usage: python3 tools/collect_voices.py <gmaps_run_id> <reddit_run_id>
"""
import json, pathlib, re, subprocess, sys, datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data"
SLUG = "16th-mission"

RELEVANT = re.compile(
    r"\b(crosswalk|cross the|crossing|traffic|pedestrian|sidewalk|street|corner|"
    r"intersection|car|cars|driver|drivers|bike|walk|walking|dangerous|unsafe|"
    r"safety|speeding|hit by|jaywalk|light|signal|curb)\b",
    re.I,
)
BLOCK = re.compile(r"\b(fuck|shit|bitch|cunt|nigg|retard)\b", re.I)


def token():
    for line in (ROOT / ".dev.vars").read_text().splitlines():
        if line.startswith("APIFY_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit("no APIFY_TOKEN")


def items(run_id, tok):
    out = subprocess.run(
        ["curl", "-sS", f"https://api.apify.com/v2/actor-runs/{run_id}/dataset/items?token={tok}&limit=200"],
        capture_output=True, text=True, check=True)
    try:
        return json.loads(out.stdout)
    except json.JSONDecodeError:
        return []


def clean(text):
    t = " ".join(str(text or "").split())
    if len(t) > 240:
        cut = t[:240].rsplit(" ", 1)[0]
        t = cut + "..."
    return t


def keep(text):
    return text and len(text) > 40 and RELEVANT.search(text) and not BLOCK.search(text)


def from_gmaps(rows):
    out = []
    for place in rows:
        for r in place.get("reviews") or []:
            text = clean(r.get("text") or r.get("textTranslated"))
            if not keep(text):
                continue
            out.append({
                "source": "google_maps",
                "stars": r.get("stars") or r.get("rating"),
                "text": text,
                "when": (r.get("publishedAtDate") or "")[:10] or None,
                "_score": len(RELEVANT.findall(text)),
            })
    return out


def from_reddit(rows):
    out = []
    for p in rows:
        text = clean(p.get("body") or p.get("text") or p.get("selftext") or p.get("title"))
        if not keep(text):
            continue
        when = p.get("createdAt") or p.get("created") or p.get("date") or ""
        out.append({
            "source": "reddit",
            "stars": None,
            "text": text,
            "when": str(when)[:10] or None,
            "_score": len(RELEVANT.findall(text)),
        })
    return out


def main():
    tok = token()
    gmaps_id, reddit_id = sys.argv[1], sys.argv[2]
    voices = []
    if gmaps_id != "-":
        voices += from_gmaps(items(gmaps_id, tok))
    if reddit_id != "-":
        voices += from_reddit(items(reddit_id, tok))
    # Strongest signal first, but keep both sources represented.
    voices.sort(key=lambda v: (-v["_score"], v["when"] or ""))
    picked, seen_src = [], {}
    for v in voices:
        n = seen_src.get(v["source"], 0)
        if n >= 3:
            continue
        seen_src[v["source"]] = n + 1
        picked.append({k: v[k] for k in ("source", "stars", "text", "when")})
        if len(picked) >= 5:
            break
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"voices-{SLUG}.json"
    path.write_text(json.dumps({
        "collected": datetime.date.today().isoformat(),
        "sources": {"google_maps": gmaps_id, "reddit": reddit_id},
        "items": picked,
    }, indent=2))
    print(f"wrote {path.name}: {len(picked)} voices from {len(voices)} candidates "
          f"({seen_src})")


if __name__ == "__main__":
    main()
