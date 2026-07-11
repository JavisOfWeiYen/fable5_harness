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
  optional-hooks.md         ← once-per-session doctrine reminder hooks (optional; asked at Step 0,
                              merged into ~/.claude/settings.json at Step 3, item 6)
  hooks.json                ← hook template merged by optional-hooks.md; never copy over
                              ~/.claude/settings.json (merge only, or you wipe the user's settings)
  optional-git-fastpath.md  ← git fast-path guard (optional; separate opt-in at Step 0,
                              merged into ~/.claude/settings.json at Step 3, item 6a)
  git-fastpath.json         ← permissions + PreToolUse guard fragment merged by
                              optional-git-fastpath.md; merge only, never copy over settings.json
  home-claude/              ← mirrors what goes under ~/.claude/
    CLAUDE.md               ← the global router that DOES get installed to ~/.claude/CLAUDE.md
                              (5 routing triggers + 6 invariants)
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
   If any `docs/` or `agents/` filename collides with an existing file, stop and ask the user
   how to resolve it — Step 1's copy must never silently overwrite a user's own agent or doc.
3. Create `~/.claude/backups/` if missing, and back up every file you are about to touch as
   `~/.claude/backups/<name>.bak-<YYYY-MM-DD-HHMMSS>` (seconds included — several install
   steps back up the same file minutes or seconds apart, and each snapshot must survive).
4. Ask the user this one batch of questions (then proceed autonomously):
   - Cost preference: quality-first (default model `opus` for substantive delegation — the
     package default), balanced (`sonnet` default, `opus` for hard/critical), or budget
     (`sonnet` for both doing and verifying; `opus` held in reserve for the escalation
     ladder)? Each answer maps to concrete edits in Step 3, item 2.
   - Main use cases (so examples and rubrics get read in the right spirit)?
   - Response language preference?
   - Interaction style: **full-autonomy** (the shipped default — Claude proceeds through
     reversible steps without checking in) or **checkpoint** (before any work expected to run
     more than a few minutes, Claude posts a short plan and waits for OK; reports one line
     between phases; leads replies with a short conclusion, long evidence goes to files)?
     Failures are reported in full under both styles. The answer fills the interaction-style
     bullet in Step 3, item 1; the behavioral definitions live in
     `docs/20-judgment-rubrics.md` § 3.
   - Fable 5 access: does this machine have it? If yes, `fable` stays as the top dispatch tier
     above `opus`; if no (the common case), the `fable` row is removed and `opus` is the top
     tier. Either way the escalation prose already covers it — see Step 3. Do not assume; ask.
   - Optional enforcement hooks: offer the once-per-session reminder hooks in
     `optional-hooks.md` — they mechanically re-inject the two highest-value triggers (read
     the dispatch doc before the first subagent spawn; check the done-rubric before the first
     turn-end of a session that actually did work — read-only Q&A sessions pay nothing). The hooks are POSIX sh + `jq`, supported only on
     WSL/macOS/Linux — on native (non-WSL) Windows, do not offer or install them; say so and
     suggest running the harness from WSL. The hooks need `jq` (`command -v jq`). If jq is missing,
     don't install them — tell the user the option exists and how to enable it (install jq,
     e.g. `sudo apt install jq` on Debian/Ubuntu, then re-run this step); never run the
     package-manager install yourself. If accepted and jq is present, install per Step 3, item 6.
     (The hook commands carry their own jq guard, so even installed-without-jq they no-op
     silently rather than error.)
   - Optional git fast-path guard (a **separate** opt-in — offer it independently of the
     reminder hooks above): the fragment in `optional-git-fastpath.md` / `git-fastpath.json`
     lets routine git run without a prompt (status/diff/log/add/commit/push) while forcing the
     Fast-path's destructive exceptions to still ask — permission `ask` rules plus a
     deterministic PreToolUse guard that catches a forced/destructive `git push`
     (`--force*`/`-f`/`-d`/`--delete`/`--mirror`/`--prune`/`+refspec`) in ANY argument position.
     The guard only ever answers "ask" (escalates to the human), never deny/allow. Same platform
     and `jq` constraints as the reminder hooks (POSIX sh + jq; WSL/macOS/Linux only; own jq
     guard so it no-ops without jq). If accepted, install per Step 3, item 6a; at that point you
     can also offer to add the user's protected-branch `ask` rules (personalization — see
     `optional-git-fastpath.md`). A user may take this and decline the reminder hooks, or vice
     versa.

## Step 1 — Copy files

From this package directory. **Precondition: only run the `cp` lines below after Step 0, item 2's
collision check passed.** If any `docs/` or `agents/` filename collides with a file the user
already has, do NOT run them — go back to Step 0, item 2, stop, and ask the user how to resolve it.
(Do not "fix" a collision with `cp -n`/no-clobber: that silently keeps the user's old file while
you believe the new one installed — the worst of both.)

