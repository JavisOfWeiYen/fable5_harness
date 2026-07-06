# Maintenance Protocol

How the models running here (assume Sonnet-class) keep `~/.claude/CLAUDE.md`, `~/.claude/docs/`
and `~/.claude/agents/` alive without degrading them. These files were established 2026-07-06;
they only stay useful if lessons flow back in and rot gets removed.

## 0. Always, before any edit under `~/.claude/`

1. Copy the file to `~/.claude/backups/<name>.bak-<YYYY-MM-DD-HHMM>` (CLAUDE.md invariant 3;
   the time component prevents a second same-day edit from clobbering the true pre-edit copy).
2. After the edit, `Read` the changed section back and confirm it says what you meant.
3. If you changed a filename or added/removed a doc, update the routing table in
   `~/.claude/CLAUDE.md` in the same session — a routing table that points at missing files
   is worse than none.

## 1. What you may change on your own

- **Verified factual corrections.** A model ID, tool name, path, or command documented here
  turned out wrong or stale *and you verified the correct value in this session* (a spawn
  failed and the working alternative succeeded; `claude-code-guide` confirmed from official
  docs). Fix the fact, and add to the edit a `<!-- verified YYYY-MM-DD: how -->` comment.
- **Appending lessons** to a doc's `## Lessons learned` section (format in § 3).
- **Adding a worked example** to `30-delegation-templates.md` when a delegation went notably
  well or badly — real examples are the most transferable content in this whole system.
- **Appending an entry to `50-letter-to-future-sessions.md` § Handoff** (that section is the
  system's logbook — health checks, completed handoff items, session-to-session notes).

## 2. What requires asking the user first

- Changing, weakening, or deleting any **rule, invariant, threshold, or rubric** (the numbered
  rules in CLAUDE.md and docs 10/20). If experience says a rule is wrong, write that up as a
  proposal — evidence, proposed new wording — and ask.
- Creating or deleting doctrine files, or creating new agents in `~/.claude/agents/`.
- Anything motivated by "this rule is inconvenient for my current task". That is the rule
  working, not the rule failing.
- Editing `50-letter-to-future-sessions.md` anywhere **outside** § Handoff (the letter body is
  a historical document; Handoff appends are allowed autonomously, § 1).

## 3. Where lessons go, and in what format

Two destinations — never both:

- **Project-specific facts** ("this repo's dev server needs X", "user tuned these constants")
  → that project's **auto-memory**, using the existing memory mechanism.
- **Doctrine-level lessons** (how to dispatch, verify, judge — true across projects) → append
  to the `## Lessons learned` section at the bottom of the *most relevant* doc (create the
  section on first use), in exactly this format:

  ```
  - YYYY-MM-DD · trigger: {what happened, one line} · rule: {what to do differently, one
    imperative line} · evidence: {how we know, one line}
  ```

One line-group per lesson. No essays. If a lesson doesn't fit any doc, it is probably a
project fact — put it in memory.

## 4. Compaction — when and how

Triggers (check whichever doc you're editing):

- `CLAUDE.md` over ~70 lines → propose a trim to the user (trimming = changing rules, § 2).
  It is a router; content belongs in docs.
- Any doc over ~250 lines, or a `Lessons learned` section over ~10 entries → consolidate:
  merge lessons into the body rules they amend, delete duplicates, keep the strongest example
  per rule (one ✅ and one ❌).
- Consolidation counts as changing rules → **propose to the user first** (§ 2), with a diff.

## 5. Keeping facts fresh

- The model table in `10-model-dispatch.md` § 3 has a verified-on date. If it is older than
  ~6 months, or any spawn fails on model selection, re-verify via a `claude-code-guide` agent
  against official docs — never "update" it from your own training memory.
- Same for tool/agent-type names: this harness renames things; a failed call is evidence,
  your recollection is not.

## 6. Health check (run when the user asks, or when `50-…md` § Handoff shows no health-check
entry within the last ~3 months — record each completed check as a Handoff entry)

1. Routing table ↔ actual files in `~/.claude/docs/`: no dead links, no unrouted docs.
2. Spawn one `Explore` and one `verifier` agent on a trivial task: both agent types still work.
3. Model table spot check (§ 5).
4. Each doc's Lessons section under threshold (§ 4).
5. Report findings to the user; fix only what § 1 allows without asking.
