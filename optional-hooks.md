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

**Requirements:** `jq` on PATH. The commands are POSIX sh, run by Claude Code under `sh -c`
(Linux/macOS/WSL). The `"Task|Agent"` matcher covers both the pre-v2.1.63 tool name (`Task`)
and the current one (`Agent`). Format verified against the official hooks reference 2026-07-06.

## Install (done by the installing session at install_harness.md Step 3.6)

1. Back up `~/.claude/settings.json` per Step 0.3 naming (create the file as `{}` if missing).
2. Merge the `hooks` key below into it — merge, don't overwrite existing hooks the user may have.
3. Verify: `jq . ~/.claude/settings.json` exits 0. Current Claude Code versions pick up
   settings-file hook edits automatically; no restart needed.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Task|Agent",
        "hooks": [
          {
            "type": "command",
            "command": "sid=$(jq -r .session_id); m=\"${TMPDIR:-/tmp}/claude-doctrine-dispatch-$sid\"; [ -e \"$m\" ] && exit 0; touch \"$m\"; printf '%s' '{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"additionalContext\":\"Doctrine reminder (once per session, first subagent spawn): if you have not read ~/.claude/docs/10-model-dispatch.md this session, Read it before dispatching. Model choice is explicit; the delegation prompt carries goal, acceptance criteria, and report format; substantive work gets a fresh-context verifier afterward.\"}}'"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "in=$(cat); [ \"$(printf '%s' \"$in\" | jq -r .stop_hook_active)\" = \"true\" ] && exit 0; sid=$(printf '%s' \"$in\" | jq -r .session_id); m=\"${TMPDIR:-/tmp}/claude-doctrine-stop-$sid\"; [ -e \"$m\" ] && exit 0; touch \"$m\"; printf '%s' '{\"decision\":\"block\",\"reason\":\"Doctrine check (once per session): if this turn claimed work is done, confirm it meets ~/.claude/docs/20-judgment-rubrics.md section 2 — executed evidence, fresh-context check for substantive work, likeliest regression checked, reported plainly. If the turn made no completion claim, or the evidence is already stated, end the turn now.\"}'"
          }
        ]
      }
    ]
  }
}
```

## Behavior notes

- The PreToolUse hook never blocks the spawn: exit 0 + `additionalContext` only injects text.
- The Stop hook blocks turn-end **once** per session; `stop_hook_active` guarantees the very
  next stop passes, so it cannot loop.
- Marker files live in `${TMPDIR:-/tmp}` and are keyed to the session id — they clean up with
  the OS temp dir and never collide across sessions.

## Remove

Delete the two entries from the `hooks` key in `~/.claude/settings.json` (or restore the
Step 0.3 backup). Setting `"disableAllHooks": true` disables every hook without editing them.
