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
import csv
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

# 🔴 DERIVED FROM THE CSV, NOT HARDCODED — ISSUE-063, fixed 2026-08-12.
#
# This list used to be six filenames typed out by hand, frozen at the
# six-product catalogue of MILESTONE-002. The catalogue grew to 49 and the
# list did not, so 43 products rendered on the 86%-contain fallback and the
# only signal was a dev-only console warning nobody reads.
#
# ⚠️ The script was ITSELF the defect ISSUE-063 describes: a manually
# maintained artefact keyed off data that only grows — the same family as
# productImages.ts before ISSUE-040. Re-running it would have "succeeded"
# and changed nothing, which is exactly what that failure shape looks like.
#
# Reading products.csv makes the set converge by construction: every
# verified=yes row is measured, and a new batch needs no edit here.
def _verified_image_files() -> list[str]:
    csv_path = REPO_ROOT / "assets" / "products" / "products.csv"
    with csv_path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    seen: dict[str, None] = {}
    for row in rows:
        if (row.get("verified") or "").strip() != "yes":
            continue
        name = (row.get("image_file") or "").strip()
        if name:
            seen.setdefault(name, None)
    return list(seen)


VERIFIED_IMAGE_FILES = _verified_image_files()

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


# The well ProductImage renders into is a fixed 4:3 box (aspect-[4/3]);
# frameWidthPct is a fraction of the well's WIDTH while frameHeightPct is a
# fraction of its HEIGHT, so converting a pixel aspect between the two axes
# needs this constant.
WELL_ASPECT = 4 / 3


def compute_framing(image_path: Path) -> dict:
    """
    ISSUE-107 — the 2026-08-15 correction, and the defect was the MATH, not
    the rule. ProductImage `object-contain`s the WHOLE FILE into the frame
    element, but this function used to size that element to the trimmed
    CONTENT box. For the original tightly-cropped assets (content == file)
    the two coincide and §7's verified "every body at 76%" held; for any
    asset carrying its own in-file padding, the file was contained into a
    content-sized box and the visible product rendered SMALLER than 76% by
    exactly the padding ratio — the user's "some products are not the same
    size" report, measured live (h=76% frames whose products differ wildly).

    The corrected model sizes the element to the FILE box at the scale that
    lands the CONTENT at 76% of the well height (capped so the content never
    exceeds 84% of the well width), keeping the element at the file's own
    aspect so object-contain letterboxes nothing. The translate then centres
    the CONTENT in the well: the offset is (file centre − content centre) as
    a percentage of the element's own dimensions, which is what CSS
    translate percentages are relative to. A padded file's element may
    legitimately exceed the well; the well's overflow-hidden crops only the
    padding.
    """
    with Image.open(image_path) as im:
        canvas_w, canvas_h = im.size
        x0, y0, x1, y1 = trimmed_bbox(im)

    content_w = x1 - x0
    content_h = y1 - y0
    content_cx = x0 + content_w / 2
    content_cy = y0 + content_h / 2
    canvas_cx = canvas_w / 2
    canvas_cy = canvas_h / 2

    # Element (frame) sized to the FILE at the content-normalising scale.
    frame_height_pct = TARGET_HEIGHT_PCT * canvas_h / content_h
    frame_width_pct = frame_height_pct * (canvas_w / canvas_h) / WELL_ASPECT

    # §7's cap binds on the CONTENT's rendered width, not the element's.
    content_width_pct = TARGET_HEIGHT_PCT * (content_w / content_h) / WELL_ASPECT
    if content_width_pct > MAX_WIDTH_PCT:
        scale_down = MAX_WIDTH_PCT / content_width_pct
        frame_height_pct *= scale_down
        frame_width_pct *= scale_down

    # Centre the CONTENT in the well: move the element by the distance from
    # the content's centre to the file's centre, in element-relative %.
    shift_x_pct = ((canvas_cx - content_cx) / canvas_w) * 100
    shift_y_pct = ((canvas_cy - content_cy) / canvas_h) * 100

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
