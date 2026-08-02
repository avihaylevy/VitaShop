# AGENTS.md — VitaShop

> Bootstrap file for Codex. Lives at **the code repository root**. Codex loads it automatically by this exact filename.
> The full procedures live in the memory system — not here.

---

## 🔴 Read first

C:\Users\aviha\תכנות\זיכרון AI\פרוייקט ECOMMERCE\פרוייקט Ecommerce\VitaShop-Project\00_INDEX.md




---

## 🔴 You operate in one of two modes. The user picks. You never pick.

| Mode | Triggered by | What you do |
|---|---|---|
| **REVIEW** | Default. "review", "scan", "check", "audit", "בדוק", "סרוק" | Find and fix bugs and security problems. **Do not add features** |
| **BUILD** | **Explicit request only.** "continue the plan", "implement TASK-XXX", "תמשיך מאיפה שקלוד עצר", "תבנה את X" | Continue the work plan as the lead developer. **Full development authority** |

```
Ambiguous request → assume REVIEW and ask
Never switch mode mid-session unasked
🔴 State the mode at the top of every reply:
   "Mode: REVIEW"  or  "Mode: BUILD — TASK-XXX"
```

**Why BUILD exists:** the user's Claude Code tokens run out. You must be able to pick the project up mid-flight without the memory system losing coherence. The mode is explicit so a review request never silently becomes feature work.

---

## Reading order — both modes

```
1. 00_INDEX.md
2. operations/LOCK.md              ← is Claude working right now? if so, stop
3. operations/CURRENT_TASK.md      ← the active task
4. operations/STATUS.md            ← what actually exists
5. operations/DECISIONS.md         ← do not contradict a decision
6. operations/ISSUES.md            ← already known; do not duplicate
7. agents/CODEX_WORKFLOW.md        ← 🔴 the full procedure for both modes

Then, by mode:
   REVIEW → quality/SECURITY_PRIVACY.md + quality/SECRETS_AND_KEYS.md
   BUILD  → agents/CLAUDE_WORKFLOW.md + the task's requirement files
```

---

## BUILD mode — resuming from Claude

```
1. operations/CURRENT_TASK.md      → what is active
2. operations/SESSION_LOG.md       → the last entry: what changed, what is next
3. operations/STATUS.md            → what genuinely works
4. git log --oneline -20           → the real last state of the code
5. git status                      → anything left uncommitted mid-change?
6. Take the lock in operations/LOCK.md
7. Continue
```

⚠️ **Dirty `git status` means the previous session ended mid-change.** Understand what was in progress first.
⚠️ **If `STATUS.md` and the code disagree, the code wins** — and record the discrepancy in `operations/ISSUES.md`.

🔴 **In BUILD mode you are bound by `agents/CLAUDE_WORKFLOW.md` in full** — the same iron rules, the same gates, the same after-work updates.

---

## REVIEW mode — the central rule

🔴 **Codex fixes. Codex does not add.**

**The test:** *"Does this change alter **what** the system does, or only **how**?"*
Alters **what** → 🛑 open an `ISSUE` and stop. Alters **how** → permitted, if it is a fix.

If a fix needs a new feature, a schema change, or an architectural decision — report it, or ask the user to switch you to BUILD.

---

## 🔴 Prohibitions — both modes

```
❌ Selecting your own mode
❌ Adding a dependency without approval
❌ Changing architecture or the DB schema without approval
❌ Touching sources/
❌ Writing without registering in operations/LOCK.md
❌ Obtaining, generating or configuring an API key — DEC-014
❌ Switching off MockProvider without asking
❌ Invoking a design skill before design/DESIGN_BRIEF.md is approved — DEC-015
❌ Approving your own decision as Accepted
```

⚠️ **A lock is also required for writing to `ISSUES.md`, `STATUS.md`, `CURRENT_TASK.md`, `DECISIONS.md`, `SESSION_LOG.md`.** Both agents write to those files.

---

## Governing principle

The specification, §3.4:

> "All price calculation, stock checking, and permission verification happen on the server side only.
> The client is not a source of truth and does not authorise an action itself."

🔴 **Any violation is `Critical`. Fixed before anything else, in either mode.**

---

## The eight checks that matter most

Full checklists in `quality/SECURITY_PRIVACY.md` and `quality/SECRETS_AND_KEYS.md`. In BUILD mode, run these against your own work before committing.

