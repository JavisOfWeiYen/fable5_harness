# Install instructions — read this if you are a Claude Code session

You (likely Opus- or Sonnet-class) have been asked to install the "Fable 5 harness": a set of
operating-doctrine files originally written on 2026-07-06 by a Claude Fable 5 session for
another user's environment, then adversarially reviewed and fixed. The package ships
**pre-generalized**: environment-specific content has been replaced by `{…}` placeholder
bullets and `<!-- INSTALLER: … -->` comments. Your job is to install it, fill every
placeholder with facts you *verified on this machine*, and verify the result. Follow these
steps in order. An unfilled placeholder is annoying but harmless; a guessed "fact" is worse
than none — inspect, never guess.

## What this package contains

```
fable5_harness/
  CLAUDE.md                 ← package-root BOOTSTRAP only (auto-loads when a session opens
                              here, points you at this file). DO NOT install/copy it.
  install_harness.md        ← this file
  README.md                 ← human-readable overview (Traditional Chinese)
  home-claude/              ← mirrors what goes under ~/.claude/
    CLAUDE.md               ← the global router that DOES get installed to ~/.claude/CLAUDE.md
                              (5 routing triggers + 5 invariants)
    docs/00-harness-diagnosis.md      ← why these rules exist (3 root-cause findings)
    docs/10-model-dispatch.md         ← how to delegate: models, escalation ladder, verification
    docs/20-judgment-rubrics.md       ← escalate / done / ask-user / wrong-direction rubrics
    docs/30-delegation-templates.md   ← 5 fill-in delegation prompt templates
    docs/40-maintenance-protocol.md   ← how future sessions may edit these files safely
    docs/50-letter-to-future-sessions.md  ← degradation modes + handoff log
    agents/verifier.md      ← custom fresh-context acceptance-checker agent (opus, effort high)
    agents/implementer.md   ← doer for well-specified build/refactor tasks (opus, effort high)
    agents/hard-solver.md   ← last-resort deep reasoning for the hardest subtask (opus, effort max)
```

The design intent, in one line: the main conversation acts as a commander that delegates
groundwork to subagents, "done" always requires executed evidence checked by a fresh-context
verifier, and every judgment call a small model tends to fumble is written down as a rubric.

## Step 0 — Preflight (do this before copying anything)

1. Check what already exists: `~/.claude/CLAUDE.md`, `~/.claude/docs/`, `~/.claude/agents/`.
2. If `~/.claude/CLAUDE.md` already exists, you will **merge, not overwrite** (Step 2).
   If any `docs/` filename collides, stop and ask the user how to resolve it.
3. Create `~/.claude/backups/` if missing, and back up every file you are about to touch as
   `~/.claude/backups/<name>.bak-<YYYY-MM-DD-HHMM>`.
4. Ask the user this one batch of questions (then proceed autonomously):
   - Cost preference: quality-first (default model `opus` for substantive delegation — the
     package default), balanced (`sonnet` default, `opus` for hard/critical), or budget?
   - Main use cases (so examples and rubrics get read in the right spirit)?
   - Response language preference?
   - Fable 5 access: does this machine have it? If yes, `fable` stays as the top dispatch tier
     above `opus`; if no (the common case), the `fable` row is removed and `opus` is the top
     tier. Either way the escalation prose already covers it — see Step 3. Do not assume; ask.

## Step 1 — Copy files

From this package directory:

```bash
mkdir -p ~/.claude/docs ~/.claude/agents ~/.claude/backups
cp home-claude/docs/*.md ~/.claude/docs/
cp home-claude/agents/*.md ~/.claude/agents/   # verifier + implementer + hard-solver

# CLAUDE.md — CONDITIONAL, do NOT run blindly:
#   - If ~/.claude/CLAUDE.md does NOT exist → copy it:
#       cp home-claude/CLAUDE.md ~/.claude/CLAUDE.md
#   - If it ALREADY exists → do NOT copy (that would overwrite the user's file).
#     Go to Step 2 and MERGE instead.
```

