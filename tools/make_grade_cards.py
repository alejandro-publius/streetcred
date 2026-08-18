#!/usr/bin/env python3
"""Build the five share cards a scored corner falls back to, one per grade.

  python3 tools/make_grade_cards.py

A Worker has no image library, which is why tools/make_og.py exists and runs
offline. That is affordable for the audited fleet, which is two dozen corners
with a photograph each. It is not affordable for the 7,353 corners in the city
shards: compositing one card apiece would be 7,353 Street View fetches and
7,353 KV writes, which is the exact shape the shard design exists to avoid.

So a scored corner falls back to the card for its grade. The card carries the
wordmark, the grade, and the percentile band that grade means, which is the
claim the page makes. The corner's name and its exact index ride in og:title
and og:description, which every platform renders beside the image. A corner
that later gets a composited card of its own still uses it: this is the
fallback, not a replacement for putShareCard.

Written to public/og/ as static assets, so they cost no KV writes at all.
"""
import pathlib

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "og"

W, H = 1200, 630

INK = (20, 27, 45)
ACCENT = (240, 126, 38)
GREEN = (120, 140, 93)
BLUE = (106, 155, 204)
CREAM = (250, 249, 245)
DIM = (128, 134, 152)

GRADE_COLOR = {"A": GREEN, "B": (145, 160, 110), "C": BLUE, "D": (200, 118, 42), "F": ACCENT}

# The bands, in the words the page uses. These are the grade definition, not a
# gloss on it: A is below the 40th percentile of the citywide census, F is at
# the 93rd and above.
BAND = {
    "A": "Below the 40th percentile of San Francisco intersections",
    "B": "Between the 40th and 64th percentile of San Francisco intersections",
    "C": "Between the 65th and 79th percentile of San Francisco intersections",
    "D": "Between the 80th and 92nd percentile of San Francisco intersections",
    "F": "Worse than 93 percent of San Francisco intersections",
}

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial Bold.ttf",
]
FONT_LIGHT = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]


def font(size, bold=True):
    for path in (FONT_CANDIDATES if bold else FONT_LIGHT):
        if pathlib.Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def build(grade):
    card = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(card)
    color = GRADE_COLOR[grade]

    # A rule in the grade's colour along the top, so the card reads as this
    # grade before a word of it is read.
    d.rectangle([0, 0, W, 12], fill=color)

    f_mark = font(38)
    d.text((66, 62), "Street", font=f_mark, fill=INK)
    d.text((66 + d.textlength("Street", font=f_mark), 62), "Cred", font=f_mark, fill=ACCENT)

    d.text((66, 122), "SAN FRANCISCO CORNER SCOREBOARD", font=font(17), fill=DIM)

    # The grade itself, the whole point of the card.
    box = 300
    bx, by = 66, 210
    d.rounded_rectangle([bx, by, bx + box, by + box], radius=54, fill=color)
    f_g = font(196)
    gw = d.textlength(grade, font=f_g)
    top, bottom = d.textbbox((0, 0), grade, font=f_g)[1], d.textbbox((0, 0), grade, font=f_g)[3]
    d.text((bx + (box - gw) / 2, by + (box - (bottom - top)) / 2 - top), grade, font=f_g, fill=CREAM)

    tx = bx + box + 54
    d.text((tx, 236), "DANGER INDEX", font=font(21), fill=DIM)

    # The band, wrapped by hand rather than by a layout engine, because there
    # are five of these and they are checked by eye once.
    words = BAND[grade].split(" ")
    lines, line = [], ""
    f_band = font(34)
    for w in words:
        trial = (line + " " + w).strip()
        if d.textlength(trial, font=f_band) > W - tx - 66:
            lines.append(line)
            line = w
        else:
            line = trial
    lines.append(line)
    y = 278
    for ln in lines:
        d.text((tx, y), ln, font=f_band, fill=INK)
        y += 46

    d.text((tx, y + 18), "Graded against a census of every crossing in the city.",
           font=font(20, bold=False), fill=DIM)
    d.text((tx, y + 50), "Reported harm within 80 meters. No exposure normalization.",
           font=font(20, bold=False), fill=DIM)

    # The ink band, carrying the promise the product makes.
    d.rectangle([0, H - 96, W, H], fill=INK)
    d.text((66, H - 66), "Every claim graded and traced to its source.", font=font(24), fill=CREAM)
    url = "streetcred.thealexschroeder.workers.dev"
    d.text((W - 66 - d.textlength(url, font=font(19, bold=False)), H - 61), url,
           font=font(19, bold=False), fill=DIM)

    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"grade-{grade}.jpg"
    card.save(path, "JPEG", quality=88, optimize=True)
    return path


if __name__ == "__main__":
    for g in "ABCDF":
        p = build(g)
        print(f"built {p.relative_to(ROOT)} ({p.stat().st_size} bytes)")
