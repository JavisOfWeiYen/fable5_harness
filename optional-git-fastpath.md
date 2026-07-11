# Optional git fast-path guard

The doctrine (`home-claude/docs/10-model-dispatch.md`) makes user-explicit routine git
operations Fast-path — status/diff/log/add/commit/push run without a stop-and-ask. But that
Fast-path has exceptions: `--force` and its destructive siblings must still surface to the
human. Doctrine text alone is advisory — a degraded session can rationalize past it. This
optional component moves the exceptions from voluntary compliance into mechanism, at the
harness layer where the model has no vote. It answers **"ask"** — it escalates to you, it never
denies or auto-approves; the human still makes the call.

Two layers, both machine-generic, shipped together in the package file **`git-fastpath.json`**:

- **Permission rules** (`permissions.allow`, 10 + `permissions.ask`, 9) — allow the routine
  ops (`git status`/`diff`/`log` bare and trailing-`*`, `git add *`, `git commit *`,
  `git push` bare and trailing-`*`); ask on the prefix forms of a forced/destructive push
  (`--force`, `--force-with-lease`, `-f`, `--delete`, `--mirror`, `--prune`).
- **PreToolUse guard hook** (matcher `Bash`, 1 entry) — a deterministic jq+grep guard that
  first normalizes away quotes and backslashes, then detects a `git … push` carrying a
  force/destructive signature in **any** argument position and returns
  `permissionDecision: "ask"`.

## Why the hook layer exists

Permission rules match by **command prefix only**. `Bash(git push *)` in the allow list
auto-approves anything that *starts* `git push ` — including `git push origin main --force`,
because the force token sits after the target, not in the prefix. You cannot enumerate the hole
away with more `ask` rules: the force flag can appear at any position, after any number of
arguments, so no fixed prefix catches it. The guard closes this by inspecting the whole
command string. It first **normalizes** the string by stripping every double quote, single
quote, and backslash (`tr -d '\042\047\134'`) — so shell-splicing tricks that hide a flag from
a space-anchored regex while the shell still reassembles the real flag collapse back to their
executed form: `git push "--force"`, `git push --for"ce"`, `git push \--force`, and
`git push ""--force` all normalize to `git push --force`. It then confirms the command actually
invokes `git … push` (not merely mentions the word) and scans every argument for a
force/destructive signature:

- `--force*` (covers `--force` and `--force-with-lease`), `--delete`, `--mirror`, `--prune`;
- any short-flag cluster containing `f` or `d` — `-f`, `-d`, and **combined** clusters like
  `-fu`, `-uf`, `-f4` (a real `git push -fu origin main` is a force push, but `-f` alone with a
  space/EOL terminator would miss it);
- a leading-`+` **or** leading-`:` refspec token — `+refspec` (force update, e.g.
  `git push origin +main`) and bare `:refspec` **branch deletion** (e.g. `git push origin :main`,
  which deletes the remote branch with no flag at all).

On a match it emits `permissionDecision: "ask"` and nothing else. It **never** returns `deny` or
`allow` — it only raises the Fast-path exception to you for explicit confirmation.

**Defense in depth — whole-string scan, no reliance on command splitting.** The guard greps the
entire raw command string, so it does not depend on Claude Code's compound-command splitting to
find the push. A force signature buried in a chained command — `a && git push --force`,
`echo hi && git push origin :main`, `cd /r && git push origin main --force` — is caught the same
as a bare `git push --force`, because the whole string (after normalization) is what the two
greps see.

**Requirements:** `jq` on PATH — the command opens with a `command -v jq` guard, so on a machine
without jq it exits 0 silently and simply doesn't fire; nothing errors or blocks. The command is
POSIX sh, run by Claude Code under `sh -c` (Linux/macOS/WSL) — native (non-WSL) Windows is out
of scope; run the harness from WSL instead.

## Known over-ask cases (safe direction)

The guard errs toward asking. These fire the prompt even though the push is not really forced;
you simply confirm and move on — no push is ever blocked or silently allowed:

- `echo git push --force` (or any string that merely *contains* the phrase) — the token test
  matches text it isn't executing. It asks; you say yes.
- A compound command that both runs a git push and contains an unrelated force token elsewhere
  (e.g. `rm -f foo.txt && git push`) — `-f` is detected anywhere in the string. It asks.
- **Normalization side effect:** because quote-stripping runs before the scan, a `-f`/`--force`
  substring living inside a *quoted* argument in the same compound command is exposed and can
  match. E.g. `git commit -m "add -f flag docs" && git push` — the quotes around the commit
  message are stripped, leaving a ` -f ` token, so the (non-forced) push over-asks. This is the
  safe direction: the cost of catching the splicing bypass is the occasional benign prompt.

Genuine non-triggers, verified: `git pushover --force` (not a `push` subcommand),
`git push --dry-run` (no force token), a commit message containing the word "force"
(`git commit -m "force retry"` with no push) — none fire.

## Install (done by the installing session at install_harness.md Step 3, item 6a)

The rules and hook live in the package file **`git-fastpath.json`** (next to this file), so the
installing session merges from that file instead of hand-transcribing escaped JSON.

> **`git-fastpath.json` is a fragment — never copy it over `~/.claude/settings.json`.** Doing so
> would wipe the user's existing settings (other permissions, env, other hooks). Only ever
> *merge* it in, using the append-safe command below.