## Step 2 — Merge (only if the user already had a `~/.claude/CLAUDE.md`)

Keep the user's existing content. Append from the package version: the **routing table** and
the **five invariants**, adjusting paths if needed. If any existing rule contradicts a package
invariant, do not silently pick a winner — show the user both and ask. Keep the merged file
under ~70 lines; if the user's existing content is long, propose moving it into a doc and
routing to it.

## Step 3 — Fill the placeholders (mandatory)

Every fill must come from *inspecting this machine* (run commands, read files — don't guess).
Delete each `<!-- INSTALLER: … -->` comment once its section is filled; the comments' absence
is how Step 4 verifies completion.

1. **`CLAUDE.md` § Environment facts** — fill the `{…}` bullets: OS/filesystem quirks (check
   for WSL2 mounts, network drives, containers), which verification tooling is actually
   installed (try to run it before claiming it), the user's response language (from Step 0).
2. **`docs/10-model-dispatch.md` § Model table** — verify the model aliases/IDs are still
   current *in this harness* (your own system prompt lists them; or ask a `claude-code-guide`
   agent). Apply the user's cost preference from Step 0: the shipped default is
   quality-first (`opus` for substantive work). Update the "verified YYYY-MM-DD" date.
   **Fable 5 toggle (from Step 0):** if the user has NO Fable 5 access, delete the `fable` row
   from the model table — the § 5 escalation prose already reads correctly with `opus` as the
   top tier, so no other edit is needed. If they DO have it, keep the row and confirm its ID.
   **Opus performance:** to get the most out of Opus on hard work, prefer high `effort` for
   substantive delegated agents (pinned via an agent definition file — `verifier` already ships
   at high). The main session's effort is the user's own Claude Code setting, not something
   these files control — recommend running it high for this quality-first setup. Verify the
   available effort levels for this Opus build (don't assume from memory).
3. **`docs/50-letter-to-future-sessions.md`** — write § "Three things" for this user following
   the embedded INSTALLER comment (verified observations from this install, not guesses), and
   replace the § Handoff template entry with your real install entry.
4. Optional, cheap wins if the information is at hand: replace the illustrative evidence
   bullets in `docs/00-harness-diagnosis.md` with locally measured ones (e.g. this user's
   largest frequently-edited file and its token cost); the worked example in
   `docs/30-delegation-templates.md` is self-replacing later (see its INSTALLER comment).
5. Do **not** edit the rules, rubrics, or `agents/verifier.md` — they are
   environment-independent by design.

## Step 4 — Verify (executed evidence, per the doctrine you just installed)

1. Read back every installed file; confirm each routing-table target in `~/.claude/CLAUDE.md`
   exists on disk.
2. Confirm personalization happened: run
   `grep -rn 'INSTALLER:' ~/.claude/CLAUDE.md ~/.claude/docs/10-model-dispatch.md ~/.claude/docs/50-letter-to-future-sessions.md`
   — it must return **zero hits**. (These are the mandatory files; the optional comment in
   `30-delegation-templates.md` may remain, so it is deliberately excluded from this grep.)
   Also confirm CLAUDE.md's Environment facts section contains no unfilled `{…}` bullets.
3. The `verifier` agent type registers at **session start** — it will not be spawnable in this
   installing session if `~/.claude/agents/` was just created. Tell the user: restart Claude
   Code, then in the new session spawn `verifier` on a trivial check to confirm it works
   (fallback if it ever fails: `general-purpose` + the text of `agents/verifier.md`, as
   documented in `docs/10-model-dispatch.md` § 6).
4. Report to the user: files installed, what you personalized, backup locations, and the one
   pending item (verifier spawn test after restart).

## After install — how the user works with it

Nothing to invoke manually. `~/.claude/CLAUDE.md` auto-loads into every session; its routing
table sends sessions to the right doc when a trigger fires. To evolve the rules later, sessions
must follow `docs/40-maintenance-protocol.md` (backup first; facts may be self-corrected when
verified; rules and thresholds change only with user approval).
