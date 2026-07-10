# Upgrading an existing install — instructions for a Claude Code session

You are upgrading a machine that **already has this harness installed** in `~/.claude/` and has
just pulled a newer version of this package. Fresh install instead? → `install_harness.md`.
The core danger this file exists to prevent: the installed files are **machine-personalized**
(filled Environment facts, edited model table, user-specific letter content), so a wholesale
`cp` of package files over them destroys that personalization and resurrects
`<!-- INSTALLER: … -->` comments and `{…}` placeholders — the exact landmines the install
verification treats as failures. Upgrades port hunks; they never blind-copy personalized files.

## Step 0 — Establish the delta

1. Confirm an install actually exists: `~/.claude/CLAUDE.md` has the routing table and
   `~/.claude/docs/` has the six numbered docs. If not, stop — this is a fresh install.
2. Find the installed baseline commit: look in `~/.claude/docs/50-letter-to-future-sessions.md`
   § Handoff for the most recent `package commit: <hash>` marker.
   - **Marker found:** the upstream changes are exactly
     `git diff <hash>..HEAD -- home-claude/ hooks.json optional-hooks.md` (run in the package
     directory). Work from this diff; do not re-derive it by eyeballing whole files.
   - **No marker (older install):** fall back to content comparison — for each package file,
     `diff` it against its installed counterpart. Every difference is either upstream change or
     local personalization; classify with the Step 1 table, and when a hunk could be either,
     show the user both versions instead of guessing.
3. Back up every installed file you are about to touch:
   `~/.claude/backups/<name>.bak-<YYYY-MM-DD-HHMMSS>` (invariant 3).

## Step 1 — Classify each file the diff touches

| File | Class | Upgrade action |
|---|---|---|
| `docs/00-harness-diagnosis.md`, `docs/20-judgment-rubrics.md`, `docs/40-maintenance-protocol.md` | generic, but MAY carry local edits (measured evidence bullets, lessons) | copy whole file ONLY if `diff` shows the installed copy has zero local-only changes; any local change demotes it to hunk-porting |
| `docs/30-delegation-templates.md` | generic except the worked example (self-replacing, machine-specific) | port hunks; keep the local worked example |
| `~/.claude/CLAUDE.md` | personalized (Environment facts, merged user content) | **port hunks only — never copy** |
| `docs/10-model-dispatch.md` | personalized (model table per cost preference, `fable` row, verified date) | **port hunks only — never copy** |
| `docs/50-letter-to-future-sessions.md` | personalized (Three things, append-only Handoff) | **port hunks only; never overwrite the Handoff** |
| `agents/*.md` | frontmatter may be personalized (`model:` under budget preference, `effort:` downgrades) | port body hunks; if upstream changed a frontmatter key the install also changed, show the user both — don't pick silently |
| `hooks.json` (→ user's `settings.json`) | mechanism, idempotent | if the diff touches it and the user has the hooks installed: back up `settings.json`, then follow `optional-hooks.md`'s removal + re-merge (verified re-runnable without duplicates) |

Rule of thumb: **one local-only change demotes the whole file from copy to hunk-porting.**
When porting, apply upstream hunks with `Edit`-level precision; if an upstream hunk overlaps a
personalized region, stop and show the user both versions — never pick a winner silently.
Never reintroduce an `<!-- INSTALLER: … -->` comment or a `{…}` placeholder into an installed
file: if an upstream hunk contains one, it marks a NEW personalization point — fill it from
this machine's verified facts (per `install_harness.md` Step 3) as part of the same upgrade,
asking the user where the fill needs their input (e.g. a new interview question they never
answered).

## Step 2 — Verify (re-run the install checks)

1. `grep -rn 'INSTALLER:' ~/.claude/CLAUDE.md ~/.claude/docs/10-model-dispatch.md ~/.claude/docs/50-letter-to-future-sessions.md`
   → must return zero hits; no unfilled `{…}` bullets in CLAUDE.md's Environment facts or in
   `50-letter-to-future-sessions.md`.
2. Every routing-table target in `~/.claude/CLAUDE.md` exists on disk.
3. If hooks were re-merged: `jq . ~/.claude/settings.json` is valid, and each installed hook
   command is byte-identical to the package's `hooks.json` (extract with jq and `cmp` — do not
   eyeball).
4. Read back each ported hunk in place and confirm it says what the upstream version says.

## Step 3 — Record

Append a Handoff entry to `~/.claude/docs/50-letter-to-future-sessions.md` (newest first):
date, `upgraded fable5_harness <old-hash> → <new-hash>` (or "no baseline marker; content-diff
upgrade" for old installs), files touched with a one-line hunk summary each, anything shown to
the user and how they decided, and the new baseline: `package commit: <new HEAD hash>`.

If anything in this procedure is ambiguous on this machine, stop and show the user what you
see — a wrong merge into doctrine is worse than a delayed upgrade.
