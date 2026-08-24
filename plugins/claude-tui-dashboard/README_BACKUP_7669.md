# cc-statusline-dashboard

A Claude Code statusline where everything you'd want to jump to is a
**clickable link**, every glyph is a **gauge wearing an emoji face** (hover it
— the tooltip carries the exact numbers as designed prose), and the session's
vital signs read off self-ordering glyphs and threshold colors — no legend
needed.

```
🏆● ▅ 42% ⚠   ⌛ 77% [15:20] | 📅 39% [8/5 19:20] | 🔋 4.2%/h empty ~18:40 | Σ 96310 | ~$3.42 | 💸 $2.28/h | ⏱ 1h30m | 🔥 4:12   my-session +120-30 NORMAL 💭 ⚡ 🎨 explanatory 👤 🐉 14:32:07
⑂ f/my-feature ↑2 ●3 ✚1 …1   🔗 PR #12   🚦 2/3   [📒] [📜] [🌳]
```

## What each piece means

**Line 1 — vitals** (green/yellow/red = each meter's own thresholds)

| Piece | Meaning |
|-------|---------|
| 🥉 🥈 🥇 🏆 | Model as a medal ladder: haiku → sonnet → opus → fable (🎖️ = unknown model) |
| ○ ◐ ● ◉ ★ | Reasoning effort: low → medium → high → xhigh (ultracode) → max (yellow star) |
| ▁▃▅▇█ `42%` | Context-window fill. Colored by the honest **autocompact-aware usable %** (window − 33k reserve — hover for the math), so it warns *before* autocompact looms |
| ⚠ | 1M-context / usage-credit trap: a `[1m]` model or >200k session burns credits fast |
| ⌛ `77% [15:20]` | 5-hour rate-limit window: **remaining** % (colored) and the reset time |
| 📅 `39% [8/5 19:20]` | 7-day window, same format (any future window renders generically) |
| 🔋/🪫 `4.2%/h empty ~18:40` | Burn rate + depletion ETA, projected from render-to-render history. 🪫 red = you run dry **before** the reset |
| Σ `96310` | Exact session token count — raw digits, never abbreviated (hover: per-stream breakdown + cache hit rate) |
| ~$`3.42` | Estimated session cost (hover: wall vs API time) |
| 💸 `$2.28/h` | Spend rate, projected linearly (shown after 10 min) |
| ⏱ `1h30m` | Session wall clock (hover: API share — the "thinking ratio") |
| 🔥 `4:12` / 🧊 | Prompt-cache warmth: countdown to TTL expiry, sensed from the transcript tail; 🧊 = cold, next message re-pays the cache write |
| `my-session` | Session chip, hue hashed from the session id (stable across panes); click copies the id |
| `+120-30` | Lines added/removed this session (hidden at zero) |
| `NORMAL` 💭 ⚡ 🤖 🎨 📂+n | Mode chips, smart-hidden when absent: vim mode (INSERT green / VISUAL magenta), thinking, fast mode, agent, output style, added workspace dirs |
| 👤 | Account chip — hover shows which account this terminal burns quota on |
| 🥚🐣🐥🦕🐉 | Session buddy: grows with lines + minutes + tokens; hover shows its level, kaomoji mood (reads real context/quota pressure), and vitals. `CC_STATUSLINE_NO_PET=1` hides it |
| `14:32:07` | Staleness clock: when this render happened; turns yellow with a `*` when the payload has been frozen >2.5 min (long turn) |

**Line 2 — navigation (every item is an OSC 8 hyperlink; Ctrl/Alt+click)**

| Link | Opens |
|------|-------|
| ⑂ `f/branch-name` | The branch/worktree folder in your file manager (branch names compact to `f/first-three-words`) |
| ↑2 ↓1 ●3 ✚1 …1 ✖1 ⚑2 | Git intel: ahead/behind, staged, modified, untracked, conflicts, stash — plus a red `MERGE`/`REBASE`/`CHERRY-PICK`/`BISECT` flag when an operation is in progress; a lone green ✔ = clean |
| 🔗 `PR #12` | The pull request on GitHub, colored by review state (green approved · red changes requested · yellow pending · dim draft) |
| 🚦 `2/3` | CI check rollup (via `gh`, refreshed in a detached child — renders never block); click opens the checks page |
| 🌐 / 🐛 / 📁 | Fallback links (repo, issues, cwd) so line 2 always has at least two |
| [📒] | The Claude Code logs folder for this session |
| [📜] | The session transcript file |
| [🌳] | The base branch on GitHub (or the trunk folder locally) |

## Hover tooltips

Most segments are OSC 8 links whose URI **is** the tooltip —
`claudectl://tip/5h+23.4%25+resets+15:20+remaining+77%25` reads as prose in the
hover bubble. Tips are space-free printable ASCII (VS Code collapses any
whitespace-bearing URI to the word "Link"; Windows Terminal shows the first
1024 chars), and a click on a `tip` link is a no-op in the handler — except
tip + `/do/` composites (like the session chip), which confirm before
re-dispatching through the same allowlist. Sensors persist tiny caches under
`~/.claude/dashboard-state/`; add `"refreshInterval"` to your `statusLine`
setting so countdowns tick while you're idle. `CC_STATUSLINE_NO_SPAWN=1`
disables the detached CI refresh child.

## Why the Windows `claudectl://` protocol

VS Code's integrated terminal intercepts `file://` links and opens them in
Quick Open instead of Explorer. It **must** hand an unknown scheme to the OS,
so on Windows the statusline emits `claudectl://open/...` links and the
installer registers a user-level (no admin) protocol handler that opens
folders as Explorer windows and reveals files with `/select`. On macOS/Linux
the statusline emits plain `file://` links — no handler needed.

The handler is deliberately non-destructive: **its only action is showing an
existing local fixed-drive path in Explorer**. UNC paths (`\\host\share`) are
rejected before any filesystem probe, because a registered scheme is invocable
by any web page and probing a UNC path would auto-send NTLM credentials.

## Requirements

- **Node.js** (the statusline is a dependency-free CommonJS script)
- A **hyperlink-aware terminal**: Windows Terminal, VS Code integrated
  terminal, iTerm2, WezTerm
- Windows for the `claudectl://` Explorer integration (everything else is
  cross-platform)

## Install & activate

```
/plugin marketplace add <path-or-git-url-of-this-repo>
/plugin install cc-statusline-dashboard@claude-dashboard
/cc-statusline-dashboard:activate-dashboard
```

Activation refuses to run unless the plugin is installed and active through
`/plugin` — a bare repo checkout cannot deploy. The activate-dashboard skill:

1. Backs up your current `statusLine` setting and statusline script (once —
   re-activating never overwrites the original backup)
2. On Windows, registers `claudectl://` (HKCU, no admin) and adds a
   **Settings > Apps** entry ("Claude Control Protocol (claudectl)") so the
   OS-standard uninstall flow works too
3. Deploys `statusline.js` to `~/.claude/` and points
   `settings.json > statusLine` at it
4. Verifies by piping a sample payload through the deployed script

Passing a JSON object to activate-dashboard switches it to config mode: the
object is validated against the dashboard.json v1 shape and echoed back as
JSON only — no deployment. This is the seam for the web editor's exported
artifact; future versions will act on it.

### Manual install

Copy `statusline/statusline.js` to `~/.claude/statusline.js`, then add to
`~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"/absolute/path/to/home/.claude/statusline.js\""
  }
}
```

On Windows, additionally run
`powershell -NoProfile -ExecutionPolicy Bypass -File statusline/claudectl-register.ps1`.

## Deactivate

```
/cc-statusline-dashboard:deactivate-dashboard
```

Restores the statusline and `statusLine` setting that were live before
activation, removes the protocol registration and deployed files. On Windows,
**Settings > Apps > "Claude Control Protocol (claudectl)" > Uninstall** does
the same. Then `/plugin uninstall cc-statusline-dashboard` removes the plugin.

## Troubleshooting

```
/cc-statusline-dashboard:diagnose
```

Links dead? Clicks landing in Quick Open / workspace search? Five independent
gates must all be open for a link to work, and each fails silently with the
same symptom. The diagnose skill bisects the chain with probes (raw-link test,
hover-tooltip triage, handler dry-run) instead of guessing. Notably: on Windows
+ VS Code, `terminal.integrated.windowsUseConptyDll` defaults to true and the
bundled conpty.dll strips OSC 8 hyperlinks entirely — set it to `false`.

## Customizing the glyphs

Both badge scales live in one place at the top of `statusline.js`
(`MODEL_ICON`, `EFFORT_ICON`). `docs/customizing-glyphs.md` catalogs
ready-made alternative ramps (psychology 😴🙂🤔🧐🤯, caffeine, spiciness,
creature-size, gemstones, …) plus terminal-rendering caveats (avoid ZWJ
sequences; text-glyph ramps are the width-safe choice).

## Files

```
statusline/statusline.js           the statusline (deployed to ~/.claude)
statusline/claudectl-register.ps1  Windows protocol installer (idempotent, HKCU)
statusline/claudectl-handler.ps1   protocol handler — read-only, Explorer-only
statusline/claudectl-unregister.ps1  full reversal incl. statusline restore
statusline/claudectl.vbs           windowless launcher (no console flash)
<<<<<<< HEAD
skills/install, skills/uninstall   the /cc-statusline-dashboard:* skills
skills/diagnose                    gate-by-gate link troubleshooting
=======
skills/activate-dashboard, skills/deactivate-dashboard   the /cc-statusline-dashboard:* skills
>>>>>>> feature/statusline-goal-state
docs/customizing-glyphs.md         alternative glyph ramps + caveats
```
