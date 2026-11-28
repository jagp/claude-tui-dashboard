# Actionmoji — build your statusline

A WYSIWYG bench for building **actionmoji**: emoji/glyph widgets for the
claude-tui-dashboard statusline, each carrying a hover tooltip and an optional
`claudectl://` action, welded into one OSC 8 hyperlink.

The webapp edits the same `dashboard.json` (`version: 2`) manifest that the
statusline engine reads. It previews the manifest with the engine's own layout
rules and cell-width algorithm, so what you see in the staging area is what
the terminal prints. The contract is
[`docs/superpowers/specs/2026-11-22-widget-engine-lean.md`](../docs/superpowers/specs/2026-11-22-widget-engine-lean.md);
where this README and the spec disagree, the spec wins.

> **Status (2026-11-25):** the webapp exports and imports v2. The shipped
> `statusline.js` does not read v2 yet: until the engine track of
> `docs/superpowers/plans/2026-11-24-widget-engine-v2.md` (tasks 2–9) lands,
> it ignores a v2 `dashboard.json` and prints its built-in bar.

## Terms

- **Reservoir** — the inventory of prebuilt actionmoji.
- **Forge** — where users extend the reservoir by forging new actionmoji,
  within a set of constraints, to add new capabilities to their dashboard.
- **Staging area** — a toy version of the rendered statusline: a temporary
  space where users experiment with different layouts.
- **Widget** — one placed actionmoji: a glyph or label of a fixed **width**
  (in terminal cells), sitting at a **slot** on a **row**.
- **Budget** — the most cells a row may occupy. The webapp enforces it.
- **Export** — converts the staging area's current layout to a v2 JSON
  manifest.
- **Import** — a skill in the Claude Code plugin that takes that JSON and
  builds the matching statusline in your Claude terminal, so it reflects the
  one built in the webapp.

## How to open

