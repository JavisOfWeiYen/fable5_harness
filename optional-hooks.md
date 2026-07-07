# Optional enforcement hooks

The doctrine's own letter (`home-claude/docs/50-letter-to-future-sessions.md`, Decay 1) names
its most likely failure mode: sessions skim CLAUDE.md and act without reading the routed doc.
These two hooks convert the two highest-value routing triggers from voluntary compliance into
mechanism. Each fires **once per session** (marker file keyed to the session id), so the cost
is two short reminders per session, not a nag on every action.

- **PreToolUse on subagent spawn** — before the session's *first* delegation, injects a
  reminder to read `10-model-dispatch.md` (explicit model choice; goal/acceptance/report in the
  prompt; fresh-context verifier afterward).
- **Stop** — before the session's *first* turn-end, injects the done-rubric check from
  `20-judgment-rubrics.md` § 2 (executed evidence, fresh-context check, regression, plain report).

**Requirements:** `jq` on PATH — but both commands open with a `command -v jq` guard, so on a
machine without jq they exit 0 silently and the reminders simply don't fire; nothing errors or
blocks. The commands are POSIX sh, run by Claude Code under `sh -c` (Linux/macOS/WSL) — native
(non-WSL) Windows is out of scope; do not install these there, run the harness from WSL instead.
The `"Task|Agent"` matcher covers both the pre-v2.1.63 tool name (`Task`)
and the current one (`Agent`). Format verified against the official hooks reference 2026-07-06.

## Install (done by the installing session at install_harness.md Step 3, item 6)

The hook definitions live in the package file **`hooks.json`** (next to this file), so the
installing session merges from that file instead of hand-transcribing a large escaped-JSON blob.

> **`hooks.json` is a template — never copy it over `~/.claude/settings.json`.** Doing so would
> wipe the user's existing settings (permissions, env, other hooks). Only ever *merge* it in,
> using the append-safe command below.

1. Back up `~/.claude/settings.json` per Step 0.3 naming (create the file as `{}` if missing).
2. Merge — **append**, don't overwrite. Plain `jq '.[0] * .[1]'` is unsafe here: `*` replaces
   same-named arrays, so it would clobber any `hooks.PreToolUse` / `hooks.Stop` the user already
   has. Use this append-safe merge (from the package dir, so `hooks.json` resolves):

   ```bash
   tmp="$(mktemp)"
   jq -s '
     .[0] as $base
     | .[1] as $add
     | $base
     | .hooks.PreToolUse = ((.hooks.PreToolUse // []) + ($add.hooks.PreToolUse // []))
     | .hooks.Stop       = ((.hooks.Stop // [])       + ($add.hooks.Stop // []))
   ' ~/.claude/settings.json hooks.json > "$tmp" &&
   mv "$tmp" ~/.claude/settings.json &&
   jq . ~/.claude/settings.json
   ```

   This appends the two package hooks to whatever the user already had. If you are **re-running**
   an install (the two doctrine entries may already be present), run this removal FIRST so you
   don't append duplicates — it drops only entries carrying this package's `claude-doctrine-`
   marker and leaves the user's own hooks untouched, then re-run the merge above:

   ```bash
   tmp="$(mktemp)"
   jq '
     def mine: [.hooks[]?.command // "" | contains("claude-doctrine-")] | any;
     .hooks.PreToolUse = ((.hooks.PreToolUse // []) | map(select(mine|not)))
     | .hooks.Stop     = ((.hooks.Stop // [])       | map(select(mine|not)))
   ' ~/.claude/settings.json > "$tmp" &&
   mv "$tmp" ~/.claude/settings.json
   ```
3. Verify: the final `jq .` above exits 0. Current Claude Code versions pick up settings-file
   hook edits automatically; no restart needed.

## Behavior notes

- The PreToolUse hook never blocks the spawn: exit 0 + `additionalContext` only injects text.
- The Stop hook blocks turn-end **once** per session; `stop_hook_active` guarantees the very
  next stop passes, so it cannot loop.
- Marker files live in `${TMPDIR:-/tmp}` and are keyed to the session id — they clean up with
  the OS temp dir and never collide across sessions.

## Remove

Delete the two entries from the `hooks` key in `~/.claude/settings.json` (or restore the
Step 0.3 backup). Setting `"disableAllHooks": true` disables every hook without editing them.