```bash
mkdir -p ~/.claude/docs ~/.claude/agents ~/.claude/backups
# Run these two ONLY if Step 0, item 2 found no collisions (see precondition above):
cp home-claude/docs/*.md ~/.claude/docs/
cp home-claude/agents/*.md ~/.claude/agents/   # verifier + implementer + hard-solver

# CLAUDE.md — CONDITIONAL, do NOT run blindly:
#   - If ~/.claude/CLAUDE.md does NOT exist → copy it:
#       cp home-claude/CLAUDE.md ~/.claude/CLAUDE.md
#   - If it ALREADY exists → do NOT copy (that would overwrite the user's file).
#     Go to Step 2 and MERGE instead.
```

## Step 2 — Merge (only if the user already had a `~/.claude/CLAUDE.md`)

Keep the user's existing content. Append from the package version: the **routing table**, the
**six invariants**, and the **§ Environment facts section** (including its
`<!-- INSTALLER: … -->` comment — Step 3, item 1 fills that section and Step 4's grep checks the
comment was removed; several installed files reference "CLAUDE.md Environment facts", which
must not dangle). Adjust paths if needed. If any existing rule contradicts a package
invariant, do not silently pick a winner — show the user both and ask. Keep the merged file
under ~70 lines; if the user's existing content is long, propose moving it into a doc and
routing to it.

## Step 3 — Fill the placeholders (mandatory)

Every fill must come from *inspecting this machine* (run commands, read files — don't guess).
Delete each `<!-- INSTALLER: … -->` comment once its section is filled; the comments' absence
is how Step 4 verifies completion.

1. **`CLAUDE.md` § Environment facts** — fill the `{…}` bullets: OS/filesystem quirks (check
   for WSL2 mounts, network drives, containers), which verification tooling is actually
   installed (try to run it before claiming it), the user's response language (from Step 0),
   and the interaction style the user chose (from Step 0 — record `full-autonomy` or
   `checkpoint`, nothing else in that bullet; the definitions stay in
   `docs/20-judgment-rubrics.md` § 3).
2. **`docs/10-model-dispatch.md` § Model table** — verify the model aliases/IDs are still
   current *in this harness* (ask a `claude-code-guide` agent; your own system prompt
   typically lists only your own model's ID, so don't rely on it for the full table).
   **Apply the user's cost preference from Step 0** — and rewrite the "(user preference:
   quality over cost)" note in the `opus` row to the preference actually chosen:
   - *quality-first* (the shipped default): no table edit.
   - *balanced*: make `sonnet` the stated default for substantive work; `opus`'s Use-for
     becomes hard/critical tasks and `verifier` runs.
   - *budget*: as balanced, and additionally change `model: opus` to `model: sonnet` in
     `agents/implementer.md` and `agents/verifier.md`. Keep `hard-solver` on `opus` — the
     escalation ceiling is the last thing to trade away. Record these edits in the Handoff
     entry.
   For *balanced* or *budget*, also rewrite the phrase "for this quality-first setup" in the
   "Getting the most out of Opus" bullet to name the chosen preference (the high-effort
   advice itself stays valid and stays).
   Update the "verified YYYY-MM-DD" date.
   **Fable 5 toggle (from Step 0):** if the user has NO Fable 5 access, delete the `fable` row
   from the model table — the § 5 escalation prose already reads correctly with `opus` as the
   top tier, so no other edit is needed. If they DO have it, keep the row and confirm its ID.
   **Opus performance:** to get the most out of Opus on hard work, prefer high `effort` for
   substantive delegated agents (pinned via an agent definition file — `verifier` already ships
   at high). The main session's effort is the user's own Claude Code setting, not something
   these files control — recommend running it high (strongest fit under quality-first). Verify the
   available effort levels for this Opus build AND that agent-frontmatter `effort:` is
   honored at all (ask `claude-code-guide`; don't assume from memory). If a shipped level
   (e.g. `max`) is unsupported, edit that agent's `effort:` to the highest supported level;
   record any such edit in the Handoff entry.
3. **`docs/50-letter-to-future-sessions.md`** — write § "Three things" for this user following
   the embedded INSTALLER comment (verified observations from this install, not guesses), and
   replace the § Handoff template entry with your real install entry. Include in that Handoff entry the upgrade baseline: `package commit: <hash>` from
   `git rev-parse HEAD` run in this package directory — future upgrades diff from it (see
   `upgrade_harness.md`).
4. Optional, cheap wins if the information is at hand: replace the illustrative evidence
   bullets in `docs/00-harness-diagnosis.md` with locally measured ones (e.g. this user's
   largest frequently-edited file and its token cost); the worked example in
   `docs/30-delegation-templates.md` is self-replacing later (see its INSTALLER comment).
5. **Permission allowlist (recommended):** heavy delegation multiplies permission prompts,
   and a background agent stuck on a prompt stalls silently. With the user, add their common
   safe read-only and test/verification commands to the permissions allowlist in
   `~/.claude/settings.json` (if the file doesn't exist yet, create it first with
   `echo '{}' > ~/.claude/settings.json`; back it up first if it does exist — Step 0, item 3
   naming), so delegated verification can
   run unattended. Only allowlist commands the user confirms; never allowlist anything
   destructive. **Before adding anything, state the blast radius to the user in plain terms**,
   roughly: "keep this list conservative — only commands that are certainly read-only or
   idempotent; prefer a few extra permission prompts over allowlisting anything that writes,
   deletes, sends data out, or changes settings. And note the multiplier: this harness runs
   reversible steps without asking and fans out parallel background agents, so whatever is
   allowlisted here is what that whole fleet can do unattended." Prefer narrow patterns (a
   specific test command) over broad ones (a bare shell wildcard); the list lives in
   `~/.claude/settings.json`, easy to audit and trim later.