Open the hosted page in any current browser, or open `webapp/index.html`
from a checkout. There is no build step and no server. The page's own styles
and scripts are inline; it also loads one shared script,
`../plugins/claude-tui-dashboard/statusline/statusline-contract.js` (see
[Tests](#tests)), so whatever hosts the page must serve the repository root,
not only `webapp/`. The only outside request is for the web fonts, which fall
back to the system monospace font when offline.

State autosaves to `localStorage` on every change and restores on load.

The staging area previews every widget with **sample readings**
(`plugins/claude-tui-dashboard/contract/sensors.sample.json`), not your live
session, so you can see how a widget fills its width before you export it.

## The workflow

1. **Rows** (panel): add or remove rows. Each row has a **budget** in cells
   and a default **separator** (`space` preselected, `pipe` offered). The
   same panel lists the separator types; add your own (its width is measured
   from its text).
2. **Reservoir** (left): click a glyph to start a new draft; Ctrl+click to
   stack several glyphs onto the active draft; click a **ramp** to start a
   _gauge_ (its tooltip pre-lists the scale, and you pick which stop is the
   exported "needle" glyph).
3. **Forge** (center): edit each draft card:
   - **row** and **slot** (where it sits; slot is a sort key, ties keep file
     order);
   - **width**, in terminal cells (required). The card previews the content at
     exactly that width and shows its measured width; **fit width** sets one to
     the other. Shorter content is padded with spaces; longer content is cut
     and ends in `…`;
   - **sep**, an optional separator override in front of this widget;
   - **hideAbsent**, so a widget with no data shows blank cells instead of the
     placeholder;
   - **sensors** (picked from the sample readings), **label**, **tooltip**
     (ASCII 32–126 enforced live, space→`+` fix suggested, char count with the
     Windows Terminal 1024-char display-cut marker), and ONE **action** from
     the actions list (hand-editable; picking one also binds the sensor it
     reads), plus a freeform keybind (export-only).
     The composed URI updates live and names which composition rule fired.
4. **Place** a card to move it onto the staging area; each placement adds a
   one-line entry to the history panel. Unplaced drafts trigger a reminder
   warning.
5. **The staging area** (top): every row renders the preview, animated once
   a second, with a **budget meter** (`used / budget`). Hover an item for its
   tooltip prose _and_ the exact composed URI. `‹ ›` reorders within the row,
   `˄ ˅` moves to the row above or below, `✎` brings the widget back into the
   forge for editing, `✕` removes,
   and **Clear all** empties the staging area and the drafts after a confirm.
   **Place is disabled while a row is over budget**, and the reason is shown.
6. **Quicklaunch**: a section of the reservoir. Add a prebuilt starter
   widget (battery, cache thermometer, git intel, …), with its sensors, width,
   tooltip and action already wired, straight onto the last row, if it fits
   that row's budget.
7. **Manifest settings**: the manifest-wide `hideAbsent` toggle and the
   placeholder frames.
8. **Export**: pretty `dashboard.json` (`version: 2`), a Copy button, and a
   Download link; save the file as `~/.claude/dashboard.json`. **Import**:
   paste JSON; it is validated as a whole (an invalid manifest is rejected
   with the same reason the statusline gives), then
   either merged into the staging area or used to replace it. Only
   `version: 2` files are accepted.

## The exported schema (`dashboard.json` v2)

```json
{
  "version": 2,
  "hideAbsent": false,
  "placeholder": { "frames": ["◐", "◓", "◑", "◒"], "color": "dim" },
  "separators": {
    "space": { "text": " ", "width": 1 },
    "pipe": { "text": " │ ", "width": 3 }
  },
  "rows": [
    { "row": 1, "separator": "space", "budget": 78 },
    { "row": 2, "separator": "space", "budget": 78 }
  ],
  "widgets": [
    {
      "id": "branch",
      "row": 2,
      "slot": 1,
      "width": 24,
      "sensors": { "ws": "workspace", "git": "git" },
      "label": [{ "text": "⑂ {ws.branchShort}" }, { "text": " ↑{git.ahead}" }],
      "tooltip": ["branch", "{ws.branch}", ["ahead", "{git.ahead}"]],
      "action": "{ws.pathUrl}"
    },
    {
      "id": "ci",
      "row": 2,
      "slot": 2,
      "width": 4,
      "sep": "pipe",
      "hideAbsent": true,
      "sensor": "ci",
      "label": "{ci.glyph}"
    }
  ]
}
```

### Manifest fields

- `version` — must be `2`. The engine reads nothing else: a missing file,
  bad JSON, or any other version falls back to the plugin's
  `dashboard.default.json`.
- `hideAbsent` (bool, default `false`) — hide every widget that has no data.
  A widget can turn hiding on for itself but cannot turn off a manifest-level
  `true`.
- `placeholder` — the frames and color of the animated "collecting data"
  glyph. The frame shown is `frames[floor(now / 1 s) mod frames.length]`.
- `separators` — named types, each with the `text` it prints and the `width`
  in cells it takes. `width` must equal the cell width of `text`.
- `rows[]` — `row` (number), `separator` (the default type between adjacent
  widgets on that row), `budget` (the row's width limit in cells).

### Widget fields

- `id` — unique in the manifest.
- `row`, `slot` — where it goes. `slot` is any positive integer, used only to
  sort.
- `width` — **required**, a positive integer, in terminal cells. A manifest
  with a widget that lacks one is rejected as a whole, by the webapp on import
  and by the engine at render time.
- `sensors` — maps an alias to a sensor id; templates read `{alias.reading}`.
  `"sensor": "git"` is shorthand for `{ "git": "git" }`. With exactly one
  bound sensor, a bare `{reading}` reads it too. A widget with no sensors is
  static. A widget may bind several sensors. The sensors and their readings
  are listed in §7 of the August draft.
- `sep` — optional separator type in front of this widget; ignored on the
  row's first widget.
- `hideAbsent` — optional, see above.
- `cluster` — optional documentation label; the engine ignores it.
- Presentation fields kept from the August draft (§5.3–§5.6 of
  `2026-08-29-widget-engine-design.md`): `glyph`, `label`, `color`, `dress`,
  `ramps`, `tooltip`, `action`.
  - `label` is a template string, a parts array, or `{ "parts": [...],
    "join": " " }`. Each part is one unit: if any placeholder in it is empty,
    the whole part drops out. A plain string is a single unit. It defaults to
    `{glyph}`.
  - `tooltip` is a word array; a nested array is an optional group that drops
    whole when any of its words is empty.
  - `action` is a template too, e.g. `{ws.pathUrl}`, `{pr.url}`,
    `claudectl://copy/{session.id}`. Templates stay **literal** in the
    export; the statusline fills them at render time. The preview resolves
    ramps to their first stop; the engine evaluates them properly.
- Unknown fields are ignored by the engine and preserved by the webapp.

### Layout rules (the engine/webapp sync contract)

For each row: sort its widgets by `slot`, render each one at exactly `width`
cells, and print between each adjacent pair the right-hand widget's `sep`, or
else the row's `separator`. Nothing prints before the first widget or after
the last. There is no smart layout: nothing collapses, reflows, or drops.

- **Width is exact.** Short content is padded with trailing spaces, so
  positions further along the row never move. Overlong content is cut at a
  grapheme boundary to at most `width − 1` cells and ends in `…` (a space
  fills the gap if the cut lands inside a 2-cell glyph).
- **No data** (every bound sensor absent) shows the placeholder, or blank
  cells when hidden. Both still occupy `width`, and the separators on either
  side still print.
- **Row width** = the sum of the widget widths plus the widths of the
  separators actually printed. The webapp keeps it at or under `budget`.
- **Cell width** follows the spec's reference pseudocode (§5.1): ANSI and
  OSC 8 sequences are stripped, wide emoji and East Asian Wide characters
  count 2, combining marks count 0. The webapp and the engine both test
  against the shared vectors in `cell-width.vectors.json` and the layout
  vectors.

### Tooltip constraints (contract)

ASCII bytes 32–126 only, **no raw spaces** (use `+ . - _ |` as separators),
max 1000 chars once resolved. Write a plain `%`: the statusline encodes it
to `%25`, and turns any whitespace in a reading into `+`. Why: the OSC 8 hover tooltip IS the raw URI — VS Code
collapses any URI containing whitespace to the word "Link", and Windows
Terminal displays only the first 1024 chars. Newlines are impossible by
construction. The editor enforces all of this live and blocks placing drafts
that still contain raw spaces.

### URI composition rule (statusline and handler MUST agree)

- action empty → `claudectl://tip/` + tooltip
- tooltip empty → action
- both present → `claudectl://tip/` + tooltip + `/do/` + `encodeURIComponent(action)`

The `tip` verb is a hover no-op; when a `/do/<encoded>` tail is present the
handler decodes it, requires a match against
`^claudectl://(open|copy|spawn)/`, shows a Yes/No confirm naming the exact
action, then dispatches through the normal allowlist. The manifest cannot add
a new verb. The draft card and the staging-area hover card both render this
rule faithfully.

## Tests

```bash
node plugins/claude-tui-dashboard/tests/engine.tests.js   # the shared rules
node tests/webapp/contract.tests.js                       # webapp-only checks
```

Everything that must match the statusline (cell width, fitting, layout,
templates, validation) lives in one file,
`plugins/claude-tui-dashboard/statusline/statusline-contract.js`, with no DOM
access. The statusline `require()`s it and this page loads it with a
`<script>` tag, so there is one copy, not two. The engine tests run it against
the shared files in `plugins/claude-tui-dashboard/contract/`:

| File | Pins |
|---|---|
| `cell-width.vectors.json` | cell widths, plus the East Asian Wide ranges |
| `layout.vectors.json` | slot order, padding, truncation, separators |
| `render.vectors.json` | templates, part dropping, placeholder, hiding |
| `manifest.vectors.json` | which manifests are invalid, and the exact reason |
| `sensors.sample.json` | the readings the preview uses |

Two data copies remain, each pinned by a test: the East Asian Wide ranges in
the shared file, and the sample readings embedded in `index.html`. The webapp
test also fails if the page stops loading the shared file or declares its own
copy of any shared function. CI runs both tests on every push.

## The StateStore seam

All persistence goes through `class StateStore` in the `<script>` block:
`load()` / `save(state)` / `clear()` over `localStorage` today. Two stub
methods mark the next-phase auth seam:

- `loginWithGitHub()` — OAuth device flow; token kept in memory only.
- `syncRemote()` — save and load the same JSON blob to a GitHub gist or
  repo file, merging by timestamp.

Swap the internals of this one class and the app never notices.

## Restyling (Design-mode skin)

The visual layer is deliberately neutral and fully overridable:

- one `:root` block of custom props (`--bg`, `--fg`, `--accent`, `--gap`, …)
  with a `prefers-color-scheme: dark` twin;
- BEM-ish classes on everything (`.bar`, `.bar__slot`, `.forge__card`,
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
- An `add-widget` skill that adds a widget to any row (waits for the engine).
