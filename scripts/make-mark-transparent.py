# ISSUE-018 / TASK-011 — the transparent standalone-mark variant, approved by
# the user 2026-08-15 ("Derive transparent mark; defer SVG + Hebrew").
#
# Same derivation family as make-favicon.py: read the untouched source
# assets/brand/source/just-logo.png, lift the ~#FAFAFA ground to transparency,
# trim to the artwork's bounding box, pad square (the Logo component's "mark"
# variant renders it in a square box with object-fit: contain), and export a
# 512px master to BOTH homes the repo convention uses:
#
#   assets/brand/web/vitashop-mark-transparent.png     the canonical derived asset
#   client/src/assets/brand/vitashop-mark-transparent.png   the bundler's copy
#
# Run from the repo root:  python scripts/make-mark-transparent.py
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "assets/brand/source/just-logo.png"
OUTS = [
    REPO / "assets/brand/web/vitashop-mark-transparent.png",
    REPO / "client/src/assets/brand/vitashop-mark-transparent.png",
]

GROUND_MIN_CHANNEL = 235
GROUND_MAX_SPREAD = 12
MARGIN = 0.04  # slim — the component's own box supplies breathing room


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
    master = canvas.resize((512, 512), Image.LANCZOS)

    for out in OUTS:
        master.save(out)
        print(f"written: {out}")


if __name__ == "__main__":
    main()
