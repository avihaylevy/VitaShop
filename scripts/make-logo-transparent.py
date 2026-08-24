# ISSUE-018 follow-up — derive the transparent full-logo (mark + wordmark)
# from the untouched source, the same family as make-mark-transparent.py and
# make-favicon.py. Committed (2026-08-25 review finding) so the next logo
# revision regenerates the asset and re-measures the content bbox with one
# command instead of hand-typing constants.
#
# Reads assets/brand/source/logo-with-name.png (never modified), lifts the
# near-white ground to transparency across the FULL canvas (no trim — the
# Logo component's frame math in client/src/components/brand/logoFrame.ts
# handles content placement), prints the content bbox to copy into
# logoFrame.ts, and exports to both homes the repo convention uses:
#
#   assets/brand/web/vitashop-logo-transparent.png         the canonical derived asset
#   client/src/assets/brand/vitashop-logo-transparent.png  the bundler's copy
#
# Run from the repo root:  python scripts/make-logo-transparent.py
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "assets/brand/source/logo-with-name.png"
OUTS = [
    REPO / "assets/brand/web/vitashop-logo-transparent.png",
    REPO / "client/src/assets/brand/vitashop-logo-transparent.png",
]

# Slightly looser than the mark script's 235/12: the 2026-08 artwork's ground
# carries a faint vignette that 235 leaves behind as a ghost box.
GROUND_MIN_CHANNEL = 228
GROUND_MAX_SPREAD = 14


def is_ground(r: int, g: int, b: int) -> bool:
    return (
        r > GROUND_MIN_CHANNEL
        and g > GROUND_MIN_CHANNEL
        and b > GROUND_MIN_CHANNEL
        and max(r, g, b) - min(r, g, b) < GROUND_MAX_SPREAD
    )


def main() -> None:
    img = Image.open(SRC).convert("RGBA")
    w, h = img.size
    px = img.load()

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if is_ground(r, g, b):
                px[x, y] = (r, g, b, 0)

    corner_alphas = [px[0, 0][3], px[w - 1, 0][3], px[0, h - 1][3], px[w - 1, h - 1][3]]
    if any(corner_alphas):
        raise SystemExit(f"ground lift incomplete — corner alphas {corner_alphas}, tune thresholds")

    bbox = img.getbbox()
    print(f"canvas: {w}x{h}")
    print(f"content bbox for logoFrame.ts: x={bbox[0]} y={bbox[1]} w={bbox[2] - bbox[0]} h={bbox[3] - bbox[1]}")

    for out in OUTS:
        img.save(out)
        print("written:", out)


if __name__ == "__main__":
    main()
