# Widget Engine v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-coded statusline with a manifest-driven widget engine (`version: 2`), and give the webapp a v2 editor that previews and exports the same manifest.

**Architecture:** `statusline.js` becomes engine + sensors; the bar's content moves to `dashboard.default.json`, deployed beside it. Sensors return plain readings; the engine resolves templates, fits plain text to the declared width, then applies color and link dress. The shared contract (cell width, fitting, row layout, templates, validation) is written once, in `statusline/statusline-contract.js`, deployed beside `statusline.js`; the engine `require()`s it and the webapp loads it with a `<script>` tag. (Changed 2026-11-28 at the user's direction: "saved once, served twice". It replaced a webapp copy proven equal by tests.)

**Tech Stack:** Plain Node ≥ 20, CommonJS, no npm dependencies; `webapp/index.html` plus the shared contract script it loads; PowerShell only for the existing handler tests.

**Spec:** `docs/superpowers/specs/2026-11-22-widget-engine-lean.md` (ratified 2026-11-24). It defers to `docs/superpowers/specs/2026-08-29-widget-engine-design.md` for templates (§5.3), ramps (§5.4), colors and dress (§5.5), the link URI (§5.6), the tick (§6.1), and the sensor catalog (§7). Read both.

## Global Constraints

- No npm dependencies. Plain Node, CommonJS, built-in modules only (lean §5.2).
- The engine never throws and always prints. A broken widget is absent; a broken manifest falls back to the default (lean §5.2, D11).
- The manifest is `version: 2` only. Anything else, a missing file, or bad JSON falls back to `dashboard.default.json` (D11).
- Every rendered widget occupies exactly `width` cells: pad right with spaces; overflow cuts to at most `width − 1` cells plus `…` (D7, lean §5).
- Separators: right-hand widget's `sep`, else the row's `separator`; none at row edges; still printed around hidden widgets (lean §4).
- Hidden = manifest `hideAbsent` OR widget `hideAbsent`; a widget cannot un-hide (D5).
- Placeholder: frames `◐ ◓ ◑ ◒`, color `dim`, frame = `frames[floor(now / 1000) mod frames.length]` (D13, lean §5).
- Sensors return plain readings, never escape sequences. Color and OSC 8 links are applied by the engine from manifest fields (Claude's call, needed so truncation never cuts inside an escape sequence).
- Paths are redirectable for tests: `DASHBOARD_JSON` (user manifest), `DASHBOARD_DEFAULT_JSON` (default manifest), and `HOME`/`USERPROFILE` (state dir).
- Link actions keep the tip/do URI rule and the handler allowlist (`open`, `tip`, `copy`, `spawn`, `https`). No new verbs.
- Work on feature branches, never on `develop`: Task 1 on `feature/widget-contract`, track A on `feature/widget-engine`, track B on `feature/webapp-v2`, each branched from `develop` after Task 1 merges.

## Tracks

| Track | Tasks | Waits on |
|---|---|---|
| Contract | 1 | — |
| A: engine | 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 | Task 1 |
| B: webapp | 10 → 11 → 12 | Task 1 |

A and B touch disjoint files after Task 1. Track A owns `plugins/claude-tui-dashboard/**`; track B owns `webapp/**` and `tests/webapp/**`.

## Review Focus

1. **A user manifest names a sensor or separator that doesn't exist.** Expect the widget to show the placeholder (unknown sensor) or the row default separator (unknown `sep`), not a fallback of the whole bar. Pinned in Task 4.
2. **A widget lacks a positive integer `width`, or two widgets share an `id`.** Expect the manifest to be rejected as a whole and the default to render, because a widget without a width cannot be laid out and D6 forbids dropping it. The webapp import rejects the same file with the same reason. Pinned in Tasks 4 and 12.
3. **The terminal is narrower than a row.** The engine never reflows; expect exit 0 and the full row printed. The default manifest must fit its own budgets so this only bites custom layouts. Pinned in Task 9.
4. **A v1 `dashboard.json` from the old webapp sits in `~/.claude`.** Expect the default bar, no row 3, no error. Pinned in Task 4; Task 12 offers conversion on import.
5. **Tooltip readings carry `%`, spaces, or non-ASCII.** Expect August §5.3 sanitising (`%`→`%25`, whitespace→`+`, bytes outside 32–126 dropped, 1000-char clip) so the hover never collapses to "Link". Pinned in Task 3.

---

### Task 1: Shared contract files, spec fix, and test scaffolding

**Files:**
- Modify: `docs/superpowers/specs/2026-11-22-widget-engine-lean.md` (§5.1 pseudocode)
- Create: `plugins/claude-tui-dashboard/contract/cell-width.vectors.json`
- Create: `plugins/claude-tui-dashboard/contract/layout.vectors.json`
- Create: `plugins/claude-tui-dashboard/contract/sensors.sample.json`
- Create: `plugins/claude-tui-dashboard/tests/engine.tests.js` (empty harness, exits 0)
- Create: `tests/webapp/contract.tests.js` (empty harness, exits 0)
- Modify: `.github/workflows/*.yml` (add both new test files as steps)

**Interfaces:**
- Produces: the three contract files below, read by both tracks. Neither track edits them without updating the other's tests.

- [ ] **Step 1: Correct §5.1.** Replace the first `graphemeWidth` rule with: *if g contains a code point with `Emoji_Presentation` or `Regional_Indicator`, or contains U+FE0F → 2.* (Flags are two regional indicators and keycaps are `digit + FE0F + 20E3`; neither is `Extended_Pictographic` with presentation, so the old rule measured them as 1.) Replace "written once in the conformance file's header" with "stored under the `eastAsianWide` key of `cell-width.vectors.json`".

- [ ] **Step 2: Write `cell-width.vectors.json`** as `{ "eastAsianWide": [[start, end], …], "vectors": [[text, width], …] }`. The ranges are the Unicode East Asian Width `W` and `F` blocks (at least `1100–115F, 2E80–303E, 3041–33FF, 3400–4DBF, 4E00–9FFF, A000–A4CF, AC00–D7A3, F900–FAFF, FE30–FE4F, FF00–FF60, FFE0–FFE6, 20000–2FFFD, 30000–3FFFD`). Required vectors (VS Code's terminal, ambiguous-width = 1):

```json
[["", 0], ["abc", 3], ["Σ 123", 5], ["é", 1], ["中文", 4],
 ["🔥", 2], ["⌛", 2], ["❤️", 2], ["❤", 1], ["👨‍👩‍👧", 2], ["🇺🇸", 2], ["1️⃣", 2],
 ["◐", 1], ["⑂", 1], ["│", 1], ["…", 1], ["​", 0],
 ["\u001b[31mred\u001b[39m", 3],
 ["\u001b]8;;https://x\u001b\\link\u001b]8;;\u001b\\", 4],
 ["\u001b]8;;https://x\u0007link\u001b]8;;\u0007", 4]]
```

- [ ] **Step 3: Write `layout.vectors.json`** as an array of `{ name, manifest, expectRows }`, where every widget is static (`label` only, no sensors) so no sensor is involved, and `expectRows` is the exact plain text. Required cases:

| name | setup | expectRows[0] |
|---|---|---|
| pad-and-sep | `"ab"` w4, `"c"` w2, row sep `space` | `"ab   c "` |
| sep-override | `"a"` w1, `"b"` w1 with `sep: "pipe"` | `"a │ b"` |
| overflow | `"abcdef"` w4 | `"abc…"` |
| wide-cut | `"中文字"` w4 | `"中… "` |
| first-sep-ignored | `"a"` w1 with `sep: "pipe"`, `"b"` w1 | `"a b"` |
| two-rows | row 1 `"x"` w1, row 2 `"y"` w2 | `["x", "y "]` |
| slot-order | slot 2 `"b"`, slot 1 `"a"`, both w1 | `"a b"` |
| slot-tie | two slot-1 widgets `"a"` then `"b"` in file order | `"a b"` |

Each case also carries `expectWidths` (row widths), which equal `cellWidth(expectRows[i])`.

- [ ] **Step 4: Write `sensors.sample.json`**: one object per sensor id in August §7, whose keys are exactly that row's readings, filled with the values `tests/fixtures/full.json` should produce. This is what the webapp previews with. Track A's Task 9 asserts the engine's readings on `full.json` have the same keys.

- [ ] **Step 5: Create both empty test files and add CI steps** (`node plugins/claude-tui-dashboard/tests/engine.tests.js`, `node tests/webapp/contract.tests.js`). Run both; expected: exit 0.

- [ ] **Step 6: Commit on `feature/widget-contract`, merge to `develop`.**

```bash
git commit -m "feat(contract): shared cell-width, layout and sensor-sample vectors"
```

---

### Task 2 (A): Cell width and fitting

**Files:**
- Modify: `plugins/claude-tui-dashboard/statusline/statusline.js` (new section "cell width"; add `if (require.main !== module) module.exports = {…}` at the end, and run the CLI only when `require.main === module`)
- Test: `plugins/claude-tui-dashboard/tests/engine.tests.js`

**Interfaces:**
- Produces: `stripAnsi(text: string): string`, `cellWidth(text: string): number`, `fitText(text: string, width: number): string` (plain in, plain out, exactly `width` cells).

- [ ] **Step 1: Failing tests.** `cellWidth` passes every vector in `cell-width.vectors.json`. `fitText` cases: `fitText("ab",4) === "ab  "`, `fitText("abcdef",4) === "abc…"`, `fitText("中文字",4) === "中… "`, `fitText("x",1) === "x"`, `fitText("xy",1) === "…"`, and for every vector text `t` and widths 1–8, `cellWidth(fitText(stripAnsi(t), w)) === w`.
- [ ] **Step 2: Run:** `node plugins/claude-tui-dashboard/tests/engine.tests.js`. Expected: FAIL, `cellWidth is not a function`.
- [ ] **Step 3: Implement** per lean §5.1 (as corrected in Task 1), using `Intl.Segmenter` and `\p{…}` escapes. Load `eastAsianWide` ranges from a constant copied from the vectors file. `stripAnsi` removes CSI (`\x1b[…m`) and OSC 8 with both `\x1b\\` and `\x07` terminators.
- [ ] **Step 4: Run.** Expected: PASS, and `node plugins/claude-tui-dashboard/tests/run-tests.js` still passes all 81 checks.
- [ ] **Step 5: Commit** `feat(engine): cell width and exact-width fitting`.

---

### Task 3 (A): Rendering one widget

**Files:**
- Modify: `statusline.js` (new section "widget render")
- Test: `tests/engine.tests.js`

**Interfaces:**
- Consumes: `cellWidth`, `fitText` (Task 2); existing `tipText`, `osc8`, `button`, `col`, `dim`.
- Produces:
  - `resolveTemplate(tpl, ctx): string | null`, where `ctx = { readings: { [alias]: object|null }, needle(rampId): stop|null, glyph: string }`. `null` means "drop this unit" (August §5.3).
  - `renderWidget(def, readings, opts): string`, where `readings` is `{ [alias]: object|null }` and `opts = { now: number, hide: boolean, placeholder: {frames, color} }`. The visible width of the result is exactly `def.width`.

- [ ] **Step 1: Failing tests.**
  - `resolveTemplate("⑂ {ws.branchShort}", {readings:{ws:{branchShort:"f/abc"}}}) === "⑂ f/abc"`; the same with `branchShort: null` gives `null`.
  - Label parts `["↑{git.ahead}", "↓{git.behind}"]` with `ahead: 2, behind: null` renders `"↑2"` padded to width.
  - Ramp: the August §5.4 `tank` example picks `🪫` when `dryBeforeReset` is true and `🔋` otherwise; `{@tank.color}` resolves.
  - Absent (every bound alias `null`): output is the frame `◐` at `now = 0` and `◓` at `now = 1000`, dimmed, padded. With `opts.hide`, the output is `def.width` spaces.
  - Overflow with `color: "red"`: the visible text is `"abc…"`, wrapped once in `\x1b[31m … \x1b[39m`.
  - Link dress: the OSC 8 envelope wraps only the fitted text, and the padding sits outside the link.
  - Tooltip `["100%", "two words"]` gives the URI `claudectl://tip/100%25+two+words`; tooltip plus action gives `…/do/<encodeURIComponent(action)>` (August §5.6).
  - A ramp that throws, or a template that throws, makes the widget render as absent.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Order: resolve every unit to plain text → join parts → `fitText` against `width` → apply color and dress (August §5.5 table) to the fitted text only → append padding uncolored. When parts carry different colors, fit the joined plain text first, then re-split it at the original part boundaries.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): template, ramp and dress rendering at exact width`.

---

### Task 4 (A): Manifest, layout, tick; retire v1

**Files:**
- Modify: `statusline.js`: add the "manifest" and "layout" sections; delete `dashboardRow()` (around line 961) and its call in `render()`.
- Create: `plugins/claude-tui-dashboard/statusline/dashboard.default.json`, holding only the widgets ported so far (none yet; tasks 5–8 fill it). Until then, `render()` appends today's hard-coded rows for any segment not yet ported (see Step 3).
- Delete: `tests/fixtures/dashboard-sample.json`; replace with `tests/fixtures/manifest-v2.json`.
- Modify: `tests/run-tests.js:133-160` (the row-3 block)
- Test: `tests/engine.tests.js`

**Interfaces:**
- Consumes: `renderWidget` (Task 3), `cellWidth`.
- Produces:
  - `validateManifest(doc): { ok: true } | { ok: false, reason: string }`. Invalid when `version !== 2`, `widgets` or `rows` is not an array, any widget lacks a positive integer `width`, `row` or `slot`, two widgets share an `id`, or a separator's `width` differs from `cellWidth(text)`.
  - `loadManifest(): object`, which never throws: `DASHBOARD_JSON` or `~/.claude/dashboard.json` if valid, else `DASHBOARD_DEFAULT_JSON` or `path.join(__dirname, "dashboard.default.json")`, else `null`.
  - `layoutRow(rowDef, items, separators): string`, where `items` is an array of `{ def, text }` already sorted.
  - `renderBar(manifest, payload, raw, now): string`.
  - `SENSORS: { [id]: (payload, args, tick) => object | null }` (empty registry; tasks 5–8 fill it), memoised per `id + JSON.stringify(args)` per tick.

- [ ] **Step 1: Failing tests.**
  - Every case in `layout.vectors.json` renders `expectRows` exactly.
  - Unknown sensor id: the placeholder renders and the rest of the row is intact.
  - Unknown `sep`: the row default is used.
  - `hideAbsent` matrix: manifest-on/widget-off is hidden, manifest-off/widget-on is hidden, manifest-off/widget-off shows the placeholder. A widget can't override manifest-on with `false`.
  - A widget whose every label fragment drops (all readings `null`) renders `width` blank cells. This replaces the August `show` for mode chips.
  - `validateManifest` rejects a missing `width`, a duplicate `id`, `version: 1`, and a `pipe` separator declared `width: 2`, each with a distinct `reason`.
  - In `run-tests.js`, replace the row-3 checks: a v2 fixture renders its widgets; a v1 file, a missing file, and bad JSON each render the default bar with exit 0.
- [ ] **Step 2: Run both test files.** Expected: FAIL.
- [ ] **Step 3: Implement** per August §6.1, with one bridge so the bar stays complete mid-migration: `render()` prints the manifest's rows, then the legacy rows built from segments no default widget claims yet. The bridge is deleted in Task 8. Wrap the whole tick so any throw outside a widget prints a minimal `status` line.
- [ ] **Step 4: Run both.** Expected: PASS, with the 81 legacy checks less the replaced row-3 checks.
- [ ] **Step 5: Commit** `feat(engine): v2 manifest, layout and tick; retire the v1 row`.

---

### Tasks 5–8 (A): Port the sensors and build the default manifest

Each of these four tasks has the same shape:

1. Turn each listed `*Segment` / `*Chip` function into a sensor in `SENSORS` that returns exactly the readings in August §7, with its listed side effects intact.
2. Add a widget to `dashboard.default.json` that reproduces today's face, tooltip and action through templates and ramps.
3. Delete the old function and its bridge entry.

The existing glyph checks in `run-tests.js` that cover those segments must keep passing unchanged, which proves the face survived. Each task adds `engine.tests.js` checks asserting the sensor's readings on `full.json` and on `minimal.json` (absent where §7 says absent).

**Default-manifest rules (Claude's call):**
- **Rows.** Today's line 1 is about 170 cells at fixed widths, so it splits in two. Row 1 is identity, context, windows, burn, tokens and cost. Row 2 is spend rate, clock, cache, session, churn, modes, account, pet and stale. Row 3 is today's line 2 (git). Each row's `budget` is the smallest multiple of 10 that fits its widgets.
- **Widths.** Each widget's `width` is the cell width of its widest face over both fixtures plus the variants its ramps can produce. Record the arithmetic in a `meta.widthNote` string on the widget (JSON has no comments).
- **Separators.** Row separator `space`; the window widgets use `sep: "pipe"`, which preserves today's `|` between them.
- **Hiding.** `hideAbsent: true` on widgets whose absence is normal rather than pending: `trap`, `pr`, `ci`, `churn`, `pet`, `account`, and the worktree chip. Everything else shows the placeholder.

| Task | Commit | Functions → sensors |
|---|---|---|
| 5 | `feat(engine): port usage sensors` | `modelIcon`/identity, `gaugeSegment`+`trapSegment` → `context` (trap becomes a `context` reading `trap: bool`), `windowSegment`/`usageLine` → `windows` (one widget per key: `five_hour`, `seven_day`), `tokenSegment` → `tokens`, `costSegment`/`spendRateSegment`/`clockSegment` → `cost` |
| 6 | `feat(engine): port stateful sensors` | `burnSegment` → `burn` (samples file), `cacheSegment` → `cache` (transcript tail), `staleSegment` → `stale` (meta file), `petSegment` → `pet`, `accountChip` → `account` (6 h cache) |
| 7 | `feat(engine): port session sensors` | `sessionChip` → `session`, `churnSegment` → `churn`, `smallChips` → `modes` (one widget per chip; empty chips render blank width) |
| 8 | `feat(engine): port workspace sensors; drop the legacy bridge` | `gitIntel`/`gitIntelText` → `git`, `prStatus`/`prIsDone` → `pr` (merged or closed counts as absent), `ciSegment` → `ci` (detached refresh and lock intact), branch, folder and base links → `workspace`, 📒/📜 → `transcript`. The "line 2 always has two links" fallback is dropped (D6): the repo, issues and cwd links become ordinary widgets. Delete the bridge from Task 4. |

Steps per task:
- [ ] **Step 1: Failing tests:** reading assertions for each new sensor in `engine.tests.js`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement the sensors, add the widgets, delete the old functions.**
- [ ] **Step 4: Run both test files.** Expected: PASS, with the legacy glyph checks for these segments unchanged.
- [ ] **Step 5: Commit** with the message in the table.

---

### Task 9 (A): Close-out: default fits, deploy, docs

**Files:**
- Modify: `plugins/claude-tui-dashboard/skills/activate-dashboard/SKILL.md`: Step 2 also copies `statusline/dashboard.default.json` to `~/.claude/dashboard.default.json`; the JSON-argument mode validates against v2 using the `validateManifest` reasons.
- Modify: `plugins/claude-tui-dashboard/skills/deactivate-dashboard/SKILL.md` (remove `~/.claude/dashboard.default.json`), and `skills/diagnose/SKILL.md` wherever it mentions row 3 or v1.
- Modify: the `statusline.js` header comment (lines 1–50), plugin `README.md`, and `CHANGELOG.md` (Unreleased: v2 engine, v1 retired).
- Test: `tests/engine.tests.js`

- [ ] **Step 1: Failing tests.**
  - The default manifest passes `validateManifest`, and every row's `Σ widths + Σ printed separators ≤ budget`.
  - Rendering `full.json` gives each output line a `cellWidth` equal to that row's computed width.
  - The engine's readings on `full.json` have exactly the keys in `contract/sensors.sample.json`.
  - The rendered output contains no legacy-only code path (grep the source for `dashboardRow` and the bridge: absent).
- [ ] **Step 2: Run.** Expected: FAIL until docs and skills are updated and widths are corrected.
- [ ] **Step 3: Implement:** fix widths and budgets, and update the skills and docs.
- [ ] **Step 4: Run all three suites,** including `powershell -NoProfile -ExecutionPolicy Bypass -File plugins/claude-tui-dashboard/tests/handler.tests.ps1`. Expected: all PASS. Then render once by hand in a VS Code terminal (`Get-Content tests/fixtures/full.json | node statusline/statusline.js`), and confirm the rows are aligned and the placeholder spins across redraws.
- [ ] **Step 5: Commit** `docs(engine): deploy the default manifest; document v2`.

---

### Task 10 (B): Webapp contract block

**Files:**
- Modify: `webapp/index.html`: a second `<script>` element whose content sits between the lines `// <contract>` and `// </contract>`, holding only pure functions with no DOM access.
- Test: `tests/webapp/contract.tests.js`

**Interfaces:**
- Produces, in the contract block: `stripAnsi`, `cellWidth`, `fitText`, `layoutRow(rowDef, items, separators)`, `validateManifest(doc)`, with the same names, signatures and reasons as track A. Unlike the engine's `layoutRow`, `items[i].text` is plain preview text.

- [ ] **Step 1: Failing test.** `contract.tests.js` reads `index.html`, extracts the text between the sentinels, evaluates it with `new Function(text + "; return {stripAnsi, cellWidth, fitText, layoutRow, validateManifest};")`, then runs every case in `cell-width.vectors.json` and `layout.vectors.json`, plus the three `validateManifest` rejections from Task 4.
- [ ] **Step 2: Run:** `node tests/webapp/contract.tests.js`. Expected: FAIL, sentinels not found.
- [ ] **Step 3: Implement** per lean §4, §5 and §5.1.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(webapp): contract block proven against the shared vectors`.

---

### Task 11 (B): Webapp v2 model and editor

**Files:**
- Modify: `webapp/index.html` (`defaultState`, `BarView`, `StagingView`, `PushView`, `App`; the CSS for multi-row preview)
- Test: `tests/webapp/contract.tests.js` (new pure functions go in the contract block)

**Interfaces:**
- Consumes: the Task 10 contract block; `contract/sensors.sample.json`, embedded as a constant (`SAMPLE_READINGS`) by copying. The test asserts the embedded copy deep-equals the file.
- Produces, in the contract block:
  - `toManifest(state): object`, a valid v2 manifest.
  - `fromManifest(doc): state`
  - `previewRows(manifest, readings, now): string[]`, plain text with simple `{alias.reading}` substitution and fragment dropping. Ramps preview as their first stop (Claude's call: the webapp is not a second engine).

- [ ] **Step 1: Failing tests.** `fromManifest(toManifest(s))` round-trips the default state. `previewRows` of a manifest built from `layout.vectors.json` equals `expectRows`. A widget with absent sample readings previews the placeholder frame chosen by `now`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement the model and the editor.**
  - **Rows panel:** add or remove rows; per row, the default separator (`space` preselected, `pipe` offered) and the budget.
  - **Widget card fields:** row, slot, width, `sep`, `hideAbsent`, sensors (picked from `SAMPLE_READINGS` keys), label, tooltip and action. The action keeps the existing actions reservoir.
  - **Manifest-level settings:** `hideAbsent` toggle; placeholder frames.
  - **Bar:** renders `previewRows`, animated once a second; each row shows a budget meter `used / budget`.
  - **Over budget:** git commit is disabled while a row is over budget, with the reason shown.
- [ ] **Step 4: Run tests.** Expected: PASS. Then open `webapp/index.html` in a browser and build a two-row bar; the preview alignment matches `previewRows`.
- [ ] **Step 5: Commit** `feat(webapp): v2 rows, widgets and budgeted preview`.

---

### Task 12 (B): Webapp v2 export and import

**Files:**
- Modify: `webapp/index.html` (`PushView`, `PullView`); `webapp/README.md` (replace the v1 schema section with a pointer to the lean spec)
- Test: `tests/webapp/contract.tests.js`

**Interfaces:**
- Consumes: `toManifest`, `fromManifest`, `validateManifest`.
- Produces: `convertV1(doc): object`, which maps each v1 `row[]` button to a static widget on a new last row (`slot` = index + 1, `width` = `cellWidth(glyph)`, tooltip and action copied) and drops dividers and flex items. This is the cheap answer to "write in whatever's worth keeping". It's optional: strike this step if v1 files no longer exist anywhere.

- [ ] **Step 1: Failing tests.** Export output passes `validateManifest`. Importing a file with a missing `width` shows that exact reason. `convertV1` on the deleted v1 fixture's content (inline it in the test) yields a valid v2 manifest whose widgets keep the glyphs and the tip/do URIs.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The export panel shows `version: 2` JSON with Copy and Download. Import validates, offers `convertV1` when `version === 1`, then merges or replaces as today.
- [ ] **Step 4: Run tests.** Expected: PASS. In a browser: export, paste the export back, and the bar is unchanged.
- [ ] **Step 5: Commit** `feat(webapp): v2 export and import with v1 conversion`.