6. **Optional hooks (only if the user opted in at Step 0):** skip this item entirely on native
   (non-WSL) Windows — the hooks are POSIX sh + jq (already screened in Step 0's optional-hooks
   question). Otherwise
   follow `optional-hooks.md` —
   back up `~/.claude/settings.json` first (Step 0, item 3 naming), then run its **append-safe** merge
   command, which merges the package template `hooks.json` into the user's settings (plain
   `jq '.[0] * .[1]'` would clobber existing `hooks.PreToolUse`/`hooks.Stop`, so don't use it;
   never copy `hooks.json` over `settings.json` either). Finally confirm the result is valid JSON
   (`jq . ~/.claude/settings.json`).
6a. **Optional git fast-path guard (only if the user opted in at Step 0 — a separate choice from
   item 6):** skip entirely on native (non-WSL) Windows and if `jq` is absent (both screened at
   Step 0). Otherwise follow `optional-git-fastpath.md` — back up `~/.claude/settings.json`
   first (Step 0, item 3 naming), then run its **append-safe** merge, which unions the package
   fragment `git-fastpath.json` into the user's settings. **The same clobber caveat as item 6
   applies, and it applies to three arrays here:** plain `jq '.[0] * .[1]'` replaces same-named
   arrays, so it would wipe any existing `permissions.allow`, `permissions.ask`, or
   `hooks.PreToolUse` the user already has — never use it. The command in
   `optional-git-fastpath.md` appends/unions each of those three arrays, preserving whatever the
   user already had (and `unique` on the permission arrays keeps a re-run from duplicating
   rules). Never copy `git-fastpath.json` over `settings.json`. If the user named protected
   branches at Step 0, add their personal `ask` rules the same append-safe way (union into
   `permissions.ask`) — these stay in the user's settings, out of the generic fragment, per the
   personalization section of `optional-git-fastpath.md`. Finally confirm valid JSON
   (`jq . ~/.claude/settings.json`).
7. **API-retry cap (recommended):** Claude Code retries transient API errors (overloaded/529,
   timeouts) up to 10 times with exponential backoff — during a provider outage a single spawn
   can look stuck for ~30 minutes. Explain the trade-off to the user (fail fast during outages
   vs. more resilience on a genuinely flaky network) and, if they accept, cap it at 3: back up
   `~/.claude/settings.json` if it exists (Step 0, item 3 naming — it may not exist yet, e.g.
   when the user declined the hooks), then

   ```bash
   [ -f ~/.claude/settings.json ] || echo '{}' > ~/.claude/settings.json
   tmp="$(mktemp)"
   jq '.env.CLAUDE_CODE_MAX_RETRIES = "3"' ~/.claude/settings.json > "$tmp" &&
   mv "$tmp" ~/.claude/settings.json && jq . ~/.claude/settings.json
   ```

   This sets one key inside `env` — never replace the whole `env` object. Verify the key
   landed and the JSON is valid (the trailing `jq .`). Record the chosen value in the
   Handoff entry.
8. Do **not** edit the rules, rubrics, or the prompt bodies of the three `agents/*.md` files —
   they are environment-independent by design. The only agent edits allowed are the two
   frontmatter adjustments item 2 explicitly orders (cost-preference `model:`, unsupported
   `effort:` level), both recorded in the Handoff entry.

## Step 4 — Verify (executed evidence, per the doctrine you just installed)

1. Read back every installed file; confirm each routing-table target in `~/.claude/CLAUDE.md`
   exists on disk.
2. Confirm personalization happened: run
   `grep -rn 'INSTALLER:' ~/.claude/CLAUDE.md ~/.claude/docs/10-model-dispatch.md ~/.claude/docs/50-letter-to-future-sessions.md`
   — it must return **zero hits**. (These are the mandatory files; the optional comment in
   `30-delegation-templates.md` may remain, so it is deliberately excluded from this grep.)
   Also confirm no unfilled `{…}` bullets remain in CLAUDE.md's Environment facts section or
   anywhere in `50-letter-to-future-sessions.md` (its § "Three things" and § Handoff both
   ship with `{…}` placeholders).
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

When this package later gains improvements, upgrade the install with `git pull` +
`upgrade_harness.md` — never by re-copying package files over the personalized install.
