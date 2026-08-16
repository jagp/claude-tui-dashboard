---
name: add-widget
description: This skill should be used when the user asks to "add a widget", "add a widget to the statusline", "put 🔥 in slot 3", "wire up a glyph as a widget", "add an actionmoji", "show the widget map", "show the slot legend", or runs /cc-statusline-dashboard:add-widget. Wires a glyph into a numbered dashboard-row slot and prints the slot map with the 78-cell soft-cap guardrail.
allowed-tools: Read, Bash, AskUserQuestion
---

# Add a widget to the statusline

Wire a glyph into a numbered **widget slot** on the dashboard row (the
statusline's third line) by editing `~/.claude/dashboard.json` through the
bundled deterministic tool, `scripts/widget-map.js`. The data structure is the
shared web-app ↔ statusline contract; consult
`${CLAUDE_PLUGIN_ROOT}/docs/widget-schema.md` before deviating from the steps
below (slot geometry, the no-clobber insertion rule, overwrite semantics).

Resolve the plugin root first: it is two directory levels above this skill's
base directory (`<plugin-root>/skills/add-widget/` → `<plugin-root>`). Below,
`${CLAUDE_PLUGIN_ROOT}` means that resolved absolute path — substitute it
literally in every command, and keep the quotes (the path may contain spaces).

## Argument grammar (phased)

`/cc-statusline-dashboard:add-widget [<slot>] [<glyph>]`

| Argument          | Position | Phase        | Meaning |
|-------------------|----------|--------------|---------|
| `<slot>`          | p1       | 1 — live     | Widget slot `1..12` along the dashboard row |
| `<glyph>`         | p2       | 1 — live     | The emoji, given as itself (`🔥`) |
| `action=<uri>`    | named    | 2 — reserved | Click action (`claudectl://` / `https`) |
| `tooltip=<prose>` | named    | 3 — reserved | Hover prose (ASCII 32–126, no raw spaces) |

- **No arguments** → run Step 1 only and stop: the map IS the answer to
  "where are the numbered positions?".
- **`action=` / `tooltip=` supplied today** → explain they are phase-2/3
  arguments not accepted yet; the fields already exist in the wire format
  (any button carries them), only the skill-side plumbing is pending.

## Step 1 — Show the map first

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/add-widget/scripts/widget-map.js" map
```

Always print this legend before wiring anything — the user is choosing a
numbered position and deserves to see current occupancy and row width first:

```
 slot    1   2   3   4   5   6   7   8   9  10  11  12
 glyph   ·   ·  🔥   ·   ·   ·   ·   ·   ·   ·   ·   ·
 row width ≈ 2 / 78 cells ✓
```

If the invocation had no arguments, stop here.

## Step 2 — Wire the widget

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/add-widget/scripts/widget-map.js" add <slot> <glyph>
```

Dispatch on the exit code:

| Exit | Meaning | Response |
|------|---------|----------|
| 0 | Wired | Relay the printed legend and any warnings; go to Step 4 |
| 1 | Bad arguments | Re-check slot ∈ 1..12 and that a glyph was given |
| 2 | `dashboard.json` corrupt or non-v1 | Show the error; offer to inspect the file with the user. Never bypass by hand-editing — the tool refuses precisely to preserve evidence |
| 3 | Slot occupied | Go to Step 3 |

## Step 3 — Occupied slot: the overwrite flow

This is the seam for the future **`overwrite-widget-glyph`** function (schema
doc, "Occupancy & overwrite"). Until it exists, emulate it: use
AskUserQuestion, naming the occupant glyph from the exit-3 message and the
requested new glyph, with options **Overwrite the glyph** / **Pick a different
slot** / **Cancel**. On overwrite, re-run with `--force`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/add-widget/scripts/widget-map.js" add <slot> <glyph> --force
```

`--force` is glyph-only: the occupant's `tooltip`, `action`, `keybind`, and
any unknown fields survive. On "different slot", show the map again and ask
which; on cancel, stop.

## Step 4 — Guardrails

Relay the tool's warnings verbatim, never suppress them:

- **`⚠ OVER SOFT CAP`** — estimated row width crossed 78 cells. Soft means
  soft: the widget is already wired; tell the user the bar may wrap in
  narrower terminals and offer to remove/relocate widgets if they care.
- **ZWJ-sequence glyph** — may split or tofu in some terminals
  (`${CLAUDE_PLUGIN_ROOT}/docs/customizing-glyphs.md`, "Rendering caveats").
- **Over the 5-cell slot budget** — the glyph is wider than a slot's default
  allowance; fine for one widget, crowding at twelve.

## Step 5 — Verify and report

If `~/.claude/statusline.js` exists, prove the widget renders — pipe any small
payload through the *deployed* script and confirm the last output line
contains the glyph:

```bash
echo '{"model":{"id":"claude-opus-5"}}' | node ~/.claude/statusline.js
```

If the glyph is absent from that last line, the deployed statusline likely
predates the dashboard row — redeploy via `/cc-statusline-dashboard:install`
rather than debugging the widget file (the tool already proved the wire is
good). If `~/.claude/statusline.js` does not exist at all, point at the
install skill instead of debugging render output.

Then tell the user: the widget appears on the next statusline refresh; the row
is `~/.claude/dashboard.json`, shared with the web configurator (`webapp/` in
the plugin's source repository — not shipped with the plugin; note its import
currently drops `slot` fields; see the schema doc's open questions).

## Additional resources

- **`${CLAUDE_PLUGIN_ROOT}/docs/widget-schema.md`** — the shared contract:
  wire format, slot geometry constants, insertion rule, overwrite semantics,
  glyph-identity roadmap (Unicode code points, not "ISO keystrokes")
- **`scripts/widget-map.js`** — the deterministic tool; `--file <path>` /
  `DASHBOARD_JSON` env target an alternate file for dry-runs
