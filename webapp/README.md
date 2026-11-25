# Actionmoji — build your statusline

A WYSIWYG bench for building **actionmoji**: emoji/glyph buttons for the
claude-tui-dashboard statusline, each carrying a hover tooltip and an optional
`claudectl://` action, welded into one OSC 8 hyperlink.

## Terms

- **Reservoir** — the inventory of prebuilt actionmoji.
- **Forge** — where users extend the reservoir by forging new actionmoji,
  within a set of constraints, to add new capabilities to their dashboard.
- **Staging area** — a toy version of the rendered statusline: a temporary
  space where users experiment with different layouts.
- **Export** — converts the staging area's current layout to JSON.
- **Import** — a skill in the Claude Code plugin that takes that JSON and
  builds the matching statusline in your Claude terminal, so it reflects the
  one built in the webapp.

## How to open

Double-click `webapp/index.html` (or drag it into a browser). It is a single
self-contained file — one `<style>`, one `<script>`, zero external requests —
so it works from `file://`, offline, no build step, no server.

State autosaves to `localStorage` on every change and restores on load.

## The workflow

1. **Reservoir** (left): click a glyph to start a new draft; Ctrl+click to
   stack several glyphs onto the active draft; click a **ramp** to start a
   _gauge_ (its tooltip pre-lists the scale, and you pick which stop is the
   exported "needle" glyph).
2. **Forge** (center): edit each draft card — tooltip (ASCII 32–126
   enforced live, space→`+` fix suggested, char count with the Windows
   Terminal 1024-char display-cut marker), ONE action from the actions
   list (hand-editable), and a freeform keybind (export-only). The
   composed URI updates live and names which composition rule fired.
3. **Place** a card to move it onto the staging area; each placement adds a
   one-line entry to the history panel. Unplaced drafts trigger a reminder
   warning.
4. **The staging area** (top): hover an item for its tooltip prose _and_ the
   exact composed URI. `‹ ›` reorders, `✕` removes, and **Clear all** empties
   the staging area and the drafts after a confirm.
5. **Dividers / flex** inserts skip the drafts and land straight on the
   staging area.
6. **Quicklaunch**: a section of the reservoir. add a prebuilt starter actionmoji ( battery, cache
   thermometer, git intel, …) straight onto the staging area.
7. **Export**: pretty `dashboard.json`, a Copy button, and a Download link.
   **Import**: paste JSON; it is validated row by row, then either appended
   to the staging area or used to replace it.

## The exported schema (`dashboard.json` v1)

```json
{
  "version": 1,
  "row": [
    {
      "type": "button",
      "glyph": "🔥",
      "tooltip": "cache+hot+4:12+left",
      "action": "claudectl://open/C:/Users/jared",
      "keybind": "ctrl+alt+c"
    },
    { "type": "flex", "side": "both" },
    { "type": "divider", "glyph": "|" }
  ]
}
```

- `button` — `glyph` (any string), `tooltip`, `action` always present (may be
  `""`); `keybind` included only when set. `{placeholders}` in actions (e.g.
  `{path}`, `{transcript_path}`, `{session_id}`, `{project_dir}`, `{pr.url}`,
  `{owner}`, `{repo}`) stay **literal** in the export — the statusline
  resolves them at render time.
- `flex` — minimal schema extension: a `side` field, `"both" | "left" |
"right"`. A bare `{"type":"flex"}` (base v1 schema) is accepted on import
  and treated as `side:"both"`.
- `divider` — `glyph` is the divider character.
- Import drops unknown fields and rejects unknown types.

### Tooltip constraints (contract)

ASCII bytes 32–126 only, **no raw spaces** (use `+ . - _ |` as separators),
max 1000 chars. Why: the OSC 8 hover tooltip IS the raw URI — VS Code
collapses any URI containing whitespace to the word "Link", and Windows
Terminal displays only the first 1024 chars. Newlines are impossible by
construction. The editor enforces all of this live and blocks placing drafts that
still contain raw spaces.

### URI composition rule (statusline and handler MUST agree)

- action empty → `claudectl://tip/` + tooltip
- tooltip empty → action
- both present → `claudectl://tip/` + tooltip + `/do/` + `encodeURIComponent(action)`

The `tip` verb is a hover no-op; when a `/do/<encoded>` tail is present the
handler decodes it, requires a match against
`^claudectl://(open|copy|spawn)/`, shows a Yes/No confirm naming the exact
action, then dispatches through the normal allowlist. The staging card and
the staging-area hover card both render this rule faithfully.

## The StateStore seam

All persistence goes through `class StateStore` in the `<script>` block:
`load()` / `save(state)` / `clear()` over `localStorage` today. Two stub
methods mark the next-phase auth seam:

- `loginWithGitHub()` — OAuth device flow; token kept in memory only.
- `syncRemote()` — save and load the same JSON blob to a GitHub gist or
  repo file, merging by timestamp.

Swap the internals of this one class and the app never notices.

## Restyling (Design-mode skin)

The visual layer is deliberately neutral and fully overrideable:

- one `:root` block of custom props (`--bg`, `--fg`, `--accent`, `--gap`, …)
  with a `prefers-color-scheme: dark` twin;
- BEM-ish classes on everything (`.bar`, `.bar__slot`, `.staging__card`,
  `.reservoir__group`, `.actions__item`, `.quicklaunch__item`, `.log__entry`, …);
- state exposed as `data-*` attributes (`[data-active]`, `[data-selected]`,
  `[data-tone]`, `[data-act]`) — never inline styles;
- a marked `/* THEME SKIN SLOT */` section at the end of the stylesheet where
  the skin gets pasted.

## Next phase

- Context-aware keybind hovers (keybind is stored/exported but ignored by the
  statusline today).
- GitHub login + remote state sync via the `StateStore` stubs.
- Gauges that stay live on the staging area (needle re-selectable after
  placement).
- The Design-mode theme skin, pasted into the THEME SKIN SLOT.
