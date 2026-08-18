#!/usr/bin/env python3
"""Build the 1200x630 share card for a corner and upload it to KV.

Run offline, not in the Worker, because a Worker has no image library and the
alternative would be shipping a WASM codec to draw two lines of text.

The card is built on the UNEDITED Street View frame. Never the hazard overlay,
never the generated fix: those are modified Street View imagery, and pushing
them out as social preview assets is the redistribution question the risk review
flagged as unsettled. The frame is cropped from the top so the Google watermark
along its bottom edge stays visible in the finished card.

Usage:
  python3 tools/make_og.py <slug> <lat> <lon> <name> <index> <grade> [heading]
"""
import io
import json
import pathlib
import subprocess
import sys
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
# Outside public/, so a build artifact never becomes a deployed static asset.
OUT = ROOT / ".ogtmp"

W, H = 1200, 630
STRIP = 158           # ink band along the bottom carrying the score
PHOTO_H = H - STRIP

INK = (20, 27, 45)
ACCENT = (240, 126, 38)
GREEN = (120, 140, 93)
BLUE = (106, 155, 204)
CREAM = (250, 249, 245)

GRADE_COLOR = {"A": GREEN, "B": GREEN, "C": BLUE, "D": (200, 118, 42), "F": ACCENT}

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial Bold.ttf",
]


def font(size, bold=True):
    for path in FONT_CANDIDATES:
        if pathlib.Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def load_key(name):
    for line in (ROOT / ".dev.vars").read_text().splitlines():
        if line.strip().startswith(name + "="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit(f"missing {name}")


def street_view(lat, lon, heading, key):
    url = "https://maps.googleapis.com/maps/api/streetview?" + urllib.parse.urlencode({
        "size": "640x400", "location": f"{lat},{lon}", "heading": heading,
        "pitch": 0, "fov": 90, "key": key,
    })
    out = subprocess.run(["curl", "-sS", url], capture_output=True, timeout=60)
    if out.returncode != 0 or not out.stdout[:2] == b"\xff\xd8":
        raise RuntimeError("street view fetch failed")
    return Image.open(io.BytesIO(out.stdout)).convert("RGB")


def build(slug, lat, lon, name, index, grade, heading=0):
    photo = street_view(lat, lon, heading, load_key("GOOGLE_MAPS_API_KEY"))

    # Scale to the card width, then keep the BOTTOM of the frame. The Google
    # watermark sits in the lower left of every Street View image, so cropping
    # from the top removes sky and leaves attribution intact.
    scale = W / photo.width
    photo = photo.resize((W, round(photo.height * scale)), Image.LANCZOS)
    if photo.height > PHOTO_H:
        photo = photo.crop((0, photo.height - PHOTO_H, W, photo.height))

    card = Image.new("RGB", (W, H), INK)
    card.paste(photo, (0, 0))
    d = ImageDraw.Draw(card)

    y = PHOTO_H
    d.rectangle([0, y, W, H], fill=INK)

    # Wordmark, in the two tones the product already uses.
    f_mark = font(31)
    d.text((44, y + 26), "Street", font=f_mark, fill=CREAM)
    wmark = d.textlength("Street", font=f_mark)
    d.text((44 + wmark, y + 26), "Cred", font=f_mark, fill=ACCENT)

    d.text((44, y + 76), name, font=font(23), fill=(196, 200, 212))
    d.text((44, y + 112), "Danger Index, reported harm within 80 meters",
           font=font(15, bold=False), fill=(128, 134, 152))

    # Score, right aligned, with the grade in its band color.
    f_num = font(72)
    num = str(index)
    num_w = d.textlength(num, font=f_num)
    f_den = font(22)
    den_w = d.textlength("/100", font=f_den)

    gcol = GRADE_COLOR.get(grade, ACCENT)
    box = 74
    gx1 = W - 44
    gx0 = gx1 - box
    d.rounded_rectangle([gx0, y + 40, gx1, y + 40 + box], radius=18, fill=gcol)
    f_g = font(42)
    gw = d.textlength(grade, font=f_g)
    d.text((gx0 + (box - gw) / 2, y + 40 + 14), grade, font=f_g, fill=CREAM)

    right = gx0 - 26
    d.text((right - den_w, y + 92), "/100", font=f_den, fill=(128, 134, 152))
    d.text((right - den_w - num_w - 4, y + 44), num, font=f_num, fill=CREAM)

    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{slug}.jpg"
    card.save(path, "JPEG", quality=86, optimize=True)
    return path


def upload(slug, path):
    r = subprocess.run(
        ["npx", "wrangler", "kv", "key", "put", f"og:{slug}",
         "--binding", "STORE", "--remote", "--path", str(path)],
        capture_output=True, text=True, cwd=ROOT, timeout=180,
    )
    ok = r.returncode == 0
    print(("uploaded " if ok else "UPLOAD FAILED ") + f"og:{slug}"
          + ("" if ok else " :: " + (r.stderr or r.stdout)[:200]))
    return ok


if __name__ == "__main__":
    if len(sys.argv) < 7:
        sys.exit(__doc__)
    slug, lat, lon, name, index, grade = sys.argv[1:7]
    heading = sys.argv[7] if len(sys.argv) > 7 else 0
    p = build(slug, float(lat), float(lon), name, int(index), grade, heading)
    print(f"built {p} ({p.stat().st_size} bytes)")
    upload(slug, p)