1. Back up `~/.claude/settings.json` per Step 0, item 3 naming. If the file doesn't exist yet,
   create it first so the merge below has a base:

   ```bash
   [ -f ~/.claude/settings.json ] || echo '{}' > ~/.claude/settings.json
   ```
2. Merge — **union/append**, don't overwrite. Plain `jq '.[0] * .[1]'` is unsafe here: `*`
   replaces same-named arrays, so it would clobber any `permissions.allow` / `permissions.ask`
   / `hooks.PreToolUse` the user already has. Use this append-safe merge (from the package dir,
   so `git-fastpath.json` resolves); the `unique` on the permission arrays keeps a re-run from
   duplicating rules, while `hooks.PreToolUse` is appended (dedup below):

   ```bash
   tmp="$(mktemp)"
   jq -s '
     .[0] as $base
     | .[1] as $add
     | $base
     | .permissions.allow = (((.permissions.allow // []) + ($add.permissions.allow // [])) | unique)
     | .permissions.ask   = (((.permissions.ask   // []) + ($add.permissions.ask   // [])) | unique)
     | .hooks.PreToolUse   = ((.hooks.PreToolUse // []) + ($add.hooks.PreToolUse // []))
   ' ~/.claude/settings.json git-fastpath.json > "$tmp" &&
   mv "$tmp" ~/.claude/settings.json &&
   jq . ~/.claude/settings.json
   ```

   If you are **re-running** an install (the guard may already be present), run this removal
   FIRST so you don't append a duplicate hook — it drops only the PreToolUse entry carrying this
   guard's signature and leaves the user's own hooks untouched, then re-run the merge above
   (the `unique` above already makes the permission arrays re-run-safe):

   ```bash
   tmp="$(mktemp)"
   jq '
     def mine: [.hooks[]?.command // "" | contains("Fast-path exception")] | any;
     .hooks.PreToolUse = ((.hooks.PreToolUse // []) | map(select(mine|not)))
   ' ~/.claude/settings.json > "$tmp" &&
   mv "$tmp" ~/.claude/settings.json &&
   jq . ~/.claude/settings.json
   ```
3. Verify: the final `jq .` above exits 0. Current Claude Code versions pick up settings-file
   edits automatically; no restart needed.

## Verify the guard fires (pipe test)

The guard is a self-contained sh command; you can drive it directly with a synthetic tool-input
payload. Extract it once, then feed it commands and watch the decision:

```bash
CMD="$(jq -r '.hooks.PreToolUse[0].hooks[0].command' git-fastpath.json)"
ask(){ jq -n --arg c "$1" '{tool_input:{command:$c}}' | sh -c "$CMD"; }

# should ASK — prints JSON with permissionDecision "ask":
ask 'git push origin main --force'   # flag after the target
ask 'git push -f'                    # short force flag
ask 'git push origin +main'          # +refspec force update
ask 'git push "--force"'             # quote-splice: normalizes to --force
ask 'git push -fu origin main'       # combined short-flag cluster (f + u)
ask 'git push origin :main'          # bare :refspec — remote branch DELETION, no flag

# should be SILENT (prints nothing, exits 0):
ask 'git push'
ask 'git push origin main'
ask 'git push -u origin main'        # -u alone: not a force cluster
ask 'git push origin HEAD:main'      # HEAD:main source:dest, not a leading-: deletion
ask 'ls -la'
```

## Personalization — protected-branch rules (add at install time)

Branch names are personal, so the generic fragment ships **no** protected-branch rules. If you
want a plain (non-forced) push to a specific branch to prompt too — e.g. never push to `main`
without confirming — add your own `ask` rule at install time. This is a personalization, not
part of the shared package:

```jsonc
// personal — append to permissions.ask in ~/.claude/settings.json, NOT to git-fastpath.json:
"Bash(git push origin main *)",
"Bash(git push origin main)"
```

Add these the same append-safe way (union into `permissions.ask`); keep them in your own
`~/.claude/settings.json` so an upgrade of the package never touches them. Prefer exact forms
over broad wildcards, and remember these only cover the literal prefix — the force guard above
already covers forced pushes to any branch regardless of what you add here.

## Behavior notes

- The guard never blocks a call: on no match it exits 0 with no output; on a match it exits 0
  with an `"ask"` decision, which surfaces the normal permission prompt. It cannot deny.
- It is stateless — no marker files, no once-per-session logic. Every matching command asks,
  every time. That is deliberate: a forced push is exactly the operation you want re-confirmed.
- The permission `ask` rules and the hook are complementary: the rules catch the common prefix
  forms cheaply; the hook catches the arbitrary-position forms the rules structurally cannot.
  Installing both is the intended configuration.

## Remove

Use the same signature-scoped removal as § Install (it drops only the guard's PreToolUse entry
and leaves your own hooks), and, if you want the permission rules gone too, subtract them:

```bash
tmp="$(mktemp)"
jq -s '
  .[0] as $base | .[1] as $add
  | $base
  | .hooks.PreToolUse = ((.hooks.PreToolUse // []) | map(select([.hooks[]?.command // "" | contains("Fast-path exception")] | any | not)))
  | .permissions.allow = ((.permissions.allow // []) - ($add.permissions.allow // []))
  | .permissions.ask   = ((.permissions.ask   // []) - ($add.permissions.ask   // []))
' ~/.claude/settings.json git-fastpath.json > "$tmp" &&
mv "$tmp" ~/.claude/settings.json &&
jq . ~/.claude/settings.json
```

Setting `"disableAllHooks": true` disables every hook without editing them (but leaves the
permission rules in force).
