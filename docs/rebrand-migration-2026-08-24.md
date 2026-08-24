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

## 5. Purge the stale marketplace cache

Cached under the old marketplace name; deleting it forces a clean re-sync:

```powershell
Remove-Item -Recurse -Force C:\Users\jared\.claude\plugins\cache\claude-dashboard
```

## 6. Verify

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
