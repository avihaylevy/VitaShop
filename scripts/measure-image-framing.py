"""
measure-image-framing.py — VitaShop repository-local tooling.

TASK-010 build order step 5 (ProductCard/ProductGrid), Q4 approval.
Reads product image assets and computes the four image-normalisation
numbers required by design/DESIGN_SYSTEM.md §7 (Accepted, DEC-035) and
technical/UI_IMPLEMENTATION_PLAN.md §8 (Accepted, DEC-036, Option A).

Rule (§7): fit the product's *trimmed* content box to 76% of the well
height, capped at 84% of the well width, then re-centre on the content
box (not the raster canvas).

This script is TOOLING ONLY:
  - never imported by the client application
  - not a runtime or build dependency (no npm package added)
  - reads source assets, never writes or modifies them
  - deterministic: same input bytes -> same output numbers
  - writes its result to client/src/data/imageFraming.json, which the
    application DOES import (as static JSON, not by running this script)

Requires: Python 3.x + Pillow ("pip install pillow"), verified locally
before use, per the approval that this environment must be present and
this script must never install it automatically.

Usage:
    python scripts/measure-image-framing.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageChops
except ImportError:
    print(
        "ERROR: Pillow is not installed in this Python environment.\n"
        "This script does not install dependencies automatically.\n"
        "Install manually: pip install pillow",
        file=sys.stderr,
    )
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = REPO_ROOT / "assets" / "products"
OUTPUT_PATH = REPO_ROOT / "client" / "src" / "data" / "imageFraming.json"

# Only the six DEC-032 verified products are in scope for this slice.
# Adding a filename here requires the corresponding product to be
# verified=yes in assets/products/products.csv.
VERIFIED_IMAGE_FILES = [
    "אומגה 3 של חברת סולגאר.jpg",
    "ויטמין C בטעם פטל חמוציות של חברת סולגאר.jpg",
    "טבליות ויטמין D של חברת סופרהרב.jpg",
    "מגנזיות מקס 550 של חברת סופרהרב.jpg",
    "סולגר טבליות ויטמין B12.jpg",
    "סולגר טבליות סידן ומגנזיום בתוספת ויטמין D3.jpg",
]

# Trim tolerance: a pixel is "background" if every RGB channel is within
# this distance of pure white. All 15 supplied product assets are pure
# #FFFFFF-cornered JPEGs (verified by direct pixel inspection), so a
# small tolerance only absorbs JPEG compression noise at the trim edge.
WHITE_TOLERANCE = 12

# §7: content box target as % of well height, capped as % of well width.
TARGET_HEIGHT_PCT = 76.0
MAX_WIDTH_PCT = 84.0


def trimmed_bbox(image: "Image.Image") -> tuple[int, int, int, int]:
    rgb = image.convert("RGB")
    background = Image.new("RGB", rgb.size, (255, 255, 255))
    diff = ImageChops.difference(rgb, background).convert("L")
    mask = diff.point(lambda p: 255 if p > WHITE_TOLERANCE else 0)
    bbox = mask.getbbox()
    if bbox is None:
        # Fully blank/white asset — no content to frame.
        raise ValueError("image has no non-white content; cannot compute a trim box")
    return bbox


def compute_framing(image_path: Path) -> dict:
    with Image.open(image_path) as im:
        canvas_w, canvas_h = im.size
        x0, y0, x1, y1 = trimmed_bbox(im)

    content_w = x1 - x0
    content_h = y1 - y0
    content_cx = x0 + content_w / 2
    content_cy = y0 + content_h / 2
    canvas_cx = canvas_w / 2
    canvas_cy = canvas_h / 2

    # Frame height is fixed at the target; frame width follows the
    # content's own aspect ratio, then is capped per §7.
    frame_height_pct = TARGET_HEIGHT_PCT
    content_aspect = content_w / content_h
    frame_width_pct = frame_height_pct * content_aspect
    if frame_width_pct > MAX_WIDTH_PCT:
        frame_width_pct = MAX_WIDTH_PCT
        frame_height_pct = frame_width_pct / content_aspect

    # Centring correction: how far the content's own centre sits from the
    # raster canvas's centre, as a % of canvas dimensions. Re-centring on
    # the content (not the canvas) is the §7 requirement that fixes the
    # "tall bottle looks smaller than a square box" failure.
    shift_x_pct = ((content_cx - canvas_cx) / canvas_w) * 100
    shift_y_pct = ((content_cy - canvas_cy) / canvas_h) * 100

    return {
        "frameWidthPct": round(frame_width_pct, 2),
        "frameHeightPct": round(frame_height_pct, 2),
        "shiftXPct": round(shift_x_pct, 2),
        "shiftYPct": round(shift_y_pct, 2),
    }


def main() -> None:
    if not SOURCE_DIR.is_dir():
        print(f"ERROR: source directory not found: {SOURCE_DIR}", file=sys.stderr)
        sys.exit(1)

    result: dict[str, dict] = {}
    missing: list[str] = []

    for filename in VERIFIED_IMAGE_FILES:
        path = SOURCE_DIR / filename
        if not path.is_file():
            missing.append(filename)
            continue
        result[filename] = compute_framing(path)

    if missing:
        print("ERROR: missing verified source image(s):", file=sys.stderr)
        for name in missing:
            print(f"  - {name}", file=sys.stderr)
        sys.exit(1)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")

    print(f"Wrote {len(result)} entries to {OUTPUT_PATH.relative_to(REPO_ROOT)}")
    for filename, framing in result.items():
        print(f"  {filename}: {framing}")


if __name__ == "__main__":
    main()
