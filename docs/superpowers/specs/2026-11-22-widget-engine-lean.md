# Widget engine, lean spec

**Date:** 2026-11-22
**Status:** Agreed in conversation; not yet ratified. The decisions below are
the user's. Items marked *assumed* are Claude's and need confirmation.
**Replaces:** `2026-08-29-widget-engine-design.md` (the August draft) wherever
the two disagree. §7 lists the August sections that still apply.

## 1. What it is

`statusline.js` splits into an **engine** (code) and a **manifest** (JSON).
The manifest says which widgets exist and where they go. The engine runs the
sensors, draws each widget, and puts separators between them. Every row of
the bar comes from the manifest.

Matching today's bar output is **not** a goal. The new contract defines the
output.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | `slot` is a sort key (any positive integer); ties keep the order in the file. |
| D2 | The manifest is `~/.claude/dashboard.json` with `version: 2`. The plugin ships `dashboard.default.json`. |
| D3 | `cluster` is a documentation label only. The engine ignores it. |
| D4 | A widget may bind several sensors. There is no one-sensor rule. |
| D5 | **Hiding is a manifest toggle, `hideAbsent`, and it defaults to off.** With it off, a widget with no data shows the **placeholder**: a single animated glyph that means "collecting data" (§5). The webapp exposes both the toggle and the placeholder. |
| D6 | **No smart layout.** The engine never collapses, reflows or drops anything, and it pads only to fill a widget's declared width (D7). Separators come from the layout, and no widget owns one. |
| D7 | **Widgets declare their width,** in terminal cells, and may declare as much as their content needs. A widget always occupies exactly its width. Shorter content is padded with trailing spaces, so positions further along the row stay fixed. Content wider than its width is cut to `width − 1` cells and ends with a 1-cell ellipsis (`…`). The webapp enforces each row's budget while the user builds the bar. |
| D8 | Keep this spec lean: anything not needed now is listed in §8. |

## 3. Manifest

```json
{
  "version": 2,
  "hideAbsent": false,
  "placeholder": { "frames": ["◐", "◓", "◑", "◒"], "color": "dim" },
  "separators": {
    "pipe":  { "text": " │ ", "width": 3 },
    "space": { "text": " ",   "width": 1 }
  },
  "rows": [
    { "row": 1, "separator": "pipe",  "budget": 78 },
    { "row": 2, "separator": "space", "budget": 78 }
  ],
  "widgets": [
    { "id": "branch", "row": 2, "slot": 1, "width": 24,
      "sensors": { "ws": "workspace", "git": "git" },
      "label": "⑂ {ws.branchShort}{git.ahead}", "tooltip": ["…"], "action": "…" }
  ]
}
```

- **`hideAbsent`** (bool, default `false`): when it's on, a widget with no data prints nothing instead of the placeholder.
- **`placeholder`**: the frames of the animated glyph, and its color.
- **`separators`** are separator types: the text each one prints and the cells it takes.
- **`rows[].separator`** names the type that goes between adjacent widgets on that row. **`budget`** is the row's width in cells, which the webapp enforces.
- **`widgets[]`** fields: `id`, `row`, `slot`, `width` (cells, required), `sensors`, `cluster` (optional, a documentation label), plus the presentation fields kept from the August draft (§7).
- **`sensors`** maps an alias to a sensor id; templates read it as `{alias.reading}`. A single `"sensor": "git"` is shorthand for `{ "git": "git" }`. A widget with no sensors is static.
- Unknown fields are ignored by the engine and preserved by tooling.

## 4. Layout (the engine/webapp sync contract)

For each row, in `rows` order:

1. Take the widgets on that row, sorted by `slot`.
2. Render each widget (§5).
3. Join adjacent widgets with the row's separator. Put none before the first widget or after the last.
4. Join the rows with newlines.

That's the whole layout. A hidden widget prints nothing, and the separators on
both sides of it still print. The webapp checks the budget with
`Σ widths + (n − 1) × separator width ≤ budget`.

## 5. Rendering one widget

- **Cells, not characters.** Width is measured in terminal cells. Emoji and East Asian wide characters count as 2. The engine and the webapp must share one cell-width function.
- **Exact width:** every rendered widget, the placeholder included, occupies exactly `width` cells. Shorter content is padded on the right with spaces. Content wider than `width` is cut to `width − 1` cells and ends with `…`.
- **No data:** a widget is *absent* when every sensor it binds is absent. An absent widget renders the placeholder's current frame, or nothing when `hideAbsent` is on. If only some of its sensors are absent, the template fragments that use them drop out (the August draft's "drop the whole fragment" rule).
- **Animation:** the frame is `frames[floor(now / 1 s) mod frames.length]`, so the glyph moves forward each time the bar redraws.
- **Errors:** a widget whose rendering throws is treated as absent.

A usage window appears only when the manifest declares a widget for it. Until
that window has data, the widget shows the placeholder.

## 6. Tests

Tests pin this contract, not today's output. They cover: slot ordering,
separator insertion (none at the row edges, and still printed around a
hidden widget), cell-width measurement including emoji, padding short content to width,
overflow truncation,
the placeholder and its frame selection, the `hideAbsent` toggle,
partial-absence fragment dropping, multi-sensor templates, and the budget
arithmetic shared with the webapp.

## 7. Still in force from the August draft

| August section | Status |
|---|---|
| §5.3 templates and placeholders | in force |
| §5.4 ramps, stops, matchers | in force |
| §5.5 colors and dress | in force |
| §5.6 the tip/do link URI | in force |
| §7 sensor catalog | in force; "absent" now means placeholder (or hidden under `hideAbsent`); `windows` with `args.key: "*"` is retired |
| §6.1 tick | in force |
| §3 glossary | in force, except the entries voided below |

**Void:** clusters as structure (§5.1 layout, the `Cluster` class), `glue`,
`show`, `fill`, twins, flex items, §6.3 layout, §6.4 fill, §8 v1
compatibility, §10 fidelity, the "80-check suite stays green" invariant, and
assumptions A1, A3 and A5.

## 8. Not built (recorded)

- A left (or right) wall separator at the row edges.
- Choosing a separator per boundary instead of one per row.
- The webapp's v2 editor and export.
- A new `add-widget` skill that works on any row. (The August-era stub was
  deleted.)

## 9. Assumed (Claude's, unconfirmed)

- **S1** One separator type per row is enough for now (per-boundary choice is in §8).
- **S3** The default placeholder frames are `◐◓◑◒`, dimmed, advancing once a second. Any frames can be configured in the webapp.
- **S4** `hideAbsent` is a single setting for the whole manifest; there's no per-widget override.
