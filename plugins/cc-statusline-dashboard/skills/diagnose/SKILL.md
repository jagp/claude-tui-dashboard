---
name: diagnose
description: This skill should be used when statusline links are broken - clicks do nothing, open Quick Open / workspace search instead of Explorer, open the wrong file, or hovering shows no tooltip - or when verifying a fresh install on a new machine or terminal. Also runs as /cc-statusline-dashboard:diagnose.
allowed-tools: Read, Bash, Grep, WebFetch, AskUserQuestion
---

# Diagnose broken statusline links

## Overview

A statusline link only works when **five independent gates** are all open. Every
gate fails silently, and every failure produces the same symptom: the click
falls through to the terminal's word-link fallback (VS Code: fuzzy search in
Quick Open — sometimes opening an unrelated file that matches the label text).

**Core principle: never fix blind. Bisect the chain with probes; each probe
result eliminates half the gates.** Fixing one gate while another is closed
shows "no change" and reads as a failed fix — that is expected, not evidence
the fix was wrong.

## The gate chain

| # | Gate | Probe | Fix |
|---|------|-------|-----|
| 1 | `statusline.js` emits OSC 8 | Pipe sample JSON through it; output must contain `]8;;` | Redeploy from `${CLAUDE_PLUGIN_ROOT}/statusline/statusline.js` |
| 2 | Claude Code passes it through | Raw-link probe works but statusline links don't | `FORCE_HYPERLINK=1` in the env of the `claude` process; Claude Code ≥ 2.1.217 (IDE terminals only — see Upstream) |
| 3 | pty layer preserves sequences | No hover tooltip at all on link text | VS Code: `"terminal.integrated.windowsUseConptyDll": false` — the setting **defaults to true** (bundled conpty.dll, which strips OSC 8); OS ConPTY on Win11 24H2+ passes it |
| 4 | Terminal activates the scheme | Tooltip says "Search workspace" instead of showing the URL | VS Code: add `"claudectl"` to `terminal.integrated.allowedLinkSchemes` (list REPLACES defaults — re-list `file,http,https,mailto,vscode,vscode-insiders`) |
| 5 | OS routes `claudectl://` | `reg query HKCU\Software\Classes\claudectl //s`; dry-run below | Re-run `claudectl-register.ps1` |

## Triage order

0. **Confirm the modifier before anything else.** With
   `editor.multiCursorModifier: "ctrlCmd"` VS Code follows links on
   **Alt+click**, not Ctrl+click. Hover tooltips need *no* modifier — just rest
   the pointer directly on the text for ~2 seconds (they are laggy).

1. **Raw-link probe first** — cuts Claude Code out entirely (tests gates 3-5):

   ```powershell
   $e=[char]27; Write-Host "$e]8;;claudectl://open/C:/Users$e\>> CLICK ME <<$e]8;;$e\"
   ```

   Modifier+click the text in the affected terminal. Explorer opens → gates
   3-5 healthy, problem is Claude Code emission (gates 1-2). Nothing happens →
   work gates 3-5, Claude Code is irrelevant for now.

2. **Hover, don't click** — the tooltip is a free boundary probe:
   no tooltip after a patient hover = sequences stripped upstream (gate 3);
   "Search workspace" = scheme rejected (gate 4); URL shown = delivery fine,
   opening broken (gate 5).

3. **Handler dry-run** (gate 5, changes nothing):

   ```powershell
   $env:CLAUDECTL_DRYRUN=1; powershell -NoProfile -File "$env:USERPROFILE\.claude\claudectl-handler.ps1" "claudectl://open/C:/Users"
   # expect: action=open path=C:\Users dir=True file=False
   ```

4. **Emission test** (gate 1): pipe the sample payload from the install skill
   through `~/.claude/statusline.js` and grep for `]8;;`.

Apply **one fix per round-trip** and note which gate it targeted; a "no change"
result still narrows the search.

## Known-good VS Code (Windows) config

All three coexist in the user `settings.json`; each guards a different gate:

```json
"terminal.integrated.allowedLinkSchemes": ["file", "http", "https", "mailto", "vscode", "vscode-insiders", "claudectl"],
"terminal.integrated.env.windows": { "FORCE_HYPERLINK": "1" },
"terminal.integrated.windowsUseConptyDll": false
```

Reload the window after changes — pty and env settings apply only to newly
created terminals. Check for workspace-level `.vscode/settings.json` overrides
and JSON validity before concluding a setting "didn't work".

**Modifier key:** see triage step 0 — wrong modifier mimics every gate failure.

## Levers that exist but are rarely the cause

Checked in the field once each; keep for stubborn cases:

- `terminal.integrated.gpuAcceleration: "off"` forces the DOM renderer, which
  has had link-hover quirks — try `"auto"`.
- Full VS Code restart (vs window reload) and "Developer: Restart Pty Host".
- Stale deploy: diff `~/.claude/statusline.js` against the plugin copy.
- `security.promptForLocalFileProtocolHandling` — a *later* gate than the
  scheme allowlist; independent of it.
- First activation of a non-allowlisted scheme should show a VS Code prompt
  offering to allow it; if no prompt ever appears the link never activated
  (gate 3, not gate 4).

## Other terminals and platforms — known pain points

- **Windows Terminal:** OSC 8 fine, no scheme allowlist, but not in Claude
  Code's hyperlink autodetect list — launch with `$env:FORCE_HYPERLINK="1"; claude`.
- **Legacy conhost** (bare `cmd`/PowerShell window, no tabs): no OSC 8 support
  at all. Unsupportable; use Windows Terminal.
- **macOS:** no protocol registration — links are plain `file://`. Terminal.app
  does not support OSC 8; iTerm2/WezTerm/Kitty do (Cmd+click). Gate 2 caveat
  below still applies.
- **Linux:** `file://` via the terminal's opener (usually `xdg-open`); GNOME
  Terminal, Konsole, WezTerm, Kitty support OSC 8. Same gate 2 caveat.
- **tmux / SSH:** strip OSC sequences unless configured (`allow-passthrough`,
  recent tmux); known broken upstream (see below).
- **"Real" emulators (Konsole, iTerm2, Alacritty):** Claude Code's statusline
  OSC 8 regression was fixed for IDE terminals only; statusline links may not
  work there on any config. The raw-link probe distinguishes terminal capability
  from Claude Code emission.

## Upstream references

- anthropics/claude-code **#21586** — statusline OSC 8 stripped since v2.1.3;
  fixed for IDE terminals in ~2.1.42/2.1.217.
- anthropics/claude-code **#26356** — still broken in real emulators (closed
  "not planned"); **#27047** — tmux.
- Statusline docs troubleshooting (`code.claude.com/docs/en/statusline`)
  documents `FORCE_HYPERLINK`.
- VS Code `allowedLinkSchemes` added ~1.89 (microsoft/vscode PR #209376).
