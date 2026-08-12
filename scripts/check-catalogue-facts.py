#!/usr/bin/env python3
"""Fail loudly when an operations file states a catalogue number that is wrong.

WHY THIS EXISTS
---------------
`operations/ROADMAP.md` went stale twice while its own detail blocks were
current, because a milestone's numbers were restated in three places and
updating one left two lying. Three written instructions on the subject already
exist; the first two were followed literally while the file still lied. Rules
were not the counter-move. This is.

THE RULE FOR TELLING A LIVE CLAIM FROM A HISTORICAL ONE
-------------------------------------------------------
🔴 Only text inside an explicit marker block is checked:

    <!-- CATALOGUE-FACTS:START -->  ...  <!-- CATALOGUE-FACTS:END -->

Everything outside a marker is ignored. That is deliberate, and it is the
honest version of this check rather than the impressive one.

These files intentionally keep superseded blocks full of correct old numbers —
"was 34 seeded", "88% Altman", whole `── superseded ──` sections. A checker
that scanned free prose could not reliably tell those from drift, so it would
either miss real drift or cry wolf about history. A check that cries wolf gets
ignored, and an ignored check is worse than none: it looks like coverage.

⚠️ THE LIMITATION, STATED PLAINLY: this cannot catch a wrong number written
outside a marker block. It is paired with the structural fix — the numbers live
in ONE marked place and everywhere else points at it — and only that pairing
makes the narrow scan sufficient. If a second live copy is ever introduced, it
must be marked too, or this check will not see it.

ANTI-VACUOUS CONTROL
--------------------
🔴 A checker that finds nothing to check MUST FAIL, not pass. If no marker
block exists anywhere, or a block omits a key, that is an error — otherwise
deleting the markers would turn this green forever, which is exactly the
"success-shaped failure" shape this project keeps producing.

USAGE
    python scripts/check-catalogue-facts.py          # exits 0 or 1
    VITASHOP_MEMORY_DIR=<path> python scripts/...    # override the memory root
"""

from __future__ import annotations

import csv
import io
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PRODUCTS_CSV = REPO_ROOT / "assets" / "products" / "products.csv"

# The memory system lives outside the repository (DEC-016 keeps assets in the
# repo; the operations files do not). Overridable so this is not machine-bound.
DEFAULT_MEMORY_DIR = Path(
    r"C:\Users\aviha\תכנות\זיכרון AI\פרוייקט ECOMMERCE\פרוייקט Ecommerce\VitaShop-Project"
)
MEMORY_DIR = Path(os.environ.get("VITASHOP_MEMORY_DIR", DEFAULT_MEMORY_DIR))

SCANNED_FILES = [
    "operations/ROADMAP.md",
    "operations/STATUS.md",
    "operations/CURRENT_TASK.md",
    "operations/ISSUES.md",
]

START = "<!-- CATALOGUE-FACTS:START -->"
END = "<!-- CATALOGUE-FACTS:END -->"

PAGE_SIZE = 24  # server pagination default; a third page appears at 49


def computed_facts() -> dict[str, int]:
    with PRODUCTS_CSV.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))

    seeded = [r for r in rows if (r.get("verified") or "").strip() == "yes"]
    partial = [r for r in rows if (r.get("verified") or "").strip() not in ("yes", "blocked")]
    blocked = [r for r in rows if (r.get("verified") or "").strip() == "blocked"]
    brands = {(r.get("brand") or "").strip() for r in seeded}
    altman = [r for r in seeded if (r.get("brand") or "").strip() == "אלטמן"]

    if not seeded:
        raise SystemExit("check-catalogue-facts: products.csv has NO verified rows — refusing to "
                         "report a catalogue of zero as agreement.")

    return {
        "seeded (verified=yes)": len(seeded),
        "partial": len(partial),
        "blocked": len(blocked),
        "brands": len(brands),
        "pages (pageSize %d)" % PAGE_SIZE: -(-len(seeded) // PAGE_SIZE),
        "altman share": round(100 * len(altman) / len(seeded)),
    }


def marked_blocks(text: str) -> list[tuple[int, str]]:
    """(line number of START, block body) for every marker block in the file."""
    out: list[tuple[int, str]] = []
    lines = text.splitlines()
    start_line = None
    buf: list[str] = []
    for index, line in enumerate(lines, start=1):
        if START in line:
            start_line, buf = index, []
            continue
        if END in line and start_line is not None:
            out.append((start_line, "\n".join(buf)))
            start_line = None
            continue
        if start_line is not None:
            buf.append(line)
    if start_line is not None:
        raise SystemExit(f"check-catalogue-facts: unterminated marker block opened at line {start_line}")
    return out


FACT_LINE = re.compile(r"^\s*(?P<key>[A-Za-z][A-Za-z ()=%\d]*?)\s{2,}(?P<value>\d+)%?\s*$")


def main() -> int:
    expected = computed_facts()
    problems: list[str] = []
    checked = 0
    blocks_found = 0

    for rel in SCANNED_FILES:
        path = MEMORY_DIR / rel
        if not path.exists():
            problems.append(f"{rel}: MISSING — cannot verify a file that is not there")
            continue
        text = io.open(path, encoding="utf-8").read()
        for start_line, body in marked_blocks(text):
            blocks_found += 1
            seen: set[str] = set()
            for offset, line in enumerate(body.splitlines(), start=1):
                match = FACT_LINE.match(line)
                if not match:
                    continue
                key = match.group("key").strip()
                if key not in expected:
                    continue
                seen.add(key)
                checked += 1
                actual = int(match.group("value"))
                if actual != expected[key]:
                    problems.append(
                        f"{rel}:{start_line + offset}: {key!r} states {actual}, "
                        f"products.csv computes {expected[key]}"
                    )
            missing = sorted(set(expected) - seen)
            if missing:
                problems.append(
                    f"{rel}:{start_line}: marker block omits {missing} — a fact block that "
                    f"states nothing cannot drift, and would pass forever"
                )

    # 🔴 Anti-vacuous controls. Finding nothing is a FAILURE, not agreement.
    if blocks_found == 0:
        problems.append(
            "no CATALOGUE-FACTS marker block found in any scanned file — either the single "
            "source was deleted or the markers were renamed. This check verifies nothing "
            "without one, so it fails rather than passing."
        )
    if blocks_found and checked == 0:
        problems.append("marker blocks exist but contained no recognisable 'key   value' lines")

    if problems:
        print("🔴 CATALOGUE FACTS DRIFT", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        print(f"\ncomputed from {PRODUCTS_CSV.name}: {expected}", file=sys.stderr)
        return 1

    print(f"catalogue facts OK — {checked} value(s) across {blocks_found} block(s) match {PRODUCTS_CSV.name}")
    for key, value in expected.items():
        print(f"  {key:24} {value}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
