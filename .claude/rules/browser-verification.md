# Browser verification policy — VitaShop

> Source: DEC-040 (Playwright CLI approved), ISSUE-020 (sandbox emulation limitation),
> ISSUE-023 (exact-PID process rule), ISSUE-024 (320px header overflow).
> Applies to Claude and Codex (BUILD mode), any session verifying changed UI behavior.

---

## When Playwright CLI verification is required

Any change to rendered UI behavior — new component, layout change, responsive rule,
i18n string, accessibility structure, or interaction — is verified with `playwright-cli`
before being reported as done. Pure logic/data changes with no rendering effect
(e.g. a lib function, a fixture) do not require it.

## Required coverage

- **Both languages.** Hebrew RTL and English LTR — never one only.
- **Widths.** 320, 375, 390, 420, 768, 1024, 1280, **plus every breakpoint
  documented in `design/DESIGN_SYSTEM.md`** (currently 375 · 768 · 1024 · 1440,
  and the 420px column-count threshold). If the design system's breakpoint list
  changes, this list follows it — don't let the two drift apart.
- **ARIA snapshot** (`playwright-cli snapshot`) — confirm roles, accessible names,
  and structure match the component's stated contract (e.g. one link + one button
  per card, `list`/`listitem` for a grid).
- **Keyboard focus order** — tab order matches visual/DOM order; no nested
  interactive elements swallow focus.
- **DOM-state verification** — don't infer from a screenshot what a snapshot or
  `eval` can confirm directly (disabled state, aria-live text, computed style).
- **Horizontal overflow** — `document.documentElement.scrollWidth ===
  document.documentElement.clientWidth` at every required width, both languages.
- **Mirrored logical layout** — RTL and LTR must use the *same* implementation
  (no separate RTL-only CSS branch); verify inline-start alignment mirrors
  correctly (e.g. a short grid row packs right in RTL, left in LTR).
- **LTR numeric isolation** — prices/numbers inside RTL text render
  `dir="ltr"` (or equivalent isolation) and stay LTR in both languages.

## Screenshots are supporting evidence, not the test

A screenshot documents what was seen. It does not substitute for the ARIA
snapshot, the overflow check, or the console/network check — those are the
actual pass/fail signal. Never report "verified" from a screenshot alone.

## Emulation is not a substitute for a real device

Per ISSUE-020, viewport emulation (including `playwright-cli resize` /
Chromium headless rendering) narrows what still needs checking on a real
device — it does not close that gap. Anything relying on real touch input,
real device pixel ratio, or a genuine mobile browser still needs the user's
own device, and must be reported as "emulated, not device-verified" rather
than implied as equivalent.

## Defect recording

Any defect confirmed during verification — regardless of whether it's in
scope for the current change — is recorded in `operations/ISSUES.md` with
severity, reproduction steps, and exact measurements. A defect found outside
the current task's scope is **recorded, not silently fixed** unless the user
asks for it to be fixed now.

## Process safety

- Check for an existing project dev server on the expected port before
  starting a new one. Reuse it if found.
- If you start a server, record its exact PID (verified via
  `Get-NetTCPConnection -LocalPort <port>` or equivalent) before doing
  anything else with it.
- Stop it with **Ctrl+C** (in the terminal that owns it) or by that **exact
  verified PID** — nothing broader.
- 🔴 **Blanket Node termination is forbidden** — no `taskkill /F /IM
  node.exe /T`, `killall node`, `pkill node`, or equivalent. See ISSUE-023.

## Secret and browser-profile safety

- Never launch with `--persistent` or a personal/named browser profile.
- Never inspect, export, or persist cookies, localStorage, sessionStorage,
  or storage-state from a `playwright-cli` session against this project.
- Never launch with `--browser chrome` — Chromium only is installed and
  approved (DEC-040).
- Sessions are disposable and in-memory by default — keep them that way.

## Committing artifacts

🔴 **Screenshots must be written under `.playwright-cli/`, never the repo
root.** `playwright-cli screenshot` defaults to the current working
directory — always pass an explicit path, e.g.
`playwright-cli screenshot --filename=.playwright-cli/checkpoint-name.png`.
Named snapshots (`playwright-cli snapshot --filename=...`) follow the same
rule; unnamed snapshots already default into `.playwright-cli/` on their own.

`.playwright-cli/` (and `.playwright/`, if `@playwright/test` is ever
separately approved) is git-ignored — see `.gitignore`. These artifacts are
**never committed**. If anything still ends up loose at the repo root
despite the above, delete it before ending the verification pass, unless
the user asked to keep it.
