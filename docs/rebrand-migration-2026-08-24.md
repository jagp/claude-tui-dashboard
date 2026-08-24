# Rebrand migration — `claude-tui-dashboard`

One-time steps to finish the rename outside the repo. The in-repo half is
already committed on `feature/rebrand-claude-tui-dashboard`; everything here
touches the live environment and **must run with no Claude Code session open
inside the project folder** — the folder rename cannot proceed while a session
holds it.

Old names retired: `cc-statusline-dashboard` (plugin) and `claude-dashboard`
(marketplace + folder). Both are now `claude-tui-dashboard`.

## Order matters

Rename the folder first, repair the worktrees, then repoint settings, then
purge the stale cache so Claude Code re-syncs from the new path.

## 1. Merge the branch, then close all sessions in the folder

```powershell
cd C:\Users\jared\Projects\claude-dashboard
git checkout develop
git merge --no-ff feature/rebrand-claude-tui-dashboard
```

Then exit every Claude Code session and editor window rooted in that folder.

## 2. Rename the project folder

```powershell
Rename-Item C:\Users\jared\Projects\claude-dashboard claude-tui-dashboard
```

## 3. Repair the git worktrees

Worktrees are registered by absolute path, so all of them break on the rename.
`git worktree repair` rewrites both sides of the link:

```powershell
cd C:\Users\jared\Projects\claude-tui-dashboard
git worktree repair
git worktree list
```

## 4. Repoint `~/.claude/settings.json`

Two edits, both under keys that still carry the old names:

- in `enabledPlugins`: `"cc-statusline-dashboard@claude-dashboard": true`
  becomes `"claude-tui-dashboard@claude-tui-dashboard": true`
- in `extraKnownMarketplaces`: the `"claude-dashboard"` key becomes
  `"claude-tui-dashboard"`, and its `source.path` becomes
  `C:\\Users\\jared\\Projects\\claude-tui-dashboard`

## 5. Re-key the project-scoped data

Claude Code keys per-project state by the encoded working directory, so the
folder rename orphans it: session memory and every transcript for this project
live under `C--Users-jared-Projects-claude-dashboard`. Rename the directory so
the new path resolves to the same history:

```powershell
Rename-Item `
  C:\Users\jared\.claude\projects\C--Users-jared-Projects-claude-dashboard `
  C--Users-jared-Projects-claude-tui-dashboard
```

At the time of writing that directory holds `memory/` plus roughly 1.7 MB of
session transcripts. Skipping this step does not delete anything — it just
leaves the old key unreferenced while new sessions start from an empty one.

`~/.claude.json` also carries 5 entries whose paths contain the old folder
name. Check and update them:

```powershell
Select-String -Path C:\Users\jared\.claude.json -Pattern 'Projects.+claude-dashboard'
```

## 6. Purge the stale marketplace cache

Cached under the old marketplace name; deleting it forces a clean re-sync:

```powershell
Remove-Item -Recurse -Force C:\Users\jared\.claude\plugins\cache\claude-dashboard
```

## 7. Verify

```powershell
cd C:\Users\jared\Projects\claude-tui-dashboard\plugins\claude-tui-dashboard
node tests/run-tests.js
```

In a fresh Claude Code session, `/plugin` should list the plugin as
`claude-tui-dashboard@claude-tui-dashboard`, and
`/claude-tui-dashboard:diagnose` should resolve.

## Not required

- **Registry.** No `claudectl` protocol key and no uninstall entry were
  present at the time of the rename, so there is nothing to re-register. If
  you later re-run `claudectl-register.ps1`, it now writes the Publisher
  string `claude-tui-dashboard (local)`.

## Separate leftovers (not part of this rebrand)

- `~/.claude/plugins/claude-dashboard-statusline/` — a July 13 install
  predating the plugin, with its own `install.ps1` and `src/`. Unrelated to
  the marketplace copy; delete if it is genuinely dead.
- `~/.claude/statusline.js` is the deployed copy and carries ~269 lines of
  uncommitted 2026-08-18 layout work that exists nowhere in git. Reconcile it
  before redeploying from the repo, or the rebrand deploy will overwrite it.

  Reconstruct that change set with:

  ```powershell
  diff --strip-trailing-cr `
    ~/.claude/statusline.js.bak-2026-08-18-pre-layout-move `
    ~/.claude/statusline.js
  ```

  Porting it forward now needs two extra fixes the rebrand introduced: the
  live file still calls the kill switches `CC_STATUSLINE_NO_PET` /
  `CC_STATUSLINE_NO_SPAWN`, which must become `CLAUDE_TUI_DASHBOARD_NO_PET` /
  `CLAUDE_TUI_DASHBOARD_NO_SPAWN`; and the live file is LF while the repo copy
  is CRLF, so copying it wholesale reads as a whole-file rewrite in git.
