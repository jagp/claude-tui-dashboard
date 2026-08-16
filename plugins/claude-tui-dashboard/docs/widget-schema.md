# Widget schema — the shared `dashboard.json` contract (draft 1)

**Status: DRAFT.** First draft of the data structure the web configurator
(`webapp/`), the statusline renderer (`statusline/statusline.js` —
`dashboardRow()`), and the plugin skills will all speak. Today each side
implements a subset; this document is the meeting point they converge on.
Revise here first, then bring the implementations along.

> `webapp/…` paths here point into the plugin's **source repository** — the
> installed plugin ships without the webapp. Everything a skill needs at
> runtime is stated inline in this document.

## The wire file

`~/.claude/dashboard.json`, overridable via the `DASHBOARD_JSON` env var — the
renderer honors that override already, and the widget tooling
(`skills/add-widget/scripts/widget-map.js`) honors the same one so tests and
dry-runs never touch the real file.

**`version` stays `1`.** `dashboardRow()` returns `null` for any other stamp,
which makes the entire row silently vanish on every deployed bar — so the
widget layer is an *additive* extension of v1, not a v2. Precedent: button
`keybind` and flex `side`, both shipped as new optional fields that old
readers ignore (see `webapp/README.md`, "The exported schema").

## The widget layer

A **widget** is a v1 `button` item claiming a numbered **slot**:

```json
{
  "version": 1,
  "row": [
    { "type": "button", "glyph": "🔥", "slot": 3 },
    { "type": "flex" },
    { "type": "button", "glyph": "📈", "tooltip": "tokens+today+81k", "slot": 7 }
  ]
}
```

| Field     | Phase | Status   | Meaning |
|-----------|:-----:|----------|---------|
| `glyph`   | 1     | live     | The emoji, representing itself (see "Glyph identity" below) |
| `slot`    | 1     | live     | Integer `1..12`, the widget's numbered position along the row |
| `action`  | 2     | reserved | `claudectl://` / `https` URI, composed per the tip/do rule below |
| `tooltip` | 3     | reserved | Hover prose — ASCII 32–126, no raw spaces, ≤1000 chars (the OSC 8 hover shows the raw URI, hence the byte rules) |
| `keybind` | —     | carried  | Webapp-owned field; tooling preserves it verbatim, renderer ignores it |

"Reserved" means the field is already legal v1 (the renderer honors `action`
and `tooltip` on any button today); the phase number marks when the
`add-widget` skill starts *accepting* it as an argument. Non-widget items
(`divider`, `flex`, slotless buttons) are unaffected by this layer.

### URI composition — the tip/do rule

How a button's tooltip and action weld into one OSC 8 link URI. The renderer
(`dashboardRow()`), the webapp, and `claudectl-handler.ps1` MUST agree:

- `action` empty → `claudectl://tip/` + tooltip (hover-only, click is a no-op)
- `tooltip` empty → the action, verbatim
- both present → `claudectl://tip/` + tooltip + `/do/` + `encodeURIComponent(action)`
  (the handler confirms, then dispatches through its normal allowlist)

## Glyph identity — an emoji representing itself (for now)

Phase 1 stores the glyph literally: `"glyph": "🔥"`. No encoding layer.

The long-term question ("do emojis have ISO keystroke IDs?"): **no** — emoji
are not keyboard keys and have no ISO keystroke identity. Their stable,
universal identifier is the **Unicode code point** (🔥 = `U+1F525`; some glyphs
are multi-codepoint sequences via `U+FE0F` variation selectors or `U+200D`
ZWJ joins — see `customizing-glyphs.md`, "Rendering caveats"). Human-readable
layers on top of that: CLDR short names (`fire`) and the `:shortcode:`
convention. When the configurator wants to accept arbitrary glyph *sets*
(nerd-font icons, text ramps), the likely shape is an optional companion
field — `"glyphId": "U+1F525"` — while `glyph` stays the rendered truth.
Sketch only; not scheduled.

## Slot geometry (draft constants)

| Constant     | Value    | Derivation |
|--------------|----------|------------|
| `SLOT_COUNT` | 12       | `12 × SLOT_WIDTH + 11` single-space joins = 71 cells ≤ `SOFT_CAP` |
| `SLOT_WIDTH` | 5 cells  | Default per-widget budget (an emoji is 2 cells; leaves 3 for a short label later) |
| `SOFT_CAP`   | 78 cells | The classic safe terminal line; past it the row may wrap or clip |

The cap is **soft**: tooling warns when the estimated rendered width crosses
78 cells but never refuses — the user's terminal is the final judge. Width is
estimated with a deliberate approximation (astral code points count 2 cells,
everything else 1, `U+FE0F`/`U+200D` stripped first); real terminals disagree
at the margins, which is exactly why the cap warns instead of blocking.

## Ordering & insertion — the no-clobber rule

The renderer draws `row[]` in array order; slot numbers are made physical by
keeping slotted items in ascending-`slot` order *within their own
subsequence*. Tooling MUST:

1. stable-insert a new widget before the first slotted item with a higher
   slot (after the last slotted item when there is none);
2. never move `divider` / `flex` / slotless items — webapp-authored layout
   stays where its author put it;
3. preserve unknown fields by re-serializing whole item objects, never
   reconstructing them field-by-field.

## Occupancy & overwrite

One widget per slot. Writing into an occupied slot is the
**`overwrite-widget-glyph`** operation — a future dedicated function; until it
exists, tooling emulates it as *glyph-only* replacement (`--force`): the
occupant's `tooltip`, `action`, `keybind`, and any unknown fields survive,
only `glyph` changes. That keeps a rich webapp-built button intact when a
skill merely re-skins it.

## The legend

`widget-map.js map` prints the canonical slot map — numbered positions along
the line, `·` for empty, plus the width meter and a census of non-slot items:

```
 slot    1   2   3   4   5   6   7   8   9  10  11  12
 glyph   ·   ·  🔥   ·   ·   ·  📈   ·   ·   ·   ·   ·
 row width ≈ 9 / 78 cells ✓   (also on the row: 1 flex)
```

## Open questions (phase-1 answers, revisable)

- **Do empty slots reserve physical width?** Phase 1: no — slots are logical
  order; unoccupied slots collapse and the row stays compact. A fixed grid
  (blank 5-cell pads) is a possible later mode.
- **Webapp round-trip loses `slot` today.** The webapp's import "drops
  unknown fields" (`webapp/README.md`) — a pull-then-push cycle would strip
  the widget layer. Webapp v-next task: preserve `slot` the way `keybind`
  already is.
- **Do slots ever address lines 1–2?** Out of scope: this draft governs the
  dashboard row only. The line-1/2 segments are sensor-driven, not
  user-placed.
