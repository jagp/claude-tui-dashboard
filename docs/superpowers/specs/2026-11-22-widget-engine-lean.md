# Widget engine, lean spec

**Date:** 2026-11-22 (ratified 2026-11-24)
**Status:** Ratified. The decisions below are the user's; the few calls left
to Claude are marked *Claude's call* and can be overridden.
**Replaces:** `2026-08-29-widget-engine-design.md` (the August draft) wherever
the two disagree. §7 lists the August sections that still apply. The July
v1 documents are archived (§9).

## 1. What it is

`statusline.js` splits into an **engine** (code) and a **manifest** (JSON).
The manifest says which widgets exist and where they go. The engine runs the
sensors, draws each widget, and puts separators between them. Every row of
the bar comes from the manifest. The **webapp** edits the same manifest and
previews it with the same layout rules (§4) and the same cell-width
algorithm (§5.1).

Matching today's bar output is **not** a goal. The new contract defines the
output.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | `slot` is a sort key (any positive integer); ties keep the order in the file. |
| D2 | The manifest is `~/.claude/dashboard.json` with `version: 2`. The plugin ships `dashboard.default.json`, used when the user has no manifest. |
| D3 | `cluster` is a documentation label only. The engine ignores it. |
| D4 | A widget may bind several sensors. There is no one-sensor rule. |
| D5 | **Hiding is opt-in, at two levels.** `hideAbsent` can be set on the manifest and on any widget; both default to off. A widget is hidden when *either* level is on: the two never cancel, so a widget cannot switch off a manifest-level `true`. With hiding off, a widget with no data shows the **placeholder**: a single animated glyph that means "collecting data" (§5). With hiding on, it shows blank space. Either way it occupies its declared width (D7). |
| D6 | **No smart layout.** The engine never collapses, reflows or drops anything, and it pads only to fill a widget's declared width (D7). Separators come from the layout, and no widget owns one. |
| D7 | **Widgets declare their width,** in terminal cells, and may declare as much as their content needs. A widget always occupies exactly its width. Shorter content is padded with trailing spaces, so positions further along the row stay fixed. Content wider than its width is cut to `width − 1` cells and ends with a 1-cell ellipsis (`…`). The webapp enforces each row's budget while the user builds the bar. |
| D8 | Keep this spec lean: anything not needed now is listed in §8. |
| D9 | **Several separator types.** The manifest defines named types. Each row names a default type, normally `space`; `pipe` is the usual alternative. A widget may override the separator in front of it with `sep`. |
| D10 | **The default manifest is today's statusline,** re-expressed as v2 widgets. It is a placeholder for the user's own design, not a fidelity target: small differences from today's output are fine. |
| D11 | **v1 is retired.** The engine reads only `version: 2`. The v1 row-3 reader, the v1 fixture, and the webapp's v1 export are replaced, not kept for compatibility. Anything else (a missing file, bad JSON, another version) falls back to `dashboard.default.json`. |
| D12 | **One cell-width algorithm, two implementations.** The engine (Node) and the webapp (browser) cannot import a common module, so both implement the reference pseudocode in §5.1 and both must pass the same conformance vectors (§6). |
| D13 | **Placeholder:** `◐ ◓ ◑ ◒`, dimmed, advancing once a second. Any frames can be configured. |

## 3. Manifest

```json
{
  "version": 2,
  "hideAbsent": false,
  "placeholder": { "frames": ["◐", "◓", "◑", "◒"], "color": "dim" },
  "separators": {
    "space": { "text": " ",   "width": 1 },
    "pipe":  { "text": " │ ", "width": 3 }
  },
  "rows": [
    { "row": 1, "separator": "space", "budget": 78 },
    { "row": 2, "separator": "space", "budget": 78 }
  ],
  "widgets": [
    { "id": "branch", "row": 2, "slot": 1, "width": 24,
      "sensors": { "ws": "workspace", "git": "git" },
      "label": "⑂ {ws.branchShort}{git.ahead}", "tooltip": ["…"], "action": "…" },
    { "id": "ci", "row": 2, "slot": 2, "width": 4, "sep": "pipe",
      "hideAbsent": true, "sensor": "ci", "label": "{ci.glyph}" }
  ]
}
```

