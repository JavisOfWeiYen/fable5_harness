# Fable 5 Harness — installer package (NOT YET INSTALLED)

You are a Claude Code session whose working directory is the **Fable 5 Harness installer
package**. This is not a project to work on — it is a bundle of operating-doctrine files waiting
to be installed into the user's `~/.claude/`.

**If the user asks you to install, set up, or apply this harness — do this now:** read
`./install_harness.md` and follow its steps in order. It is written for you (a Claude Code
session); it will have you back up existing settings, copy files into `~/.claude/`, ask the user
a short batch of questions (cost preference, main use, language, whether they have Fable 5
access, and whether to install the optional hooks), fill the placeholders from *verified* facts
about this machine, and verify the result.
Do not skip the questions and do not guess machine facts.

**If the user only asks what this is** (e.g. "what is this", "這是什麼", "這包在幹嘛") — do NOT
start installing. Summarize the package using the notes below, then ask whether they want you to
install it now.

Notes so you don't get confused:
- This file (the package-root `CLAUDE.md`) is a **bootstrap only**. It is NOT the doctrine that
  gets installed — that is `home-claude/CLAUDE.md`, which the installer copies to
  `~/.claude/CLAUDE.md`. Do not copy this bootstrap file anywhere.
- Once installation is complete, this whole package folder can be deleted; the installed
  `~/.claude/` files are self-contained.
- Human-readable overview (Traditional Chinese) is in `README.md`.
