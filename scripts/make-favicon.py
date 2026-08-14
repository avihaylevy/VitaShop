# ISSUE-108 — derive the favicon set from the standalone brand mark.
#
# Reads assets/brand/source/just-logo.png (never modified), trims the
# artwork's bounding box, lifts the near-white ground to transparency, pads
# to a square with an 8% margin and exports:
#
#   client/public/favicon.png          64x64
#   client/public/apple-touch-icon.png 180x180
#
# Committed (fifty-third pass review finding) so the derivation is
# reproducible when ISSUE-018's logo work revises the mark — the same reason
# measure-image-framing.py is committed beside imageFraming.json.
#
# Run from the repo root:  python scripts/make-favicon.py
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "assets/brand/source/just-logo.png"
OUT64 = REPO / "client/public/favicon.png"
OUT180 = REPO / "client/public/apple-touch-icon.png"

# The ground is ~#FAFAFA: near-white AND low-saturation, so the teal/green
# gradient strokes are never touched.
GROUND_MIN_CHANNEL = 235
GROUND_MAX_SPREAD = 12
MARGIN = 0.08  # each side, as a fraction of the artwork's longer edge


def is_ground(r: int, g: int, b: int) -> bool:
    return (
        r > GROUND_MIN_CHANNEL
        and g > GROUND_MIN_CHANNEL
        and b > GROUND_MIN_CHANNEL
        and max(r, g, b) - min(r, g, b) < GROUND_MAX_SPREAD
    )


def main() -> None:
    img = Image.open(SRC).convert("RGBA")
    px = img.load()
    w, h = img.size

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if is_ground(r, g, b):
                px[x, y] = (r, g, b, 0)

    bbox = img.getbbox()
    art = img.crop(bbox)
    aw, ah = art.size
    print(f"artwork bbox: {bbox} size: {art.size}")

    side = int(max(aw, ah) * (1 + 2 * MARGIN))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(art, ((side - aw) // 2, (side - ah) // 2), art)

    canvas.resize((64, 64), Image.LANCZOS).save(OUT64)
    canvas.resize((180, 180), Image.LANCZOS).save(OUT180)
    print(f"written: {OUT64}\nwritten: {OUT180}")


if __name__ == "__main__":
    main()
