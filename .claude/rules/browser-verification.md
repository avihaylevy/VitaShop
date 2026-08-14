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

## 🔴 NEVER PIPE A BUILD OR TEST COMMAND BEFORE READING ITS STATUS

> Added 2026-08-11, after `npm run build | tail -3 && echo BUILD_OK` printed
> **BUILD_OK over a failed compile**.

A pipeline's exit status is the **last** command's. `tsc` failed; `tail`
succeeded; `&&` saw success. The build error scrolled past inside the piped
output and the line after it said the build was fine.

```
✗  npm run build 2>&1 | tail -3 && echo OK      <- reports tail's status
✓  npm run build > /tmp/b.log 2>&1; echo "exit=$?"; tail -3 /tmp/b.log
✓  set -o pipefail; npm run build 2>&1 | tail -3
✓  npm run build 2>&1 | tail -3; [ "${PIPESTATUS[0]}" -eq 0 ]
```

Run it bare and read `$?`, redirect to a file and read `$?`, or use `pipefail`
/ `PIPESTATUS`. **Never let a formatting command stand between a compiler and
its verdict.**

### 🔴 The family this belongs to — recognising the shape is what keeps catching them

Seven instances so far. Six share one signature — **the check reports success
while verifying nothing** — and the seventh is that signature inverted.

```
1  a ONE-SIDED timing ratio          passed while the timing was backwards
2  the "EPA" ingredient-join test    passed with the join DELETED
3  a session-exclusion ternary       both branches identical — a fake toggle
4  page=2 as "past the end"          asserted totalPages === 1; a real page 2
                                     would have kept it green after a bump
5  the badge-only card-height fix    would have looked done at 386 vs 406
6  a pipe swallowing an exit code    BUILD_OK over a failed build
7  a page-wide "gummy" screen        flagged ALL EIGHT candidates by
                                     matching the site's global nav
```

🔴 **INSTANCE 7 IS THE MIRROR IMAGE, and it belongs in the same family.** The
first six report SUCCESS while verifying nothing. The gummy screen reported
**FAILURE** while verifying nothing — it searched the whole page for
`סוכריות|גאמיס|גומי`, matched the site's global navigation, and rejected every
candidate including five that were plainly capsules.

⚠️ **A screen that rejects everything reads as diligence**, which is exactly why
it is dangerous: an over-eager filter looks like caution and quietly costs real
candidates. Had it been trusted, batch 5 would have found "no viable products"
and the conclusion would have been recorded as a sourcing constraint. Same root
as the other six — **the check was never confronted with a case whose answer was
already known.**

```
🔴 A SCREEN NEEDS BOTH CONTROLS, not just one:
   feed it something that MUST pass and something that MUST fail.
   All-pass and all-reject are equally strong evidence of a broken
   check, and neither looks like an error.
```

**None of the first six fail loudly; every one of them passes. The seventh
never passes.** Both shapes come from one root, and the counter-move is the
same:

```
🔴 BREAK IT ON PURPOSE AND CONFIRM IT GOES RED.
   Mutation-test the assertion, not just the code.
   A test that has never failed has never been shown to test anything.
```

Instances 2, 4 and 5 were caught exactly that way, and instance 6 by checking
an exit code that had been assumed. Assume any new guarantee is in this family
until it has been seen to fail.

## 🔴 A SECOND FAMILY — the check whose ENVIRONMENT cannot represent the failure

> Added 2026-08-14, after MILESTONE-008 Checkpoint G, where it appeared four
> times in one milestone and the same defect was reintroduced TWICE after being
> fixed.

The family above is about assertions that verify nothing. This one is different
and it is worse, because the assertion is correct: **jsdom is not a browser, and
a green test can sit over code that is broken in Chromium.**

```
· `disabled` on a focused element makes a browser BLUR it. jsdom does not,
  so a test asserting "focus survives" passed against code that dropped it
· a class present in `classList` can still LOSE the cascade. jsdom sees the
  class; only a browser computes which rule wins
· `:focus-visible` does not match after a pointer interaction. jsdom models
  neither the pseudo-class nor the interaction that decides it
```

```
· an IMPURE setState UPDATER (a side effect inside the updater function) is
  double-invoked by dev StrictMode — the running app breaks while every
  jsdom test rendered WITHOUT StrictMode stays green. DEC-073's drawer
  never opened in the app: the updater stamped a session flag, and the
  second invocation read its own stamp and declined. Caught by the matrix,
  2026-08-14. Counter-move: decide before setState, and render hook tests
  under <StrictMode> like the real app
```

🔴 **THE COUNTER-MOVE IS NOT A BETTER ASSERTION — IT IS OPENING A BROWSER.**
Where jsdom cannot represent the failure, assert the *attribute* (which it can
see) and verify the *behaviour* in the matrix. Say so in the test, so the next
reader knows which half is covered where.

### 🔴 THE SPECIFIC SHAPE THIS PROJECT KEEPS SHIPPING

**A control that unmounts itself on success takes the user's focus with it.**

```
· a Retry button rendered only for `failed`      — pressing it unmounts it
· a confirm button inside a block that closes    — confirming unmounts it
· a panel gated on the condition its own action
  clears (count > 0, cleared by the repair)      — succeeding unmounts it
```

Every focus defect in MILESTONE-008 was this one shape. It is invisible to the
suite, and it was caught three times by a human reading the diff.

⚠️ **A PARTIAL SUCCESS OFTEN SURVIVES IT, WHICH IS WHY IT LOOKS FINE.** The
reconcile panel kept its report after a partial repair — the count stayed above
zero — and erased it only when the sweep fully succeeded. **The healthiest path
was the broken one.**

```
🔴 BEFORE SHIPPING ANY ASYNC CONTROL, ASK: after this succeeds, does the thing
   I just pressed still exist? If not, where does focus go, and who says so
   out loud? Keep it mounted (`aria-disabled`, never `disabled`), or move
   focus somewhere deliberate — and announce the outcome from a region that
   was ALREADY mounted.
```

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