- **`hideAbsent`** (bool, default `false`), on the manifest and on any widget: see D5.
- **`placeholder`**: the frames of the animated glyph, and its color.
- **`separators`**: named types, each with the text it prints and the cells it takes. `width` must equal the cell width of `text` (§5.1); tooling checks this.
- **`rows[]`**: `row` (number), `separator` (the default type between adjacent widgets on that row), `budget` (the row's width in cells, which the webapp enforces).
- **`widgets[]`** fields: `id`, `row`, `slot`, `width` (cells, required), `sensors`, optional `sep` (separator type in front of this widget; ignored on the row's first widget), optional `hideAbsent`, optional `cluster` (a documentation label), plus the presentation fields kept from the August draft (§7).
- **`sensors`** maps an alias to a sensor id; templates read it as `{alias.reading}`. A single `"sensor": "git"` is shorthand for `{ "git": "git" }`. A widget with no sensors is static.
- Unknown fields are ignored by the engine and preserved by tooling.

## 4. Layout (the engine/webapp sync contract)

For each row, in `rows` order:

1. Take the widgets on that row, sorted by `slot`.
2. Render each widget (§5).
3. Between each pair of adjacent widgets, print the right-hand widget's `sep` if it has one, else the row's `separator`. Print nothing before the first widget or after the last.
4. Join the rows with newlines.

That's the whole layout. Layout depends only on widths and never on what a
widget shows: a hidden widget is `width` blank cells, and the separators on
both sides of it still print. A row's width is
`Σ widths + Σ widths of the separators actually printed`, and the webapp
keeps it `≤ budget`.

## 5. Rendering one widget

- **Exact width:** every rendered widget, the placeholder included, occupies exactly `width` cells. Shorter content is padded on the right with spaces. Content wider than `width` is cut at a grapheme boundary to at most `width − 1` cells, then `…` is added; if the cut lands mid-way through a 2-cell grapheme, a space fills the gap so the total is still exact.
- **No data:** a widget is *absent* when every sensor it binds is absent. An absent widget renders the placeholder's current frame, or blank space when hidden (D5). Both are padded to `width`. If only some of its sensors are absent, the template fragments that use them drop out (the August draft's "drop the whole fragment" rule).
- **Animation:** the frame is `frames[floor(now / 1 s) mod frames.length]`, so the glyph moves forward each time the bar redraws.
- **Errors:** a widget whose rendering throws is treated as absent. The engine as a whole never throws and always prints (§5.2).

A usage window appears only when the manifest declares a widget for it. Until
that window has data, the widget shows the placeholder.

### 5.1 Cell width (reference pseudocode)

Both implementations follow this exactly. ANSI escape sequences (colors, OSC 8
links) are stripped before measuring.

```
cellWidth(text):
  total = 0
  for each grapheme g in text            # Intl.Segmenter, granularity "grapheme"
    total += graphemeWidth(g)
  return total

graphemeWidth(g):
  if g contains a code point with Emoji_Presentation
     or Regional_Indicator, or contains U+FE0F        -> 2
  if g's first code point is East Asian Wide or Fullwidth -> 2
  if g is only zero-width code points
     (combining marks, U+200B–U+200D, U+FE00–U+FE0F)  -> 0
  otherwise                                           -> 1
```

`Intl.Segmenter` and Unicode property escapes exist in Node ≥ 20 and in
current browsers, so neither side needs a library. The East Asian Wide and
Fullwidth test is a short, fixed list of code-point ranges; the list is
stored under the `eastAsianWide` key of `cell-width.vectors.json` and
copied into the one shared implementation (`statusline-contract.js`, which
the engine and the webapp both load). (Flags are two regional indicators and
keycaps are `digit + FE0F + 20E3`; neither is `Extended_Pictographic` with
presentation, which is why the first rule tests presentation directly.) *Claude's call:* the vectors, not the prose, are the
tiebreaker if the two ever disagree.

### 5.2 Constraints carried from the v1 plan

- The engine never throws and always prints. Any internal failure falls back to simpler output: a broken widget becomes absent, a broken manifest falls back to the default.
- No npm dependencies. Plain Node, CommonJS, built-in modules only.
- Paths under `~/.claude` can be redirected by environment variable (`DASHBOARD_JSON` for the manifest) so tests never touch the real home directory.
- Link actions keep the tip/do URI rule and the handler's allowlist; nothing in the manifest can add a new verb.

## 6. Tests

Tests pin this contract, not today's output.

- **Engine:** slot ordering; separator insertion (row default, per-widget `sep`, none at the row edges, still printed around a hidden widget); padding short content to width; overflow truncation, including a cut through a 2-cell grapheme; the placeholder and its frame selection; hiding at manifest level, widget level, and both (a widget cannot un-hide); partial-absence fragment dropping; multi-sensor templates; fallback to the default manifest on a missing, corrupt, or v1 file; never throws.
- **Conformance vectors:** one shared file, `cell-width.vectors.json`, of `[text, expectedWidth]` pairs covering ASCII, combining marks, CJK, single emoji, emoji with U+FE0F, ZWJ sequences, flags, and text wrapped in ANSI colors and OSC 8 links. The engine's tests and the webapp's tests both run every vector.
- **Layout vectors:** a second shared file of small manifests with their expected row widths, so the webapp's budget arithmetic and the engine's output are checked against the same cases.

## 7. Still in force from the August draft

| August section | Status |
|---|---|
| §5.3 templates and placeholders | in force |
| §5.4 ramps, stops, matchers | in force |
| §5.5 colors and dress | in force |
| §5.6 the tip/do link URI | in force |
| §7 sensor catalog | in force; "absent" now means placeholder (or hidden, D5); `windows` with `args.key: "*"` is retired |
| §6.1 tick | in force |
| §3 glossary | in force, except the entries voided below |

**Void:** clusters as structure (§5.1 layout, the `Cluster` class), `glue`,
`show`, `fill`, twins, flex items, §6.3 layout, §6.4 fill, §8 v1
compatibility, §10 fidelity, the "80-check suite stays green" invariant, and
assumptions A1, A3 and A5.

## 8. Not built (recorded)

- A left (or right) wall separator at the row edges.
- A new `add-widget` skill that works on any row (waits for the engine; the
  August-era branch is archived as the tag `archive/add-widget-skill`).
- Per-session state snapshots with history (task 3 of the July plan, never
  built).
- The long-term verb catalog, Layer B bridges, and Mission Control from the
  July design spec (archived, §9).

## 9. Archived v1 documents

Moved to `docs/superpowers/archive/` on 2026-11-24, each with a header saying
so:

- `2026-07-11-claude-dashboard-design.md`: the v1 design. Its constraints are
  carried in §5.2; its long-term vision is recorded in §8.
- `2026-07-11-dashboard-v1.md`: the v1 implementation plan. Everything but
  task 3 shipped in a different form as v1.0 and v1.1.0.
