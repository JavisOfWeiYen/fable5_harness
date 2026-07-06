# Model Dispatch Doctrine

How to delegate work to subagents: who does what, at which model, verified how.
Written 2026-07-06. Model names verified against this environment on that date —
if a spawn fails on model selection, see § Model table, then update per `40-maintenance-protocol.md`.

## 1. The commander stays on the bridge

The main conversation is a commander, not a worker. Its context is the scarcest resource in
the whole system (see `00-harness-diagnosis.md`, Finding 1). The commander:

- **Never** reads large files whole, scans repos, fetches web pages at length, iterates on
  screenshots, or batch-edits many files inline.
- **Does** decompose tasks, write delegation prompts, read subagent conclusions, decide, and
  talk to the user.
- **Parallelizes.** Independent subtasks go out as one batch of spawns, not one at a time —
  serial dispatch of independent work wastes wall-clock for no quality gain. Dependent steps
  (doer → verifier) wait for the previous result. Check how this harness delivers results:
  subagents may run in the background and report asynchronously.
- Rule of thumb: if an action would put more than ~1,000 lines of raw material (code, logs,
  search results, page text) into the main context *cumulatively*, it must be delegated.
  This does not relax the per-`Read` cap of ~300 lines on unfamiliar files (CLAUDE.md
  invariant 1) — the two limits apply together.

Cheap direct actions are fine inline: a targeted `Read` of a known range, a single `grep`
with a specific pattern, one quick command, an `Edit` to a file you already understand.

## 2. Every delegation carries three things

Never spawn an agent with a bare task description. Every delegation prompt contains:

1. **Goal and motivation** — what to do and *why*, so the agent can make sane micro-decisions.
2. **Acceptance criteria** — observable conditions that define success. If you can't state
   them, you don't understand the task yet; figure that out first.
3. **Report format** — exactly what to send back (see § 4) and where to put long artifacts.

Fill-in templates for the five common task shapes: `30-delegation-templates.md`.

## 3. Model and effort — explicit, never defaulted

### Model table (verified 2026-07-06)

<!-- INSTALLER: Fable 5 toggle (install_harness.md Step 0/3). If the user has NO Fable 5 access
(the common case), DELETE the `fable` row below — `opus` then reads as the top tier and § 5's
escalation prose already covers that case. Keep the row only if the user confirmed Fable 5
access. Then delete this comment. -->

| Alias for Agent `model` param | Full ID | Use for |
|---|---|---|
| `opus` | `claude-opus-4-8` | **Default for all substantive work** (user preference: quality over cost): implementation, refactors, research synthesis, review, debugging. |
| `sonnet` | `claude-sonnet-5` | Well-specified mid-size tasks where the pattern is already proven (see § 5 downgrade), and high-volume exploration. |
| `haiku` | `claude-haiku-4-5-20251001` | Purely mechanical batch steps: apply an exact known transformation, format conversion, mass file moves. Never for judgment. |
| `fable` | `claude-fable-5` | **Top tier — keep this row only if this machine has Fable 5 access** (set at install; removed otherwise). Reserve for when `opus` has failed the same subtask twice (§ 5). If a spawn ever fails, treat fable as unavailable and fall back to `opus`. |

- Per-invocation, the Agent tool accepts **`model` only — there is no per-call effort
  override** (verified against official docs 2026-07-06).
- To pin **effort**, use an agent definition file in `~/.claude/agents/*.md` with frontmatter
  `effort: low|medium|high|xhigh|max`. Three ship with this harness, all `opus`: `verifier`
  (high), `implementer` (high), `hard-solver` (max). Create more via
  `40-maintenance-protocol.md` if a recurring role needs pinned effort.
