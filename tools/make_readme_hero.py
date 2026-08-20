#!/usr/bin/env python3
"""Build the README's before-and-after composite for any corner.

    python3 tools/make_readme_hero.py 16th-and-mission
    python3 tools/make_readme_hero.py 19th-and-mission --out assets/other.png

Left panel is the hazard audit, right panel is the proposed fix, both fetched
from the deployed /gen endpoint so the composite is built from the same stored
bytes the site serves rather than from anything re-generated for a picture.

Two rules the script enforces rather than trusting the operator to remember:
the panels are only ever scaled, never cropped, because Google's attribution is
burned into the bottom of each frame and cropping it off would strip an
attribution the site is required to show; and it refuses to build at all if
either frame is missing, instead of quietly producing a half composite.
"""
import argparse, io, subprocess
from PIL import Image, ImageDraw, ImageFont

HOST = "https://streetcred.thealexschroeder.workers.dev"
TOTAL_W = 1600          # renders crisply on GitHub at 2x of its display width
GAP = 56                # the arrow lives here
PAD = 0
INK = (20, 27, 45)
PAPER = (250, 249, 245)

FONTS = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def font(size):
    for path in FONTS:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def fetch(slug, state):
    # curl rather than urllib: Python on macOS ships without a certificate
    # bundle unless one is installed, so urllib fails to verify a perfectly
    # valid certificate. curl uses the system trust store and is present
    # everywhere this repo runs.
    url = f"{HOST}/gen/{slug}/{state}.jpg"
    try:
        out = subprocess.run(
            ["curl", "-fsS", "--max-time", "30", url],
            capture_output=True, check=True,
        ).stdout
        return Image.open(io.BytesIO(out)).convert("RGB")
    except Exception as e:
        raise SystemExit(
            f"{slug}: cannot read {state} from {url} ({e}).\n"
            "Both the hazard audit and the proposed fix must be stored for this "
            "corner. A composite with one panel would misrepresent what ran."
        )


def label(draw, x, y, text):
    """A small burned-in caption on a pill, so it stays legible over any frame."""
    f = font(30)
    tw = draw.textlength(text, font=f)
    pad_x, pad_y, h = 18, 10, 46
    draw.rounded_rectangle([x, y, x + tw + pad_x * 2, y + h], radius=9, fill=(20, 27, 45, 255))
    draw.text((x + pad_x, y + pad_y - 2), text, font=f, fill=(255, 255, 255))


def credit(draw, right_x, baseline_y, text):
    """A small right-aligned credit, matching where the source watermark sits."""
    f = font(22)
    tw = draw.textlength(text, font=f)
    x, y = right_x - tw, baseline_y - 22
    draw.rectangle([x - 10, y - 6, right_x + 4, y + 28], fill=(0, 0, 0))
    draw.text((x, y), text, font=f, fill=(232, 232, 232))


def arrow(draw, cx, cy, size):
    """A plain rightward arrow, centred in the gap between the panels."""
    half = size / 2
    draw.line([(cx - half, cy), (cx + half * 0.45, cy)], fill=INK, width=6)
    draw.polygon(
        [(cx + half, cy), (cx + half * 0.3, cy - half * 0.55), (cx + half * 0.3, cy + half * 0.55)],
        fill=INK,
    )


def build(slug, out):
    left, right = fetch(slug, "hazards"), fetch(slug, "fix")

    panel_w = (TOTAL_W - GAP) // 2
    # Scaled, never cropped: the attribution sits in the frame and travels with it.
    def scaled(im):
        return im.resize((panel_w, round(im.height * panel_w / im.width)), Image.LANCZOS)

    left, right = scaled(left), scaled(right)
    h = min(left.height, right.height)
    # Equal heights without cropping either: if the sources ever differ in ratio,
    # the shorter one sets the height and the other is scaled to match.
    if left.height != h:
        left = left.resize((round(left.width * h / left.height), h), Image.LANCZOS)
    if right.height != h:
        right = right.resize((round(right.width * h / right.height), h), Image.LANCZOS)

    canvas = Image.new("RGB", (TOTAL_W, h), PAPER)
    canvas.paste(left, (0, 0))
    canvas.paste(right, (TOTAL_W - right.width, 0))

    d = ImageDraw.Draw(canvas)
    arrow(d, TOTAL_W // 2, h // 2, GAP - 14)
    label(d, 22, 22, "AUDIT")
    label(d, TOTAL_W - right.width + 22, 22, "PROPOSED FIX")
    # The audit frame is the photograph with overlays, so it carries Google's
    # watermark and keeps it. The fix frame is a generated image and carries no
    # watermark, because Gemini does not reproduce one. Copying Google's mark
    # onto a render Google did not make would be a false attribution, so the
    # right panel gets the true statement instead: the render was made from
    # their photograph.
    credit(d, TOTAL_W - 22, h - 20, "Base imagery: Google")

    canvas.save(out, "PNG", optimize=True)
    print(f"{out}  {canvas.width}x{canvas.height}  panels {left.width}x{left.height} and {right.width}x{right.height}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--out")
    a = ap.parse_args()
    build(a.slug, a.out or f"assets/readme_hero_{a.slug.replace('-', '_')}.png")
