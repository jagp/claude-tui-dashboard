# Actionmoji — stage · commit · push your statusline

A WYSIWYG bench for building **actionmoji**: emoji/glyph buttons for the
claude-tui-dashboard extra row, each carrying a hover tooltip and an optional
`claudectl://` action, welded into one OSC 8 hyperlink. The whole UI speaks git
as a metaphor: the reservoir is your object store, staging is the index, the
mock statusline bar is HEAD, export is `git push`, import is `git pull`.

## How to open

Double-click `webapp/index.html` (or drag it into a browser). It is a single
self-contained file — one `<style>`, one `<script>`, zero external requests —
so it works from `file://`, offline, no build step, no server.

State autosaves to `localStorage` on every change and restores on load.

## The workflow

1. **Reservoir** (left): click a glyph to stage it as a new draft
   (`git add`); Ctrl+click to stack several glyphs onto the active draft;
   click a **ramp** to stage a *gauge* (its tooltip pre-lists the scale, and
   you pick which stop is the exported "needle" glyph).
2. **The index** (center): edit each draft card — tooltip (ASCII 32–126
   enforced live, space→`+` fix suggested, char count with the Windows
   Terminal 1024-char display-cut marker), ONE action from the actions
   reservoir (hand-editable), and a freeform keybind (export-only). The
   composed URI updates live and names which composition rule fired.
3. **git commit** on a card moves it to the bar and appends a one-liner to
   `git log`. Drafts left in the index earn a "detached HEAD vibes" warning.
4. **The bar** (top): hover an item for its tooltip prose *and* the exact
   composed URI. `‹ ›` reorders (interactive rebase), `✕` removes
   (`git revert`), `git reset --hard` clears bar + index after a confirm.
5. **Dividers / flex** inserts skip the index and land straight on the bar.
6. **Quicklaunch**: `git clone` a prebuilt starter (burn-rate battery, cache
   thermometer, git intel, …) straight onto the bar.
7. **git push**: export panel with pretty `dashboard.json`, Copy button, and
   a Download link. **git pull**: paste JSON, validated like a pre-receive
   hook, then merge (append) or force (replace).

## The exported schema (`dashboard.json` v1)

```json
{
  "version": 1,
  "row": [
    {"type":"button","glyph":"🔥","tooltip":"cache+hot+4:12+left","action":"claudectl://open/C:/Users/jared","keybind":"ctrl+alt+c"},
    {"type":"flex","side":"both"},
    {"type":"divider","glyph":"|"}
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
- **Widget layer (draft)** — the plugin's add-widget skill stamps buttons with
  a numbered `slot` field (1–12); contract:
  `plugins/cc-statusline-dashboard/docs/widget-schema.md`. Import currently
  drops `slot`, so a pull-then-push cycle strips it — preserving it (the way
  `keybind` already survives) is a next-phase task below.

### Tooltip constraints (contract)

ASCII bytes 32–126 only, **no raw spaces** (use `+ . - _ |` as separators),
max 1000 chars. Why: the OSC 8 hover tooltip IS the raw URI — VS Code
collapses any URI containing whitespace to the word "Link", and Windows
Terminal displays only the first 1024 chars. Newlines are impossible by
construction. The editor enforces all of this live and blocks commits that
still contain raw spaces.

### URI composition rule (statusline and handler MUST agree)

- action empty → `claudectl://tip/` + tooltip
- tooltip empty → action
- both present → `claudectl://tip/` + tooltip + `/do/` + `encodeURIComponent(action)`

The `tip` verb is a hover no-op; when a `/do/<encoded>` tail is present the
handler decodes it, requires a match against
`^claudectl://(open|copy|spawn)/`, shows a Yes/No confirm naming the exact
action, then dispatches through the normal allowlist. The staging card and
the bar hover-card both render this rule faithfully.

## The StateStore seam

All persistence goes through `class StateStore` in the `<script>` block:
`load()` / `save(state)` / `clear()` over `localStorage` today. Two stub
methods mark the next-phase auth seam:

- `loginWithGitHub()` — OAuth device flow; token kept in memory only.
- `syncRemote()` — push/pull the same JSON blob to a gist/repo file,
  merging by timestamp.

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

- Preserve the widget layer's `slot` field on import (see "The exported
  schema" above) so skill-wired widgets survive a webapp round-trip.
- Context-aware keybind hovers (keybind is stored/exported but ignored by the
  statusline today).
- GitHub login + remote state sync via the `StateStore` stubs.
- Gauges that stay live on the bar (needle re-selectable after commit).
- The Design-mode theme skin, pasted into the THEME SKIN SLOT.
