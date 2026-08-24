# Changelog

All notable changes to the claude-tui-dashboard plugin.

## Unreleased — rebrand to claude-tui-dashboard (2026-08-24)

Renamed the plugin and its marketplace from `cc-statusline-dashboard` and
`claude-dashboard` to a single name, `claude-tui-dashboard`. Historical
entries below keep the command names they shipped under.

- Plugin directory `plugins/cc-statusline-dashboard/` →
  `plugins/claude-tui-dashboard/`
- Marketplace renamed `claude-dashboard` → `claude-tui-dashboard`; the
  install line is now
  `/plugin install claude-tui-dashboard@claude-tui-dashboard`
- Skills are invoked as `/claude-tui-dashboard:activate-dashboard`,
  `/claude-tui-dashboard:deactivate-dashboard`,
  `/claude-tui-dashboard:diagnose`
- **Breaking** — kill-switch env vars renamed: `CC_STATUSLINE_NO_PET` →
  `CLAUDE_TUI_DASHBOARD_NO_PET`, `CC_STATUSLINE_NO_SPAWN` →
  `CLAUDE_TUI_DASHBOARD_NO_SPAWN`. The old names are no longer read.
- Windows uninstall-entry Publisher string is now `claude-tui-dashboard
  (local)`

## Unreleased — goal-state density (2026-08-04)

The full T0 "wire-up-now" shelf from the possibility-space catalog
(`docs/superpowers/specs/2026-08-01-dashboard-possibility-space.md`), on top
of the tooltip paradigm. No new handler verbs — every click is still
tip / copy / open / spawn or https.

- **Threshold colors everywhere**: context gauge colored by the honest
  autocompact-aware usable % (window − 33k reserve, exact math in the hover);
  rate-window remaining % green/yellow/red; burn rate colored, with a red 🪫
  swap when the projection runs dry _before_ the reset; max-effort ★ in
  yellow; vim chip colored by mode; dim `|` separators
- **New line-1 meters**: 💸 spend rate ($/h, after 10 min), ⏱ session clock
  (hover: API share / thinking ratio), 🔥/🧊 prompt-cache warmth countdown
  (TTL tier + anchor sensed from the transcript tail), ±churn badge
  (lines added/removed, hidden at zero), Σ hover gains the cache hit rate
- **New line-1 chips**: 📂+n added workspace dirs (hover lists them), 👤
  account (best-effort ~/.claude.json read, 6h cache), 🥚→🐉 session buddy
  (growth = lines+minutes+ktokens; kaomoji mood in the hover reads real
  context/quota pressure; `CC_STATUSLINE_NO_PET=1` to hide), and a staleness
  clock (dim hh:mm:ss render stamp; yellow `*` once the payload has been
  frozen >2.5 min — the long-turn stall detector)
- **Line-2 git intel**: ↑ahead ↓behind ●staged ✚modified …untracked
  ✖conflicts ⚑stash + red MERGE/REBASE/CHERRY-PICK/BISECT in-progress flag;
  green ✔ when clean. One `git --no-optional-locks status --porcelain=v2`
  cached under ~/.claude/dashboard-state/, invalidated by .git HEAD/index
  mtimes or 15s TTL; op flags and stash depth are free fs peeks; worktree
  `gitdir:` pointers resolved
- **Line-2 CI rollup**: 🚦 passed/total colored by state, click opens the
  PR checks page. Stale-while-revalidate: renders only read the cache; a
  detached `--ci-refresh` child re-runs `gh pr checks` (lock-file guarded,
  TTL 90s pending / 5m settled / 15m after failure);
  `CC_STATUSLINE_NO_SPAWN=1` disables the child
- Burn-rate hover now carries the 7d window and a RUNS-DRY-BEFORE-RESET
  warning when applicable
- Test suite: 50 → 80 checks (churn, clock, spend, usable %, colors, cache
  warm/cold, scratch-repo git intel incl. MERGE flag, canned CI cache,
  added-dirs, account, pet + kill switch, staleness stamp, and an
  everything-on URI physics sweep)

## Unreleased

- New `/cc-statusline-dashboard:diagnose` skill: gate-by-gate troubleshooting
  for dead statusline links (raw-link probe, hover-tooltip triage, the three
  VS Code settings that gate OSC 8 delivery on Windows, per-terminal/per-OS
  pain points, upstream issue references)

## 1.0.0 — 2026-07-25

Initial release.

- Two-line statusline (dependency-free Node script):
  - Model badge as a self-ordering medal ladder (🥉 haiku · 🥈 sonnet ·
    🥇 opus · 🏆 fable, 🎖️ unknown)
  - Reasoning-effort dial (○ ◐ ● ◉ ★), mirroring the model-picker UI
  - Rate-limit windows as **remaining** % with absolute reset stamps
    (⌛ 5-hour, 📅 7-day, unknown windows render generically)
  - Exact session token count (Σ, raw digits — never abbreviated)
  - OSC 8 clickable navigation: branch/worktree folder, PR, and
    repo/issues/cwd fallbacks so line 2 always has at least two links
  - Emoji control buttons: [📒] logs folder, [📜] transcript, [🌳] base branch
  - Compact gitflow branch display (`feature/a-b-c-d` → `f/a-b-c`)
- Windows `claudectl://` protocol suite (user-level, no admin):
  - Handler opens folders in Explorer and reveals files with `/select`;
    strictly read-only, rejects UNC paths before any filesystem probe
    (drive-by NTLM-leak protection)
  - Windowless VBS launcher (no console flash; quote-stripping hardening)
  - Idempotent register/unregister with a once-only statusline backup and a
    Windows Settings > Apps uninstall entry
- Cross-platform links: `claudectl://` on Windows, plain `file://` on
  macOS/Linux (where VS Code's terminal does not hijack them)
- `/cc-statusline-dashboard:install` and `/cc-statusline-dashboard:uninstall` skills
  (deploy + wire `settings.json > statusLine`, fully reversible)
- Glyph-ramp customization catalog (`docs/customizing-glyphs.md`)
