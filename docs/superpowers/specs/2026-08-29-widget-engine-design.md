# Widget engine — the manifest ⇄ engine contract

**Date:** 2026-08-29
**Status:** DRAFT for review — Claude's proposal, unratified. Every evaluative
call in this document is Claude's assessment unless marked otherwise; the
decisions listed in §12 are the user's to make.
**Branch / worktree:** `feature/widget-engine` at `.claude/worktrees/widget-engine`
**Supersedes (in part):** `widget-schema.md` draft 1 on `feature/add-widget-skill`
— that draft governs only the authored third row and scoped rows 1–2 out
("sensor-driven, not user-placed"). This spec makes every row user-placed and
inherits the draft's vocabulary (widget, slot, glyph, tooltip, action, ramp,
needle, the tip/do rule, the soft cap) rather than coining rivals.
**Companions:** `2026-08-29-widget-inventory.json` (every unit `render()` emits
today, attribute by attribute — the migration checklist),
`2026-08-29-widget-inventory-verification.md` (adversarial check results).

## 1. Purpose

Split `plugins/claude-tui-dashboard/statusline/statusline.js` into two halves
that meet at one JSON contract:

| Half | What it is | Where it lives |
|---|---|---|
| **Logic** — the **engine** and its **sensors** | Code. Reads the payload, runs sensors, positions and dresses widgets, never throws. Knows nothing about *which* widgets exist. | `statusline/statusline.js` (+ helper modules if bundled back into one file for deploy) |
| **Data** — the **manifest** | JSON. The array of registered widgets: what each one shows, where it sits, what it says on hover, what a click does. Knows nothing about *how* rendering works. | `statusline/dashboard.default.json` shipped; `~/.claude/dashboard.json` user-owned; exported by `webapp/` |

The manifest is what the webapp will export and the plugin will imbibe. That
makes this document a **public interchange contract**, not a refactor note:
the sensor catalog (§7) is part of it, because a configurator can only offer
bindings it knows exist.

**Fidelity invariant.** After the refactor the deployed bar renders
byte-for-byte what it renders today for every fixture (modulo wall-clock
spans, §10). The 80-check suite stays green throughout; no widget is dropped,
reordered, recolored, or re-tooltipped by the migration itself.

## 2. Classification and process

Architectural (new subsystem + an interface the webapp depends on). Path:
this spec → user review → `writing-plans` → migration in a second workflow.
Nothing below is implemented yet; the worktree holds only these documents.

## 3. Glossary — the one vocabulary

Terms are **binding**: they are the field names in the manifest, the class and
method names in the engine, and the words used in docs, skills, tests and the
webapp. Older synonyms are listed so they can be retired on sight.

