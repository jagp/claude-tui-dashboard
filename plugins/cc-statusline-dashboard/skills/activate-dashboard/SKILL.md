---
name: activate-dashboard
description: This skill should be used when the user asks to "activate the dashboard", "activate dashboard", "install the clickable statusline", "set up the statusline", "register claudectl", or runs /cc-statusline-dashboard:activate-dashboard. Deploys the dashboard statusline into ~/.claude/statusline.js, wires settings.json, and (on Windows) registers the claudectl:// protocol. With a JSON object argument it only validates and echoes the dashboard config — no deployment.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Activate the dashboard

Deploy the plugin's statusline to `~/.claude/statusline.js`, point the user's
`statusLine` setting at it, and on Windows register the `claudectl://` protocol
so local-path links open Windows Explorer instead of being hijacked by VS
Code's terminal. All steps are idempotent and reversible via
`/cc-statusline-dashboard:deactivate-dashboard`.

## Step 0 — Refuse to run outside an active plugin install

Activation must only work when this plugin is installed and enabled through
Claude Code's plugin system — never from a bare repo checkout.

Resolve this skill's base directory and require that it lives under the
user's plugin cache (a path containing `.claude/plugins/`, e.g.
`~/.claude/plugins/cache/<marketplace>/cc-statusline-dashboard/...`). If it
resolves anywhere else (a git checkout, a worktree, a downloaded folder),
STOP without deploying anything and tell the user to install the plugin
first:

```
/plugin marketplace add <path-or-repo-of-the-claude-dashboard-marketplace>
/plugin install cc-statusline-dashboard@claude-dashboard
```

Then re-run `/cc-statusline-dashboard:activate-dashboard`.

Below, `${CLAUDE_PLUGIN_ROOT}` means the plugin root resolved from this
skill's base directory (two levels above `skills/activate-dashboard/`) —
substitute it literally in every command. The files used:

- `${CLAUDE_PLUGIN_ROOT}/statusline/statusline.js` — the statusline itself
- `${CLAUDE_PLUGIN_ROOT}/statusline/claudectl-register.ps1` — Windows protocol installer
- `${CLAUDE_PLUGIN_ROOT}/statusline/claudectl-unregister.ps1`, `claudectl-handler.ps1`, `claudectl.vbs` — deployed by the register script

## Config mode — optional object argument (extensibility seam)

If the invocation carries an argument that parses as a JSON object, do NOT
deploy anything. This is the seam for the future state where activation
consumes a dashboard config (the web editor's exported artifact):

1. Validate the object against the dashboard.json v1 shape:
   `{"version": 1, "row": [entry, ...]}` where each entry is
   `{"type":"button","glyph":"…","tooltip":"…","action":"…","keybind":"…"}`
   (tooltip/action/keybind optional; tooltip is ASCII 32–126, no raw spaces),
   `{"type":"flex"}` (optional `"side":"both"|"left"|"right"`), or
   `{"type":"divider","glyph":"…"}`.
2. Output ONLY the normalized JSON itself — one fenced code block, no prose
   before or after, no file writes, no settings changes, nothing executed.
3. Unknown keys pass through untouched (forward compatibility). If the object
   is not valid v1, output a JSON object of shape
   `{"error": "<one-line reason>"}` instead — still JSON only.

Future versions will act on the object (write `~/.claude/dashboard.json`,
then deploy); today it is echo-only by design.

## Prerequisites

1. Verify Node.js is available: `node --version`. If missing, stop and tell the
   user Node.js is required (the statusline is a Node script).
2. Determine the platform (`process.platform` / `$env:OS`). The claudectl
   protocol steps apply to Windows only.

## Step 1 — Preserve what the user already has

1. Read `~/.claude/settings.json`. If it contains a `statusLine` key, save the
   exact current value to `~/.claude/cc-statusline-dashboard.prev-settings.json`
   (create the file with the JSON value; skip if that backup file already
   exists — never overwrite an existing backup on re-activation).
2. **Windows:** run the register script BEFORE copying the statusline — it
   caches the currently-live `~/.claude/statusline.js` (once) as
   `statusline.js.pre-claudectl.bak`, which is the deactivation restore point:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/statusline/claudectl-register.ps1"
   ```

   This registers `HKCU:\Software\Classes\claudectl` (user-level, no admin),
   deploys the handler files to `~/.claude`, and adds a Settings > Apps
   uninstall entry. The handler's mutating verbs are deliberately gated: paths
   are local fixed-drive only with UNC rejected before any filesystem probe
   (drive-by NTLM-leak protection), and process-spawning verbs confirm first.
3. **macOS/Linux:** if `~/.claude/statusline.js` exists and
   `~/.claude/statusline.js.pre-claudectl.bak` does not, copy the former to the
   latter (same restore-point convention, no protocol registration — the
   statusline emits plain `file://` links off-Windows).

## Step 2 — Deploy the statusline

Copy `${CLAUDE_PLUGIN_ROOT}/statusline/statusline.js` to
`~/.claude/statusline.js`, overwriting.

## Step 3 — Wire up settings.json

Merge into `~/.claude/settings.json` (preserve all other keys):

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"<absolute home path>/.claude/statusline.js\""
  }
}
```

Write the user's real absolute home path — `${CLAUDE_PLUGIN_ROOT}` must NOT be
used here (settings.json does not expand it), and `~` expansion inside quoted
Windows commands is unreliable.

## Step 4 — Verify

Pipe a sample payload through the deployed script and confirm two lines render
(model badge on line 1, at least two links on line 2):

```bash
echo '{"model":{"id":"claude-opus-5"},"effort":{"level":"high"},"rate_limits":{"five_hour":{"used_percentage":20,"resets_at":1753500000}},"context_window":{"total_input_tokens":1200,"total_output_tokens":345},"workspace":{"current_dir":"'$HOME'"},"transcript_path":"'$HOME'/.claude/t.jsonl"}' | node ~/.claude/statusline.js
```

On Windows, optionally verify the protocol without launching anything:

```powershell
$env:CLAUDECTL_DRYRUN=1; powershell -NoProfile -File "$env:USERPROFILE\.claude\claudectl-handler.ps1" "claudectl://open/C:/Users"
```

Expect `action=open path=C:\Users dir=True file=False`.

## Step 5 — Report

Tell the user: the dashboard is active on the next statusline refresh (or
restart of Claude Code); links are Ctrl/Alt+click in hyperlink-aware terminals
(Windows Terminal, VS Code, iTerm2, WezTerm); deactivate via
`/cc-statusline-dashboard:deactivate-dashboard` or (Windows) Settings > Apps >
"Claude Control Protocol (claudectl)".
