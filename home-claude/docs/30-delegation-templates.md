# Delegation Prompt Templates

Copy the template, fill every `{…}` slot, delete inapplicable optional lines.
If you can't fill the ACCEPTANCE slot, you don't understand the task yet — resolve that first
(`10-model-dispatch.md` § 2). Model choice per `10-model-dispatch.md` § 3; verification of the
result per `10-model-dispatch.md` § 6 (spawn `verifier` when the result crosses the
substantive line in `20-judgment-rubrics.md` § 2 — these templates are for the *doer*).

Conventions used below:
- Long output always goes to a file; the reply carries the path + short summary.
- Every template ends with the failure clause — include it verbatim; it is what prevents
  silent partial answers.

**Failure clause (append to every delegation):**
> If you cannot fully succeed, do not present a partial result as success. Report: what you
> tried, what failed (with exact errors), what you ruled out, and your best hypothesis.

---

## 1. Search / locate  (agent type: `Explore`; read-only. Use Explore's built-in model
default — do not set `model`; the "explicit model" rule in `10-model-dispatch.md` § 3 applies
to `general-purpose` spawns)

```
GOAL: Locate {what — e.g. "everywhere the session token is read"} in {scope — repo/dir}.
WHY: {what the commander will do with it — e.g. "we will change the token format and must find all consumers"}.
BREADTH: {medium | very thorough}. Check plural/singular, synonyms, and indirect uses
  ({e.g. "the token may appear as 'jwt', 'auth', or be read through a helper without a name"}).
ACCEPTANCE: every match found, or an explicit statement of naming patterns you checked and
  found nothing under. Per-item evidence is mandatory: each reported item carries file:line
  AND a verbatim quote of that line, from a search you executed THIS run — an item you did
  not actually look up is reported under NOT CHECKED, never filled in from naming or pattern
  similarity.
REPORT: two lists. FOUND — file:line + the quoted line + one-line role per site.
  NOT FOUND / NOT CHECKED — what you searched and didn't find (patterns tried), or didn't
  get to. No code blocks longer than 3 lines.
```

## 2. Implementation  (agent type: `implementer` — opus, pinned high effort; or `general-purpose` at model `opus` if you need a different toolset)

```
GOAL: Implement {feature} in {files/area}.
WHY: {user-visible motivation}.
CONSTRAINTS: {APIs/behavior/visuals that must NOT change}; match the existing style of the
  file; do not touch {out-of-scope areas}.
KNOWN CONTEXT: {file:line pointers, prior decisions, gotchas — save the agent rediscovery}.
ACCEPTANCE:
  - {observable behavior 1 — phrased so a fresh agent could test it}
  - {observable behavior 2}
  - existing behavior {X} still works.
VERIFY YOURSELF BEFORE REPORTING: run it ({command / "drive the page with this machine's browser driver"});
  a change you did not see running is not done.
REPORT: files changed with one-line-per-file summary; how you verified (commands + observed
  results); anything left rough, explicitly.
```

## 3. Refactor  (agent type: `implementer` — opus/high; or `general-purpose` at model `opus`; batch fan-out later per `10-model-dispatch.md` § 5)

```
GOAL: Refactor {what} from {current shape} to {target shape}.
WHY: {pain it removes}.
BEHAVIOR CONTRACT: zero observable behavior change. {How behavior is observed: tests /
  specific manual drives / recorded telemetry}.
MECHANICAL RECIPE (if this is a fan-out of a proven pattern): {exact steps from the verified
  first instance}.
ACCEPTANCE:
  - {behavior checks} pass identically before and after (run them BEFORE starting to get the baseline);
  - no public/exported names changed except {allowed list};
  - net LOC and duplication went down, not up.
REPORT: before/after check results side by side; files changed; any site where the recipe
  didn't fit (leave those sites UNCHANGED and list them — do not improvise).
```

## 4. Research  (agent type: `general-purpose`; use web tools; model: `opus`)

```
QUESTION: {the precise question, including what decision it feeds}.
WHY: {decision at stake — lets the agent judge relevance}.
SOURCES: prefer {official docs / primary sources}; at least {N} independent sources for any
  load-bearing claim; note publication dates — {recency requirement}.
ACCEPTANCE:
  - the question is answered directly, or the answer is explicitly "not determinable" with reasons;
  - every load-bearing claim has a URL;
  - claims that conflict between sources are surfaced, not averaged away.
REPORT: write the full report to {path}; reply with the path + a ≤10-line summary containing
  the direct answer and confidence (high/medium/low + why).
```

## 5. Review  (agent type: `verifier`, which pins its own model/effort — set no `model`; or `general-purpose` at model `opus`. Fresh context — do NOT paste the author's reasoning)

```
REVIEW TARGET: {diff / files / document at path}.
WHAT IT CLAIMS TO DO: {acceptance criteria only — never the author's explanation}.
FOCUS: {correctness | regressions | security | consistency with codebase | factual accuracy}.
METHOD: verify by execution where possible (run tests, drive the app, re-derive key numbers);
  read the surrounding code, not just the diff.
ACCEPTANCE: every claim checked and marked PASS / FAIL / UNVERIFIED with evidence.
REPORT: verdict first (PASS/FAIL). Then findings ordered by severity, each with file:line,
  what's wrong, and how you know (evidence, not opinion). Zero findings is a legitimate
  result — do not invent nitpicks to seem thorough.
```

---

## Worked example (filled template 2 — illustrative)

<!-- INSTALLER / future sessions: after the first delegation in THIS environment that goes
notably well, replace this illustrative example with that real one (allowed autonomously,
40-maintenance-protocol.md § 1). Real examples from the user's own projects teach better. -->

```
GOAL: Add CSV export to the report page (src/report/view.js, button next to "Print").
WHY: user currently copies the table into a spreadsheet by hand every week.
CONSTRAINTS: do not change the table's data pipeline or its rendered layout; no new
  dependencies — build the CSV string by hand; match the file's existing code style.
KNOWN CONTEXT: the table rows come from "buildRows()" (grep-verify this and every other
  pointer before writing it into a prompt; a fabricated anchor costs the agent its whole run).
ACCEPTANCE:
  - clicking Export downloads a .csv whose rows match the on-screen table exactly,
    including the filtered state;
  - fields containing commas or quotes are escaped per RFC 4180;
  - the Print button and table rendering still work; no console errors.
VERIFY YOURSELF BEFORE REPORTING: drive the page in a real browser, click Export with a
  filter applied, open the downloaded file and diff a sample row against the screen.
REPORT: files changed + summary; verification evidence (the sample-row comparison, downloaded
  file path); anything rough, explicitly.
If you cannot fully succeed, do not present a partial result as success. Report: what you
tried, what failed (with exact errors), what you ruled out, and your best hypothesis.
```