| Term | Meaning | Retires |
|---|---|---|
| **bar** | The whole statusline output, all rows. | "statusline output", "the dashboard" (when meaning the output) |
| **row** | One printed line of the bar. Numbered from 1. | "line" (in prose keep "line 1" only when quoting the old README) |
| **cluster** | A contiguous run of widgets on a row that share one **joiner**. Clusters on a row are separated by the **gap**. | "head", "segs", "tail", "nav", "buttons" as structural names |
| **joiner** | The string between two adjacent *visible* widgets of one cluster: `space` (` `), `pipe` (` | ` with the bar dimmed — today's `SEP`), `gap` (three spaces). | `SEP`, "separator" |
| **gap** | The three-space string between clusters; also a joiner value. | `"   "` literals |
| **widget** | One unit of the bar. The manifest's unit of registration, the engine's unit of rendering. | segment (source), control (catalog), item (v1 JSON), button/chip/badge/gauge/meter as *structural* names (they remain fine as prose descriptions of a widget's flavour), actionmoji (webapp brand for an authored button — stays a product word, never a field) |
| **slot** | A widget's ordinal position on its row (integer ≥ 1). A sort key, not a fixed-width cell (see §12 Q1). | "position", "order" |
| **width** | How many slots a widget is budgeted (integer ≥ 1, default 1). Advisory: drives the webapp ruler and soft-cap warnings, never the terminal. | "span" |
| **pad** | Extra spaces inside a widget's envelope, `[left, right]`. | "margin", "padding" |
| **glue** | A widget flag: attach to the previous *visible* widget with a single space instead of the cluster joiner. | "merge glue" |
| **face** | The printed part of a widget: glyph + label, colored. | "display", "text", "renderable side" |
| **glyph** | The emoji / character(s) of a widget. May come from a ramp. | icon (`MODEL_ICON`, `EFFORT_ICON` become `MODEL_GLYPH`…), emoji, sticker |
| **label** | The face template. Default `{glyph}`. A string, or an array of **parts** for per-part color. | "text label" |
| **part** | One colored fragment of a label: `{ "text": template, "color": color }`. | "span" |
| **color** | A palette name, `dim`, `none`, a 256-cube template, or a ramp reference `@id`. | "tint", "hue" (hue survives only as the session sensor's reading name) |
| **tooltip** | The hover prose of a widget, space-free printable ASCII. A template string or an array of **words**. Carried by the `claudectl://tip/` URI. | "tip" (keep only for the URI verb and the `tipUrl`/`tipText` helpers), "hover prose", "designed prose" |
| **word** | One `+`-joined unit of a tooltip; a nested array is an *optional group* (dropped whole if any placeholder inside resolves empty). | "parts" (source name for tooltip arrays) |
| **action** | The click URI template. The **tip/do rule** composes tooltip + action into the one OSC 8 URI. | "url", "href", "verb" (verb = the path segment of a `claudectl://` URI, unchanged) |
| **dress** | The visual treatment of the link envelope: `plain` (invisible; face keeps its own styling), `link` (underline + color, cyan by default), `button` (dim brackets around a link). | `linkWrap`/`osc8`/`button` as vocabulary |
| **sensor** | Plugin-side code that turns the payload and cheap local reads into **readings**, once per tick. Owns caching, side effects, formatting and absence. | "source", "binding", "data source" |
| **reading** | A named value a sensor produces. `{name}` in templates; nested via dots. `null` / `undefined` / `""` mean *empty*. | "field", "value", "metric" |
| **absent** | A sensor's "nothing to say" result. Every widget bound to it hides. | "n/a", "missing" |
| **ramp** | An ordered list of **stops** that maps a reading onto glyph / color / label / tooltip / say. | scale, ladder, threshold array, "state machine" (pet) |
| **stop** | One rung of a ramp: a **matcher** plus overrides. First match wins; a stop with no matcher is the catch-all. | "tier", "stage", "level" (fine in prose, not fields) |
| **needle** | The stop a ramp matched this tick. | — |
| **say** | A stop's write-in tooltip words. Referenced as `{@ramp.say}`. | "write-in language" |
| **matcher** | `is`, `isNot`, `present`, `below`, `atMost`, `atLeast`, `above` — against one reading. | "condition", "threshold" |
| **show** | A widget's extra visibility condition: one matcher, or `{ "all": […] }` / `{ "any": […] }`. | `hideWhen`, "smart-hidden", "hidden at zero" |
| **fill** | A cluster rule: append `fill: true` widgets in slot order until the cluster holds at least `min` visible widgets. | "fallback links", "pad so line 2 always shows two links" |
| **manifest** | The JSON document describing the bar. File: `dashboard.json`. | "config", "wire file", "export", "dashboard config" |
| **engine** | The renderer: manifest + sensors + payload → bar. | "renderer", "render()", "statusline script" |
| **tick** | One render. Claude Code pipes one **payload**; the engine prints one bar. | "refresh", "render pass" |
| **payload** | The JSON Claude Code writes to the statusline's stdin. | "session JSON", "stdin JSON" |

Words that stay as-is because they are already consistent everywhere:
**claudectl**, **tip/do rule**, **soft cap** (78 cells), **state dir**
(`~/.claude/dashboard-state/`), **kill switch** (env vars).

## 4. The split, in one picture

```
 payload ──▶ ENGINE ──run once per referenced sensor──▶ readings
                │                                          │
     manifest ──┤  for each widget:                        │
   (dashboard   │    bind ▸ visible? ▸ needle per ramp     ◀┘
     .json)     │    ▸ face ▸ tooltip ▸ action ▸ URI ▸ dress ▸ pad
                │  group by row ▸ cluster ▸ sort by slot ▸ fill ▸ glue/joiner
                │  join clusters with gap ▸ drop empty rows ▸ join rows
                ▼
              the bar   (never throws — any failure ⇒ that widget hides;
                         a failure outside widgets ⇒ the literal "status")
```

What moves where (the "currently mixed" clean-up):

| Today (inside one `*Segment()` function) | After |
|---|---|
| Payload access, state-file reads/writes, `git`/`gh` spawns, transcript tail, number formatting (`fmtDur`, `toFixed`, `hm`) | **sensor** |
| Glyph ramps and their thresholds, threshold colors, tooltip word order, label shape, which span is colored, hide thresholds | **manifest** (ramps, parts, words, show) |
| `tip()`, `linkWrap`/`osc8`/`button`, `tipText` sanitising, `localUrl`, `encodePath`, joiners, fill, flex arithmetic, try/catch | **engine** |

## 5. The manifest

### 5.1 Envelope

```json
{
  "version": 2,
  "name": "shipped",
  "layout": {
    "rows": [
      { "row": 1, "clusters": [
        { "id": "identity", "joiner": "space" },
        { "id": "meters",   "joiner": "pipe"  },
        { "id": "tail",     "joiner": "space" } ] },
      { "row": 2, "clusters": [
        { "id": "nav",      "joiner": "gap", "fill": { "min": 2 } },
        { "id": "controls", "joiner": "space" } ] },
      { "row": 3, "clusters": [
        { "id": "dashboard", "joiner": "space" } ] }
    ]
  },
  "widgets": [ … ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `version` | `2` | Manifest format. `1` is the existing row-only `dashboard.json` (§8). Anything else ⇒ the engine ignores the file. |
| `name` | string | Metadata, free. |
| `layout.rows[]` | | Declares rows and their clusters *in print order*. A row with no visible widget is not printed. |
| `layout.rows[].clusters[].joiner` | `space` \| `pipe` \| `gap` | Between adjacent visible widgets of the cluster. |
| `layout.rows[].clusters[].fill` | `{ "min": n }` | Optional. See §6.4. |
| `widgets[]` | Widget[] | The registered widgets, any order — placement is by fields, not array position. |

Unknown fields anywhere are **ignored by the engine and preserved by tooling**
(re-serialise whole objects). This is how the webapp's `keybind` survives.

### 5.2 Widget

Every widget carries the same field set regardless of content — that is the
uniformity the current code lacks.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | string | required | Unique in the manifest. Dotted ids are fine (`window.five_hour`). |
| `name` | string | `id` | Human-readable metadata. |
| `kind` | `widget` \| `divider` \| `flex` | `widget` | Dividers and flex items have no sensor, no link. |
| `sensor` | string | — | Sensor id (§7). A widget binds **one** sensor. Omit for static widgets. |
| `args` | object | `{}` | Passed to the sensor (e.g. `{ "key": "five_hour" }`). |
| `row` | int ≥ 1 | required | |
| `cluster` | string | required | A cluster id declared for that row. |
| `slot` | int ≥ 1 | required | Sort key within the row. Ties keep manifest order. |
| `width` | int ≥ 1 | `1` | Slots budgeted (advisory). |
| `pad` | `[int, int]` | `[0, 0]` | Spaces inside the envelope, left / right. |
| `glue` | bool | `false` | Join to the previous visible widget with one space. |
| `glyph` | template | `""` | Literal, `{reading}`, or `@ramp`. |
| `label` | template \| part[] \| `{ "parts": part[], "join": string }` | `"{glyph}"` | The face. Parts concatenate with `join` (default `""`). |
| `color` | color | `none` | Whole-face color; a part's own `color` wins for that part. |
| `tooltip` | template \| word[] | — | Hover prose. |
| `action` | template | — | Click URI. |
| `dress` | `plain` \| `link` \| `button` | `plain` | |
| `ramps` | `{ id: Ramp }` | `{}` | See §5.4. |
| `show` | matcher \| `{all}` \| `{any}` | — | Extra visibility condition. |
| `fill` | bool | `false` | Fill candidate for its cluster (§6.4). |
| `meta` | object | `{}` | Free-form escape hatch, preserved verbatim. |

**Visibility** (evaluated in this order; the first hit hides the widget):
sensor absent → `show` fails → face resolves to the empty string → the widget
threw. Dividers and flex items are always visible.

**Twins.** Mutually exclusive variants are two widgets in the *same* slot with
complementary `show` conditions: `branch` / `folder` (path with or without a
branch), and `ci` / `ci.tip` (a checks-page link when `checksUrl` is present,
else the tooltip-only rollup). Sharing a slot is legal precisely because at
most one twin is ever visible.

### 5.3 Templates and placeholders

- `{name}` — a reading of the bound sensor; `{a.b}` for nested readings.
- `{glyph}` — the widget's resolved glyph.
- `{@id}` — the needle glyph of ramp `id`; `{@id.color}`, `{@id.label}`,
  `{@id.tooltip}`, `{@id.say}` for the needle's other fields. Two shorthands,
  and only two: a bare `"@id"` as the *entire* value of `glyph` means
  `{@id}`, and as the entire value of `color` means `{@id.color}`. When no
  stop matches, every reference to that ramp resolves empty.
- Any template unit — a label part, a tooltip word, an optional word group —
  that contains a placeholder resolving to *empty* is **dropped whole**. This
  is how `resets 15:20` vanishes when there is no reset stamp and how
  `↑2 ↓1 ●3` omits zero counters (the git sensor reports zeros as `null`).
  Readings that must print at zero (churn's `+0`) are numbers, not `null` —
  absence semantics belong to the sensor.
- Tooltip words are joined with `+`; the engine applies today's `tipText`
  sanitising (`%`→`%25`, whitespace→`+`, non-printable dropped) and the
  1000-character clip. Authors write plain `%`.
- Optional groups in a tooltip string form are written `{{ … }}`; the array
  form nests an array. The shipped manifest uses arrays.

### 5.4 Ramps, stops, matchers

```json
"ramps": {
  "tank": { "on": "dryBeforeReset", "stops": [
    { "is": true, "glyph": "🪫", "say": ["RUNS-DRY-BEFORE-RESET", "{resetAt}"] },
    { "glyph": "🔋" } ] },
  "heat": { "on": "rate", "stops": [
    { "on": "dryBeforeReset", "is": true, "color": "red" },
    { "atLeast": 15, "color": "yellow" },
    { "color": "green" } ] }
}
```

| Field | Meaning |
|---|---|
| `on` | The reading the ramp reads. A stop may override it with its own `on` (the burn heat above reads two readings — the only way to keep threshold logic in data without an expression language). |
| stop matchers | exactly one of `is`, `isNot`, `present` (`true`/`false`), `below` (<), `atMost` (≤), `atLeast` (≥), `above` (>); none = catch-all |
| stop overrides | `glyph`, `color`, `label`, `tooltip`, `say` — each a template like the widget-level field |

Semantics: stops are tried in order; the first match is the needle. A widget
may reference any of its ramps from any template. `show` uses the same
matcher shape with an explicit `reading`:
`{ "reading": "wallMs", "atLeast": 600000 }`.

### 5.5 Colors and dress

| color | plain dress emits | link dress emits |
|---|---|---|
| `none` | text as-is | `\e[4;36m` … `\e[24;39m` (today's `osc8`) |
| `red` `green` `yellow` `magenta` `cyan` | `\e[3Xm` … `\e[39m` | `\e[4;3Xm` … `\e[24;39m` |
| `dim` | `\e[2m` … `\e[22m` | `\e[2;4m` … `\e[22;24m` |
| `256:{reading}` | `\e[38;5;Nm` … `\e[39m` | — |

`button` = `\e[2m[\e[22m` + link dress + `\e[2m]\e[22m`. This table reproduces
`PR_STYLE` and every `col()`/`dim()` call site byte-for-byte; the golden tests
pin it.

### 5.6 The link URI (tip/do rule, unchanged)

tooltip only → `claudectl://tip/<words>` · action only → the action verbatim ·
both → `claudectl://tip/<words>/do/<encodeURIComponent(action)>` · neither →
no envelope. Identical to the webapp's `composeUri()` and the handler.

## 6. The engine

### 6.1 Tick

1. Read stdin; parse the payload (a parse failure still renders — sensors
   simply see `{}`).
2. Load the manifest (§8 resolution order). Invalid ⇒ fall back to the shipped
   default; missing default ⇒ print `status`.
3. Instantiate one `Widget` per manifest entry (`Widget.from(def)`).
4. Run each **referenced** sensor once (memoised per `sensor`+`args`). Sensors
   run even if every widget bound to them will hide — burn history must keep
   accumulating while its face is hidden. Sensors nobody references never run
   (removing the burn widget stops the history file; Claude's assessment: the
   right consequence).
5. Render each widget (§6.2), catching per widget.
6. Lay out (§6.3), print, exit 0. Any throw outside a widget ⇒ `status`.

### 6.2 `Widget` — the prototype

```js
class Widget {
  static from(def)                 // → Widget | Divider | Flex; validates, freezes def
  constructor(def)                 // id, name, placement, face/tooltip/action/dress, ramps, show, fill
  bind(tick)                       // tick = { readings(sensorId, args), env, now }
  get visible()                    // absent → show → empty-face → threw
  needle(rampId)                   // the matched stop (memoised per tick)
  glyph()                          // literal | {reading} | @ramp
  face()                           // → [{ text, color }] with empties dropped, pad applied
  tooltip()                        // → string[] words, groups flattened, say expanded
  action()                         // → string | null
  uri()                            // tip/do composition
  render()                         // → string: SGR + OSC 8 per dress; null when hidden
}
class Divider extends Widget { render() /* dim glyph */ }
class Flex    extends Widget { render(gap) /* computed by the row */ }

class Cluster { constructor(def, widgets); render() /* filter → fill → glue/joiner */ }
class Row     { constructor(def, clusters); render() /* clusters joined by gap; flex arithmetic */ }
class Engine  { constructor(manifest, sensors); render(payload, raw) → string }
```

Sensors register in a `SensorRegistry` (`id → (payload, args, tick) →
readings | ABSENT`). Each sensor swallows its own errors and returns `ABSENT`.

### 6.3 Layout

For each row in `layout` order → for each cluster in declaration order →
widgets with that `row`+`cluster`, sorted by `slot` (ties: manifest order):

1. drop hidden widgets;
2. apply **fill** (§6.4);
3. join: between two adjacent survivors emit one space if the later one is
   `glue`, else the cluster's joiner;
4. a cluster with no survivor contributes nothing; survivors are joined by the
   **gap**;
5. a row with no content is not printed; rows join with `\n`.

Flex arithmetic (row 3 today): a flex item renders three spaces, unless
`$COLUMNS` > 0, in which case spare width = `COLUMNS − Σ(glyph.length) −
(items − 1)` divided evenly across flex items (min 1). `glyph.length` is JS
string length, not cell width — a quirk preserved for fidelity, flagged for a
later fix.

Why clusters and not per-widget margins: with margins, the join at a cluster
boundary has to belong to some widget, and every boundary widget on row 1 is
optional. Concretely: no `session_id` and no transcript ⇒ the last visible
meter is `clock` and the first visible tail widget is `churn`; per-widget
margins would emit ` │ ` where `render()` emits the gap, because `render()`
filters each cluster *then* joins. Clusters are the current behaviour, named.

### 6.4 Fill

A cluster with `fill: { min: n }` first lays out its non-fill widgets, then
appends `fill: true` widgets in slot order until `n` are visible or the
candidates run out. Fill widgets still obey their own visibility. This is
line 2's repo → issues → cwd padding, generalised.

### 6.5 Never throws

Per-widget try/catch (new: today a throw in `tokenSegment` would collapse the
whole bar to `status`; after, only that widget vanishes) plus the existing
outer catch. The kill switches `CLAUDE_TUI_DASHBOARD_NO_SPAWN`,
`CLAUDE_TUI_DASHBOARD_NO_PET`, `DASHBOARD_JSON`, `COLUMNS` keep their meaning;
they are read by sensors/engine, never by the manifest.

## 7. Sensor catalog (public contract)

Readings marked ° are pre-formatted strings (the sensor owns formatting, as
the source does today). *Absent* is when the sensor returns nothing and its
widgets hide. Side effects are listed because they must survive the split.

| Sensor | Readings | Absent when | Side effects |
|---|---|---|---|
| `identity` | `model.tier` (haiku·sonnet·opus·fable·unknown), `model.name`, `effort.level` (low…max, else `default`), `version` | never | — |
| `context` | `used`, `size`, `usedTok`, `usableSize`, `usablePct`°, `remaining` | `used` falsy or < 0 | — |
| `windows` | `count`; with `args.key`: `key`, `short` (5h · 7d · key), `used`, `remaining`, `resetStamp`° (hm for five_hour, m/d hm otherwise). `args.key: "*"` **expands**: one widget instance per window key not claimed by another widget. | never for the aggregate; per key when that window is missing or `used_percentage == null` | — |
| `burn` | `rateText`°, `emptyAt`°, `dryBeforeReset`, `resetAt`°, `sevenDayUsed`, `samples` | no rate_limits/session; no sample ≥ 60 s old; delta ≤ 0 | appends a sample to `<sid>.json` every tick (cap 50) |
| `tokens` | `total`, `in`, `out`, `cacheRead`, `cacheWrite`, `cacheHit`° (null unless computable) | `total ≤ 0` | — |
| `cost` | `usd`°, `wallMs`, `wall`°, `apiMs`, `api`°, `apiShare`, `rate`, `rateText`° | no `cost` object | — |
| `cache` | `state` (warm·cold), `left`°, `leftMs`, `ttl` (1h·5m), `expiredAt`° | no transcript; no usage line; last usage > 24 h old | reads ≤ 64 KB of the transcript tail |
| `session` | `id`, `name`, `hue` (ANSI-256 index) | no `session_id` | — |
| `churn` | `added`, `removed`, `net`° (signed, `+90`) | both zero | — |
| `modes` | `vim`, `thinking`, `fast`, `agentName`, `agentShort`, `style`, `addedDirs[]`, `addedCount` | never (widgets use `show`) | — |
| `account` | `email`, `org` | unknown (incl. cached null) | reads `~/.claude.json` when the 6 h cache is stale; writes `account.json` |
| `pet` | `score`, `level`, `mood` (cozy·busy·worried·frazzled), `fedK`, `alive`°, `lines` | `score ≤ 0` or `CLAUDE_TUI_DASHBOARD_NO_PET` | — |
| `stale` | `stamp`°, `frozen`, `frozenFor`° | never | writes `meta-<sid>.json` when the payload hash changes |
| `workspace` | `branch`, `branchShort`°, `path`, `pathUrl`°, `basename`, `wtName`, `wtChip` (bool: worktree present, named, and named differently from the branch), `repoOwner`, `repoName`, `repoUrl`, `baseBranch`, `baseTarget`° | never (readings may be empty) | — |
| `git` | `ahead`, `behind`, `staged`, `modified`, `untracked`, `conflicts`, `stash` (each `null` at zero), `op`, `clean` | not a repo; status failed with no cache | spawns `git status --porcelain=v2` (1.5 s) when the cache is stale; writes `git-<hash>.json` |
| `pr` | `number`, `url`, `reviewState`, `checksUrl` | no number or no url | — |
| `ci` | `pass`, `fail`, `pending`, `total`, `checksUrl` | no pr number; no cache; `total == 0` | may spawn the detached `--ci-refresh` child; lock file |
| `transcript` | `path`, `pathUrl`°, `logsDir`, `logsUrl`° (empty when `dirname(path) == path`) | no `transcript_path` | — |

`pathUrl`-style readings are where today's `localUrl()` runs (the
claudectl://open ↔ file:// platform switch). Sensors may add readings without
a version bump; renaming or removing one is a breaking change.

## 8. Compatibility and files

**Resolution order.** `$DASHBOARD_JSON` → `~/.claude/dashboard.json` →
`<engine dir>/dashboard.default.json` → `status`.

**Two versions, one file** (Claude's recommendation — §12 Q2 offers the
alternative):

| File found | Engine behaviour |
|---|---|
| `version: 2` | It *is* the bar. Rows 1–2 come from it too. |
| `version: 1` (today's webapp export: `{ version, row: [...] }`) | Rows 1–2 from the shipped default; `row[]` items become row-3 widgets in cluster `dashboard`: `button` → `{ kind: widget, glyph, tooltip, action, dress: link }` (no URI ⇒ dress plain), `divider` → `{ kind: divider, glyph, color: dim }`, `flex` → `{ kind: flex }`. Byte-identical to `dashboardRow()`. |
| missing / invalid | Shipped default only (rows 1–2, no row 3). |

Activation deploys `statusline.js` **and** `dashboard.default.json` beside it;
it never writes `~/.claude/dashboard.json` (user-owned, exactly as today). The
`widget-map.js` tooling on `feature/add-widget-skill` is v1-only and refuses
other versions — a follow-up on that branch, out of scope here.

## 9. The shipped default — three worked widgets

Row 1 · identity · the badge (two ramps, one colored part, no separator):

```json
{ "id": "badge", "sensor": "identity", "row": 1, "cluster": "identity", "slot": 1,
  "ramps": {
    "medal":  { "on": "model.tier", "stops": [
      { "is": "haiku", "glyph": "🥉" }, { "is": "sonnet", "glyph": "🥈" },
      { "is": "opus", "glyph": "🥇" },  { "is": "fable", "glyph": "🏆" }, { "glyph": "🎖️" } ] },
    "effort": { "on": "effort.level", "stops": [
      { "is": "low", "glyph": "○" }, { "is": "medium", "glyph": "◐" }, { "is": "high", "glyph": "●" },
      { "is": "xhigh", "glyph": "◉" }, { "is": "max", "glyph": "★", "color": "yellow" }, { "glyph": "·" } ] } },
  "label": [ { "text": "{@medal}" }, { "text": "{@effort}", "color": "@effort" } ],
  "tooltip": ["model", "{model.name}", "effort", "{effort.level}", "v{version}"] }
```

Row 1 · meters · burn (glyph ramp with say, two-reading color ramp, one colored part):

```json
{ "id": "burn", "sensor": "burn", "row": 1, "cluster": "meters", "slot": 5, "width": 3,
  "ramps": {
    "tank": { "on": "dryBeforeReset", "stops": [
      { "is": true, "glyph": "🪫", "say": ["RUNS-DRY-BEFORE-RESET", "{resetAt}"] }, { "glyph": "🔋" } ] },
    "heat": { "on": "rate", "stops": [
      { "on": "dryBeforeReset", "is": true, "color": "red" }, { "atLeast": 15, "color": "yellow" }, { "color": "green" } ] } },
  "glyph": "@tank",
  "label": [ { "text": "{glyph} " }, { "text": "{rateText}%/h", "color": "@heat" }, { "text": " empty ~{emptyAt}" } ],
  "tooltip": ["burn", "{rateText}%/h", "5h-empty", "~{emptyAt}", "{@tank.say}", ["7d", "{sevenDayUsed}%", "used"], "samples", "{samples}"] }
```

Row 2 · nav · the PR link (link dress with ramp-driven color, action-only URI):

```json
{ "id": "pr", "sensor": "pr", "row": 2, "cluster": "nav", "slot": 4,
  "ramps": { "review": { "on": "reviewState", "stops": [
    { "is": "approved", "color": "green" }, { "is": "changes_requested", "color": "red" },
    { "is": "draft", "color": "dim" }, { "is": "pending", "color": "yellow" }, { "color": "none" } ] } },
  "glyph": "🔗", "label": "{glyph} PR #{number}", "color": "@review", "action": "{url}", "dress": "link" }
```

And a row-2 fill widget, a glued widget, and a static one, for shape:

```json
{ "id": "issues", "sensor": "workspace", "row": 2, "cluster": "nav", "slot": 8, "fill": true,
  "glyph": "🐛", "label": "{glyph} issues", "action": "{repoUrl}/issues", "dress": "link" }

{ "id": "gitIntel", "sensor": "git", "row": 2, "cluster": "nav", "slot": 2, "glue": true,
  "ramps": { "state": { "on": "clean", "stops": [
    { "is": true, "label": "✔", "color": "green", "tooltip": ["git", "clean"] } ] } },
  "label": { "join": " ", "parts": [
    { "text": "↑{ahead}", "color": "green" }, { "text": "↓{behind}", "color": "red" },
    { "text": "●{staged}", "color": "green" }, { "text": "✚{modified}", "color": "yellow" },
    { "text": "…{untracked}", "color": "dim" }, { "text": "✖{conflicts}", "color": "red" },
    { "text": "⚑{stash}", "color": "magenta" }, { "text": "{op}", "color": "red" } ] },
  "tooltip": ["git", ["ahead", "{ahead}"], ["behind", "{behind}"], ["staged", "{staged}"], ["modified", "{modified}"],
              ["untracked", "{untracked}"], ["conflicts", "{conflicts}"], ["stash", "{stash}"], ["{op}", "in-progress"]] }

{ "id": "usage-na", "sensor": "windows", "row": 1, "cluster": "meters", "slot": 1,
  "show": { "reading": "count", "is": 0 }, "label": "usage n/a" }
```

The full default manifest — every inventory entry (39, plus the `ci.tip`
twin) — is a Phase-1 deliverable, written one widget at a time as each moves
out of `render()`.

## 10. Fidelity — how "exactly the same" is proven

1. **Golden capture.** Before any refactor commit, run the pre-refactor
   `statusline.js` over every fixture (and the synthetic variants the test
   suite already builds: burn history seeded, warm/cold transcript, scratch
   git repo, canned CI cache, added dirs, account, dashboard row with and
   without `COLUMNS`) under a sandboxed HOME, and store the raw output in
   `tests/golden/*.txt`.
2. **Normalise volatile spans** with regexes before comparing — never freeze
   the clock (there is no injection seam): the stale stamp `\d\d:\d\d:\d\d\*?`
   and its `rendered+` word, the cache countdown `\d:\d\d` and `expired+hh:mm`,
   burn's `empty ~hh:mm`, `RUNS-DRY-BEFORE-RESET+hh:mm` and `samples+N`.
3. **Each migration commit** moves one inventory entry into a sensor + a
   manifest widget, deletes its code from `render()`, and must pass the 80
   checks **and** the golden diff. Suggested order (simplest first, glue and
   fill last): trap · thinking · fast · agent · style · addedDirs · tokens ·
   cost · clock · spendRate · vim · churn · session · gauge · badge ·
   windows (+ usage-na, + `*` expansion) · burn · cache · pet · stale ·
   account · controls (logs · transcript · base) · pr · branch / folder ·
   worktree · gitIntel (glue) · ci (+ ci.tip twin) · fill (repo · issues ·
   cwd) · row-3 v1 import · delete `render()`.
4. **New tests** for what the engine adds: joiner/glue/fill matrix over a
   synthetic manifest, ramp matcher table, optional-group dropping, v1 → row 3
   mapping, per-widget throw isolation, manifest resolution order.

## 11. Out of scope (recorded, not built)

Webapp round-trip of v2 (the configurator emitting rows 1–2); formatter chains
in the manifest (§8 of the possibility space — sensors format today, the
manifest picks); an expression language for `show`; real cell-width flex
arithmetic; `widget-map.js` v2 support; new sensors or widgets; Mission
Control.

## 12. Assumptions and the decisions that are yours

Stated assumptions (Claude's, unconfirmed) — say so if any is wrong:

- **A1** Clusters are a real structural level (§6.3 gives the counterexample
  that rules out per-widget margins alone). `pad` remains the per-widget
  knob you asked for, additive to the joiner.
- **A2** Sensors are code, ramps and templates are data. Threshold *logic that
  combines readings* (pet mood, burn dry-before-reset) stays in the sensor as
  an enum/boolean reading; the ramp maps it to glyph/color/say.
- **A3** One widget binds one sensor; the `identity`, `modes`, `cost` and
  `workspace` sensors are deliberately shared so several small widgets need no
  bespoke sensor.
- **A4** Readings that the source formats (`fmtDur`, `toFixed`, `hm`) arrive
  pre-formatted; the manifest never formats numbers.
- **A5** Unknown windows keep rendering generically via `args.key: "*"`
  expansion rather than being dropped.
- **A6** Per-widget try/catch is an acceptable robustness *gain* (strictly
  fewer `status` collapses; identical on every fixture).

Decisions (asked via AskUserQuestion at check-in):

- **Q1 — slot semantics.** Row 1 at full density is ~150 cells and 23
  widgets; a literal 12-cell grid cannot reproduce it. Proposed: `slot` is a
  sort key (any positive integer), `width` is advisory, and 12 stays the
  webapp's soft per-row budget (the existing soft-cap philosophy). Alternative:
  a hard 12 with widgets sharing slots.
- **Q2 — the manifest file.** Proposed: `dashboard.json` v2 with the v1 →
  row-3 compat rule (§8), default shipped as `dashboard.default.json`.
  Alternative: a new file (`bar.json`) leaving `dashboard.json` v1 untouched
  — zero risk to the v1 tooling, but two export artifacts for the webapp.
- **Q3 — the documents written so far.** The inventory JSON and this spec
  live on `feature/widget-engine` unratified; ratify, relocate, or discard.
