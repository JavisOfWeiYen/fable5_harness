# Harness Diagnosis — where this environment leaks tokens, loses focus, and makes errors

Written 2026-07-06 by a Claude Fable 5 session, from direct inspection of the original
author's machine. The three numbered findings are **general** — they describe how nearly any
Claude Code setup leaks tokens and overclaims completion — and all later docs (10–50) assume
them. If you fix a root cause here, update this file (see 40-maintenance-protocol.md).

Evidence measured in the original environment (illustrative; the sizes will differ on this
machine but the mechanism won't):

- One frequently-edited 125 KB single-file web app: a single full `Read` cost ~30–40k tokens.
- Screenshots used for visual verification were 200–800 KB PNGs; reading one into context
  costs thousands of tokens.
- There was **no CLAUDE.md at any level** (global or project); all conventions lived in
  auto-memory, which is per-project and recall-based.

---

## Finding 1 — The main context does groundwork inline (worst token leak, and the main cause of focus loss)

**Symptom.** The main conversation itself reads whole large files, loads screenshots, and runs
iterate-observe loops (e.g. tune a visual parameter → screenshot → read screenshot → tune again).
Two or three full reads of a large file plus a few screenshots forces context compaction.
After compaction the session works from a lossy summary — this is exactly when it forgets
constraints stated earlier ("don't re-add that feature I removed") and repeats work.

**Why it matters more for smaller models.** They recover from lossy summaries worse than a
frontier model does, and they are less likely to notice they've lost state.

**Fix (mechanical rules, enforced via CLAUDE.md):**
1. The main context never `Read`s more than ~300 lines of a file it hasn't been directed to a
   specific range of. To locate code, dispatch an `Explore` agent; to understand a subsystem,
   dispatch a reader agent that returns conclusions + `file:line` references only.
2. Never load a screenshot into the main context to "check how it looks" more than once per
   task. Visual iterate-observe loops go to a subagent that loops internally and reports back
   a verdict + the final screenshot path.
3. Batch edits across many files → one subagent per coherent chunk, main context receives a
   change summary, not diffs.
4. Details of who to dispatch and how: `10-model-dispatch.md`, templates in `30-delegation-templates.md`.

## Finding 2 — No persistent doctrine: every session re-derived the basics

**Symptom.** With no CLAUDE.md anywhere, each session re-discovered how to run the project,
how to verify changes, and what the user's standing preferences are. Auto-memory partially covers
this **for one project only** and is recall-based (a memory that isn't recalled might as well
not exist). Corrections the user already made (e.g. "verify in the browser, don't just reason")
had to be re-learned as memory entries after failures, instead of being standing doctrine.

**Fix:** the file set created 2026-07-06 — a slim global `~/.claude/CLAUDE.md` router plus
`~/.claude/docs/*.md`. Division of labor from now on:
- **Doctrine** (how to work, dispatch, verify, judge) → `~/.claude/docs/`, routed from CLAUDE.md. Global, always loadable.
- **Volatile project facts** (backlogs, tuning telemetry, project quirks) → auto-memory, per project.
- Never duplicate one into the other; a fact stored twice will rot in one place.

## Finding 3 — "Done" was defined by the doer's own claim (worst error source)

**Symptom.** Work was declared complete on the strength of the model's own reasoning
("the code looks right"). In the original environment the saved memories were the scar
tissue: one existed solely because the user had to correct "drive the app in the browser to
verify, don't just reason"; another because an explicitly removed feature got re-added by a
later session. A model reviewing its own
work in the same context inherits all of its own blind spots.

**Why it matters more for smaller models.** Overclaiming completion is strongly
model-size-correlated. This is the single highest-risk behavior to guard against.

**Fix (the verification contract — full rubric in `20-judgment-rubrics.md`):**
1. "Done" requires evidence produced by execution, not by reasoning: a test run, a real
   browser drive (with whatever driver this machine has — see CLAUDE.md Environment facts),
   a read-back of a written file, or a screenshot of actual rendered output.
2. Acceptance checks for delegated work are performed by a **fresh-context** agent that did not
   do the work, given only the acceptance criteria (never the doer's chat log).
3. High-risk or taste-based judgments get a second opinion (independent agent) or go to the
   user — see the escalation rules in `20-judgment-rubrics.md`.

---

## Honorable mentions (real, but below the top three)

- **Slow or cross-boundary filesystems** (WSL2 `/mnt/c` mounts, network drives, container
  volumes) make `npm`, browser drivers, and anything that stats many files crawl. If this
  machine has one (see CLAUDE.md Environment facts), run heavy tooling on the fast side and
  copy artifacts back — and don't diagnose "hanging" tools before considering this.
- **Model config drift.** A model pinned in `~/.claude/settings.json` goes stale when models
  are retired or renamed. If sessions error on model selection, check that file first.

## Honest limits (per the founding instructions' honesty clause)

Process can compensate for execution quality — decomposition, fresh-context verification,
multi-sample judging all work at Sonnet scale. Process **cannot** compensate for taste and
ambiguous judgment (visual design calls, "which of these two decent architectures", tone of
writing). When a task is taste-shaped: generate 2–3 genuinely different options, present them
to the user with screenshots/samples, and let the user pick. Do not have a model of any size
pick silently. See `20-judgment-rubrics.md` § Taste-shaped work.
