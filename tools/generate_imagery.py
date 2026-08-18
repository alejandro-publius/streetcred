#!/usr/bin/env python3
"""Build-time imagery pipeline for StreetCred.

Fetches the Street View "today" frame for a corner, then asks Gemini for two
derived states in parallel: a hazard audit overlay and a proposed-fix
visualization. Output lands in public/img/ and is served as static assets, so
nothing is generated during a demo.

Usage: python3 tools/generate_imagery.py <slug>
"""
import base64, json, os, subprocess, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
IMG = ROOT / "public" / "img"
MODEL = "gemini-3.1-flash-image"

CORNER = {
    "slug": "16th-mission",
    "name": "16th Street and Mission Street",
    "lat": 37.76504541503217,
    "lon": -122.4196931274286,
    "heading": 0,
    "pitch": 0,
}

HAZARD_PROMPT = (
    "This is a real street-level photo of the intersection of {name} in San Francisco. "
    "Annotate it as a professional traffic-safety audit: overlay semi-transparent RED "
    "hatching on sub-standard or faded pedestrian crosswalk markings, and semi-transparent "
    "AMBER hatching on vehicle turning and through-traffic conflict zones where cars cross "
    "the pedestrian path. Add a small legend box in an upper corner with the heading "
    "\"Traffic Safety Audit: {name}\" and two entries: \"RED: sub-standard / faded crosswalk "
    "markings\" and \"AMBER: vehicle conflict zone\". Do not name any other street. Keep the "
    "underlying photograph completely unchanged and photorealistic underneath the overlay."
)

FIX_PROMPT = (
    "Edit this street-level photo of {name} to show a proposed pedestrian safety upgrade. "
    "Keep all buildings, vehicles, people, sky, poles, overhead wires, and traffic signals "
    "exactly as they are. Repave the roadway with fresh dark asphalt. Repaint all crosswalks "
    "as bright white high-visibility continental (ladder) stripes. Add a green painted bike "
    "lane with white flex posts. Add a concrete curb extension with low plantings at the "
    "corner. Photorealistic, same camera angle, same lighting, same time of day. "
    "Do not add any text, labels, or watermarks."
)


def load_key(name):
    if os.environ.get(name):
        return os.environ[name]
    for path in (ROOT / ".dev.vars", pathlib.Path.home() / ".gemini" / ".env"):
        if path.exists():
            for line in path.read_text().splitlines():
                if line.strip().startswith(name + "="):
                    return line.split("=", 1)[1].strip().strip('"')
    sys.exit(f"missing {name}")


def fetch_today(corner, maps_key):
    url = (
        "https://maps.googleapis.com/maps/api/streetview?size=640x400"
        f"&location={corner['lat']},{corner['lon']}&heading={corner['heading']}"
        f"&pitch={corner['pitch']}&fov=90&key={maps_key}"
    )
    out = IMG / f"{corner['slug']}-today.jpg"
    subprocess.run(["curl", "-sS", "-o", str(out), url], check=True)
    return out


def launch(img_path, prompt, out_path, gemini_key):
    """Start one Gemini image edit as a background curl. Returns (proc, tmp, out)."""
    body = {
        "contents": [{"parts": [
            {"inlineData": {"mimeType": "image/jpeg",
                            "data": base64.b64encode(img_path.read_bytes()).decode()}},
            {"text": prompt},
        ]}],
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
    }
    req = out_path.with_suffix(".req.json")
    req.write_text(json.dumps(body))
    resp = out_path.with_suffix(".resp.json")
    proc = subprocess.Popen(
        ["curl", "-sS", "--max-time", "300", "-o", str(resp),
         "-H", "Content-Type: application/json",
         "-H", f"x-goog-api-key: {gemini_key}",
         "-d", f"@{req}",
         f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"])
    return proc, req, resp, out_path


def collect(proc, req, resp, out_path):
    proc.wait()
    req.unlink(missing_ok=True)
    d = json.loads(resp.read_text())
    resp.unlink(missing_ok=True)
    if "error" in d:
        print(f"FAIL {out_path.name}: {d['error']['message'][:140]}")
        return False
    parts = d.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    imgs = [p for p in parts if "inlineData" in p]
    if not imgs:
        print(f"FAIL {out_path.name}: no image returned")
        return False
    out_path.write_bytes(base64.b64decode(imgs[0]["inlineData"]["data"]))
    print(f"OK {out_path.name} ({out_path.stat().st_size} bytes)")
    return True


def main():
    IMG.mkdir(parents=True, exist_ok=True)
    c = CORNER
    maps_key = load_key("GOOGLE_MAPS_API_KEY")
    gemini_key = load_key("GEMINI_API_KEY")
    today = fetch_today(c, maps_key)
    print(f"OK {today.name}")
    jobs = [
        launch(today, HAZARD_PROMPT.format(name=c["name"]),
               IMG / f"{c['slug']}-hazards.jpg", gemini_key),
        launch(today, FIX_PROMPT.format(name=c["name"]),
               IMG / f"{c['slug']}-fix.jpg", gemini_key),
    ]
    ok = [collect(*j) for j in jobs]
    print("imagery complete" if all(ok) else "imagery partial")


if __name__ == "__main__":
    main()
