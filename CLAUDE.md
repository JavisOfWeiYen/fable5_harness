# Fable 5 Harness — installer package (NOT YET INSTALLED)

You are a Claude Code session whose working directory is the **Fable 5 Harness installer
package**. This is not a project to work on — it is a bundle of operating-doctrine files waiting
to be installed into the user's `~/.claude/`.

**If the user asks you to install, set up, or apply this harness — do this now:** read
`./install_harness.md` and follow its steps in order. It is written for you (a Claude Code
session); it will have you back up existing settings, copy files into `~/.claude/`, ask the user
a short batch of questions (7 in total: cost preference, main use, language, interaction style,
whether they have Fable 5 access, whether to install the optional hooks, and — as a separate
opt-in — whether to install the optional git fast-path guard), fill the placeholders from *verified* facts
about this machine, and verify the result.
Do not skip the questions and do not guess machine facts.

**If the user already has the harness installed and asks to update or upgrade it** (e.g. after
a `git pull` of this package) — read `./upgrade_harness.md` and follow it instead: upgrades
port hunks into the personalized installed files; they never blind-copy package files over
them.

**If the user only asks what this is** (e.g. "what is this", "這是什麼", "這包在幹嘛") — do NOT
start installing. Summarize the package using the notes below, then ask whether they want you to
install it now.

Notes so you don't get confused:
- This file (the package-root `CLAUDE.md`) is a **bootstrap only**. It is NOT the doctrine that
  gets installed — that is `home-claude/CLAUDE.md`, which the installer copies to
  `~/.claude/CLAUDE.md`. Do not copy this bootstrap file anywhere.
- The installed `~/.claude/` files are self-contained, so this folder can be deleted after
  install — but keeping the clone makes future upgrades easiest (`git pull`, then
  `upgrade_harness.md`). Deleting is still fine: the installer records the package commit in
  the Handoff, so a fresh clone can diff precisely later.
- Human-readable overview (Traditional Chinese) is in `README.md`.