| # | Check | Requirement |
|---|---|---|
| 1 | **IDOR** — every private resource verifies **ownership**, not just authentication | ROLES |
| 2 | Every `/api/admin/*` checks role **server-side**, read from the database | ROLES |
| 3 | The client never sends a price. The server computes it | §3.4 |
| 4 | The final pre-payment check **halts** and requires confirmation; `/pay` **re-verifies** | REQ-F-042 |
| 5 | The confirmation email is sent **after** the commit, outside the transaction | INV-04 |
| 6 | Agent products come from the database; facts render from server data, not LLM prose | REQ-F-073 |
| 7 | 🔴 No API key in code or git history. `.env` ignored. No secret behind a `VITE_` name | DEC-014 |
| 8 | Warnings and allergens are never empty on a product | Table 1, field 12 |

---

## 🚩 Red flags

```
🚩 A price or amount arriving from req.body
🚩 role / isAdmin from req.body or a header
🚩 A private-resource query with no ownership check (IDOR)
🚩 DELETE on Product or Order
🚩 A string that looks like an API key
🚩 console.log containing token / password / key
🚩 $queryRawUnsafe / $executeRawUnsafe with user input
🚩 dangerouslySetInnerHTML with user content
🚩 Hardcoded Hebrew or English text in JSX
🚩 ml- / mr- / pl- / pr- / text-left / text-right in Tailwind
🚩 FLOAT or Number for a monetary field
🚩 A provider SDK imported outside its own implementation file
🚩 A name / email / user id in a prompt sent to an external provider
🚩 An empty catch swallowing an error
🚩 A public endpoint writing to the database with no rate limit
🚩 An external call (email, AI) inside an open DB transaction
🚩 status = 'locked' on a user — locked_until is the only source of truth
🚩 A secret behind a VITE_ variable name
🚩 An empty warnings_allergens field on a product
```

---

## Reporting

In `operations/ISSUES.md`:

```markdown
### ISSUE-0XX — [title]
Severity: Critical | High | Medium | Low
Type:     Security | Bug | Consistency | Test gap
File:     path/to/file.ts:LINE
Rule:     the rule violated
Status:   Open | Fixed

**Description:** what the problem is
**Impact:** what could happen
**Fix:** the proposed fix
```

---

## Communication

**English only.** All replies, questions, summaries, commit messages and code comments are written in English.

🔴 **Never reply in Hebrew.** The user's terminal does not render right-to-left text — Hebrew output appears reversed and unreadable. This is a hard requirement, not a preference.

Hebrew is still used for **data**: product names, category names, order statuses, UI strings in translation files, and the medical disclaimer. Those are values, not prose.

Direct, no flattery, no preambles. Unsure → say "not sure". Found a contradiction → point at it.

**🔴 Always open with the mode.**

```
Mode: REVIEW
Scanned: [what] · Found: X Critical, Y High, Z Medium
Fixed: [what] · Needs a decision: [what + ISSUE]
```

```
Mode: BUILD — TASK-XXX
Done: [what] · Tested: [what, how]
Remaining: [what] · Next: [TASK-YYY or a blocking question]
```

---

---

## 🔴 Session close — the trigger phrase

When the user types **`סגור סשן`** (or "close session", "עדכן זיכרון"), run this checklist in full before replying:

```
1. operations/SESSION_LOG.md   → new entry, written for a reader with ZERO context
                                  what was done · what changed · what is half-finished · what is next
2. operations/STATUS.md        → what actually works now (tested, not written)
3. operations/CURRENT_TASK.md  → advanced, or the blocker recorded
4. operations/ROADMAP.md       → tick any checkbox that moved
5. operations/ISSUES.md        → anything found along the way
6. operations/DECISIONS.md     → only if the user approved a decision
7. operations/LOCK.md          → released
8. Report back: what was updated, and what the next agent should pick up
```

🔴 **"Continued working on the cart" is a useless log entry.**
Write: *"Implemented `POST /api/cart/items` with server-side stock clamping. `PATCH` not written. TEST-022 not run. Next: the PATCH handler."*

**Also run this checklist whenever:**
- The user says they are stopping, running low on budget, or switching agents
- You are about to hit a context limit
- A task completes

⚠️ **Do not wait to be asked if the session is clearly ending.** The log is the only thing connecting one session to the next.

---

Last updated: 2026-08-01
