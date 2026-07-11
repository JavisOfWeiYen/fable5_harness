# Letter to Future Sessions

Originally written 2026-07-06 by a Claude Fable 5 session for its own environment; installed
here from the fable5_harness package. You, the reader, are probably an Opus- or Sonnet-class
model. That is fine — the file set around this letter exists precisely so that you don't need
to be bigger, you need to be *disciplined*. Historical document: append-only, and only in
§ Handoff.

## Three things worth knowing about this environment

<!-- INSTALLER: write 1–3 items for THIS user during install, then delete this comment.
What belongs here (this is what the original author chose for their own user, as a pattern):
  1. A concrete landmine you noticed during install — a stale config, a pinned model, a
     fragile setup step — with what the first session should do about it.
  2. The user's strongest existing habit that sessions should lean into and generalize
     (the original was "the user measures before tuning — externalize judgment into
     measurements the same way; 'I measured X, changed Y, X improved to Z' is a sentence a
     small model can say with full confidence, 'I think it feels better' is not").
  3. A missing safety net worth proposing to the user (the original was a pre-commit smoke
     test, and splitting oversized single files so reads stop costing 30k+ tokens).
Verify anything you write here by inspection — this section must not contain guesses. -->

- {item 1}
- {item 2}
- {item 3 — or delete surplus items}

## How this system will most likely degrade — and the countermeasures

**Decay 1: Routing stops firing.** Sessions skim CLAUDE.md, feel confident, and act without
reading the routed doc; three months later the docs are furniture. *Countermeasure:* CLAUDE.md
is deliberately short enough to always read fully, and its invariants are self-contained — even
a session that never opens the docs keeps the load-bearing behavior. If you notice yourself
delegating without having read `10-model-dispatch.md` this session, that is the decay; open it.

**Decay 2: Erosion by convenience.** Some session, mid-task, will find a rule inconvenient —
usually verification ("no time to spawn a verifier for this clearly-substantive thing") —
and weaken it or carve an exception. Each carve-out is locally reasonable; the sum is the old, undisciplined
environment. *Countermeasure:* `40-maintenance-protocol.md` § 2 forbids weakening rules without
user approval, and names this exact motivation as disqualifying. User: if a session proposes
relaxing a verification rule *while in the middle of a task that rule is blocking*, be
suspicious by default.

**Decay 3: Fact rot masquerading as doctrine failure.** A model alias changes, a tool gets
renamed, a spawn fails — and the session concludes "these docs are outdated" and stops
trusting all of them. *Countermeasure:* facts and rules are separated on purpose: facts carry
verified-on dates and a re-verification procedure (`40` § 5). A stale fact means *update the
fact*, not *distrust the rules*.

## Honest limits (unchanged from the diagnosis; do not quietly drop this)

Decomposition, fresh-context verification, and multi-candidate judging get execution quality
to a high floor at Sonnet scale. They do **not** substitute for taste or for resolving genuine
ambiguity. When you hit those: 2–3 real options with evidence → user picks (rubric § 6); or say
plainly that the call is above this system's pay grade. Never bluff confidence you don't have.

## Handoff (append-only; newest first)

<!-- INSTALLER: replace the entry below with your install entry: date, "installed from
fable5_harness", what you personalized, and any pending items (e.g. the verifier spawn test
after restart). Then delete this comment. -->

- {YYYY-MM-DD} · Installed from the fable5_harness package (doctrine originally authored
  2026-07-06 by a Fable 5 session, adversarially reviewed same day). Personalized: {list}.
  Pending: verify the `verifier` agent spawns in a fresh session (fallback documented in
  `10-model-dispatch.md` § 6).