- **Getting the most out of Opus.** Effort level materially affects Opus on hard
  reasoning/implementation, so for this quality-first setup: default substantive delegated
  work to `high` effort — use the shipped `implementer` for well-specified build/refactor
  tasks rather than a bare `general-purpose` spawn, since it is pinned to high. Reserve `max`
  for the genuinely hard subtask via `hard-solver` (see § 5 — dispatch it only after normal
  attempts stall; it is expensive). The main session's effort is your own Claude Code setting,
  not something these files control — run it high. (Confirm the effort levels your Opus build
  actually supports at install; don't assume from memory.)

The "explicit, never defaulted" rule applies to `general-purpose` spawns. Specialized built-in
types (`Explore`, `Plan`, `claude-code-guide`) and custom agents with a `model` in their
frontmatter use their own defaults — don't override those without a reason.

### Built-in agent types (verified in this harness)

- `Explore` — read-only search/locate across many files. Use before any implementation in
  unfamiliar code. State breadth: "medium" or "very thorough".
- `general-purpose` — full-tool worker; the default vehicle, combined with an explicit `model`.
- `Plan` — architecture/implementation planning; returns a step plan + critical files.
- `claude-code-guide` — questions about Claude Code / Agent SDK / Claude API. Use it instead
  of answering such questions from memory.
- `verifier` (custom, `~/.claude/agents/verifier.md`) — fresh-context acceptance checking. See § 6.
- `implementer` (custom, opus/high) — the doer for well-specified build/refactor tasks
  (templates 2–3 in `30-delegation-templates.md`). Prefer it over a bare `general-purpose`
  spawn for substantive implementation; it still gets certified by a separate `verifier` pass.
- `hard-solver` (custom, opus/max) — deep reasoning for the subtask that resisted normal
  attempts (§ 5's top of the ladder on the effort axis). Expensive; dispatch sparingly, with
  the full failure trail.

## 4. Report contract

Subagents return **conclusions, not material**:

- Findings as short claims, each with `file:line` or a command to reproduce.
- Long artifacts (reports, diffs, logs, generated docs) are written to a file; the reply
  carries the path plus a ≤10-line summary.
- A subagent that cannot finish reports *what it tried, what failed, and its best hypothesis* —
  never a silent partial answer dressed up as success.
- Put the report contract in the delegation prompt verbatim; agents don't know it otherwise.

## 5. Escalation and downgrade ladder

- **haiku errs once** on a task → redo at `sonnet` or `opus`. Don't retry haiku with a better
  prompt. Exception: if the failure was the *dispatcher's own mistake* (typo'd path, missing
  input in the prompt), fix your mistake and rerun at the same tier — escalation is for
  capability gaps, not dispatcher bugs (`20-judgment-rubrics.md` § 1 ❌ example).
- **sonnet fails the same subtask twice** (regardless of whether the two causes look the
  same) → escalate to `opus`, forwarding the *complete
  failure trail* (both attempts, error output, what was already ruled out) so opus doesn't
  repeat the same dead ends.
- **opus fails the same subtask twice** → try the *effort* axis before the model axis: if those
  attempts were at ≤ high effort, re-run once via `hard-solver` (opus/max) with the complete
  failure trail — a cheaper lever than switching models, and always available. If `hard-solver`
  also fails (or the attempts were already at max effort): with Fable 5 access, escalate to
  `fable` (the top model tier) forwarding the full trail; without it, opus/max is the top this
  machine has — stop the ladder, re-examine the task definition (wrong-direction signals:
  `20-judgment-rubrics.md` § 4), or take it to the user with the failure trail.
- **fable fails the same subtask twice** (only where fable is available) → stop the ladder.
  Once you are at the top tier this machine has, there is no bigger model to hide behind:
  re-examine the task or take it to the user with the full failure trail.
- **Downgrade for scale:** once a pattern is solved and verified on one instance (e.g. one
  file migrated, one component converted), write the exact recipe into the batch prompt and
  fan out the remaining instances at `sonnet` (or `haiku` if truly mechanical), with spot-check
  verification on a sample.
- **Retry budget: two rounds per approach.** The third attempt must change something
  structural — different model, different decomposition, different approach — or go to the user.

## 6. Verification is never self-verification

This section is the **authoritative statement** of the verification contract. Other files
(CLAUDE.md invariant 2, `00-harness-diagnosis.md` Finding 3, the agent definitions) deliberately
restate its core because they must stay self-contained — edits to the contract start here and
propagate outward, never the reverse.

The agent that did the work never certifies it. A doer's "VERIFY YOURSELF BEFORE REPORTING"
step (in the `30-delegation-templates.md` templates) is a pre-check that reduces round-trips;
it never substitutes for the verifier pass. After substantive delegated work:

1. Spawn `verifier` (fresh context) with **only** the acceptance criteria and pointers to the
   changed artifacts — never the doer's transcript or reasoning.
   If the spawn fails with "agent type not found" (happens when `~/.claude/agents/` was
   created after the session started), fall back to `general-purpose` at model `opus`,
   prepending the full text of `~/.claude/agents/verifier.md` to the prompt, and tell the
   user a session restart will restore the `verifier` type.
2. Evidence must be executed, not argued: written files get read back; code gets tests run or
   the app actually driven (for web, with this machine's browser driver — see CLAUDE.md
   Environment facts); claims get reproduced.
3. High-risk judgment (irreversible actions, architecture choices, anything the user will
   ship) additionally gets a second independent opinion, or N candidate answers judged by a
   separate agent, or goes to the user.
4. If verifier and doer disagree, the disagreement goes to the commander — do not let either
   agent overrule the other silently.
