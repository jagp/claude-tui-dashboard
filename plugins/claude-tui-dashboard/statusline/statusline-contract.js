/* ============================================================
   STATUSLINE CONTRACT: the one copy of the widget-engine v2 rules.
   Pure functions only: no DOM, no file system, no Node built-ins.

   Loaded twice, written once:
     - the statusline engine: statusline.js require()s this file,
       which is deployed beside it (~/.claude/statusline-contract.js)
     - the webapp: webapp/index.html loads it with a <script> tag
   so the webapp's preview and the real statusline cannot drift.
   Tested against the shared example files in
   plugins/claude-tui-dashboard/contract/ by
   plugins/claude-tui-dashboard/tests/engine.tests.js.

   Spec: docs/superpowers/specs/2026-11-22-widget-engine-lean.md
     cellWidth / fitText ...... lean §5 and §5.1
     layoutRow / rowWidth ..... lean §4
     resolveWidget ............ lean §5 + August §5.3 templates
     validateManifest ......... manifest.vectors.json reasons
     toManifest / fromManifest  the editor's model <-> the file

   A classic script, not an ES module: module scripts refuse to
   load from file://, and the webapp can be opened from disk.
   ============================================================ */
"use strict";
/* Copied from contract/cell-width.vectors.json ("eastAsianWide").
   The engine test asserts this copy equals the file. */
const EAST_ASIAN_WIDE = [[4352,4447],[11904,12350],[12353,13311],[13312,19903],[19968,40959],[40960,42191],[44032,55203],[63744,64255],[65072,65103],[65280,65376],[65504,65510],[131072,196605],[196608,262141]];

const DEFAULT_SEPARATORS = { space: { text: " ", width: 1 }, pipe: { text: " │ ", width: 3 } };
const DEFAULT_PLACEHOLDER = { frames: ["◐", "◓", "◑", "◒"], color: "dim" };
const DEFAULT_BUDGET = 78;
const FALLBACK_SEPARATOR = { text: " ", width: 1 }; /* row names a type that doesn't exist */
const TOOLTIP_MAX = 1000;
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const deepCopy = value => JSON.parse(JSON.stringify(value));
const isPositiveInteger = value => Number.isInteger(value) && value > 0;

/* ---------- cell width (lean §5.1) ----------
   1. strip escape sequences: OSC (ends in BEL or ESC \), then CSI
   2. split into graphemes (what the eye sees as one character)
   3. add up each grapheme's cells: 2, 1 or 0 */
function stripAnsi(text) {
  return String(text)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")  /* OSC 8 links and friends */
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "");       /* CSI: colors, cursor moves */
}

function isEastAsianWide(codePoint) {
  return EAST_ASIAN_WIDE.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/* One grapheme's cells:
   - emoji presentation, a flag letter, or a VS16 (U+FE0F) anywhere -> 2
   - first code point East Asian Wide/Fullwidth                    -> 2
   - only zero-width code points (marks, ZW space/joiners, VS)     -> 0
   - anything else                                                 -> 1 */
function graphemeWidth(grapheme) {
  if (/\p{Emoji_Presentation}|\p{Regional_Indicator}|️/u.test(grapheme)) return 2;
  if (isEastAsianWide(grapheme.codePointAt(0))) return 2;
  if (/^[\p{M}​-‍︀-️]+$/u.test(grapheme)) return 0;
  return 1;
}

function graphemes(text) {
  return Array.from(SEGMENTER.segment(String(text)), part => part.segment);
}

function cellWidth(text) {
  return graphemes(stripAnsi(text)).reduce((total, grapheme) => total + graphemeWidth(grapheme), 0);
}

/* ---------- exact width (lean §5, D7) ----------
   fits:     pad on the right with spaces up to `width`
   too wide: keep whole graphemes while they fit in width - 1 cells,
             add "…", then pad (a space fills the gap left by a cut
             through a 2-cell grapheme) */
function fitText(text, width) {
  const plain = String(text);
  const total = cellWidth(plain);
  if (total <= width) return plain + " ".repeat(width - total);
  let kept = "", used = 0;
  for (const grapheme of graphemes(plain)) {
    const cells = graphemeWidth(grapheme);
    if (used + cells > width - 1) break;
    kept += grapheme;
    used += cells;
  }
  return kept + "…" + " ".repeat(width - used - 1);
}

/* ---------- layout (lean §4) ----------
   Widgets on a row go in slot order; ties keep file order.
   Between neighbours print the right-hand widget's `sep` if that type
   exists, else the row's `separator`. Nothing before the first widget
   or after the last. */
function sortRowWidgets(defs) {
  return defs
    .map((def, index) => ({ def, index }))
    .sort((left, right) => left.def.slot - right.def.slot || left.index - right.index)
    .map(entry => entry.def);
}

function separatorBefore(def, rowDef, separators) {
  const types = separators || DEFAULT_SEPARATORS;
  if (def.sep && types[def.sep]) return types[def.sep];
  return types[rowDef.separator] || FALLBACK_SEPARATOR;
}

/* items: [{ def, text }] already sorted, text already exactly def.width cells */
function layoutRow(rowDef, items, separators) {
  return items
    .map((item, index) => (index === 0 ? "" : separatorBefore(item.def, rowDef, separators).text) + item.text)
    .join("");
}

/* Row width from declared widths alone (layout never depends on content):
   Σ widget widths + Σ widths of the separators actually printed. */
function rowWidth(rowDef, defs, separators) {
  return sortRowWidgets(defs).reduce((total, def, index) =>
    total + def.width + (index === 0 ? 0 : separatorBefore(def, rowDef, separators).width), 0);
}

/* ---------- templates (August §5.3) ----------
   A template is a string with {placeholders}:
     {glyph}            the widget's resolved glyph
     {@ramp} {@ramp.x}  a ramp's needle; the preview uses the FIRST stop
                        (the webapp is not a second engine)
     {alias.reading}    a reading of a bound sensor (lean §3)
     {reading}          with exactly one bound sensor, reads that sensor
                        (the shorthand the August §9 examples use)
   If any placeholder in a unit resolves to null/undefined/"", the whole
   unit is dropped; fillTemplate signals that by returning null. */
function boundSensors(def) {
  if (def.sensors && typeof def.sensors === "object") return def.sensors;  /* alias -> sensor id */
  if (typeof def.sensor === "string") return { [def.sensor]: def.sensor };  /* shorthand */
  return {};
}

function readPath(root, path) {
  return path.reduce((node, key) => (node === null || node === undefined ? undefined : node[key]), root);
}

function lookup(name, scope) {
  if (name === "glyph") return scope.glyph;
  if (name.charAt(0) === "@") {
    const [rampId, field] = name.slice(1).split(".");
    const ramp = scope.ramps[rampId];
    const stop = ramp && Array.isArray(ramp.stops) ? ramp.stops[0] : undefined;
    return stop ? stop[field || "glyph"] : undefined;
  }
  const path = name.split(".");
  if (Object.prototype.hasOwnProperty.call(scope.data, path[0])) return readPath(scope.data[path[0]], path.slice(1));
  if (scope.single !== undefined) return readPath(scope.single, path);
  return undefined;
}

function fillTemplate(template, scope) {
  let dropped = false;
  const out = String(template).replace(/\{([^{}]+)\}/g, (whole, name) => {
    const value = lookup(name.trim(), scope);
    if (value === undefined || value === null || value === "") { dropped = true; return ""; }
    return String(value);
  });
  return dropped ? null : out;
}

/* scope = everything a template can see for one widget */
function makeScope(def, data, aliases) {
  const scope = {
    glyph: "",
    ramps: (def && def.ramps) || {},
    data,
    single: aliases.length === 1 ? data[aliases[0]] : undefined
  };
  if (def && typeof def.glyph === "string") {
    const glyph = /^@[\w-]+$/.test(def.glyph) ? fillTemplate("{" + def.glyph + "}", scope) : fillTemplate(def.glyph, scope);
    scope.glyph = glyph === null ? "" : glyph;
  }
  return scope;
}

/* label: a template, a part[] array, or { parts, join }.
   Each part is one unit: dropped parts vanish, survivors are joined. */
function resolveLabel(label, scope) {
  if (typeof label === "string") return fillTemplate(label, scope) || "";
  const parts = Array.isArray(label) ? label : (label && Array.isArray(label.parts) ? label.parts : []);
  const join = label && !Array.isArray(label) && typeof label.join === "string" ? label.join : "";
  return parts
    .map(part => fillTemplate(typeof part === "string" ? part : (part && part.text) || "", scope))
    .filter(text => text !== null)
    .join(join);
}

/* ---------- tooltips (August §5.3) ----------
   word[]: each word is a unit; a nested array is an optional group that
   drops whole if any of its words drops. A string is split on "+".
   Then sanitise: % -> %25, whitespace -> +, bytes outside ASCII 32-126
   dropped, clipped to 1000 chars. Authors write a plain %. */
function tooltipWords(tooltip, scope) {
  const words = typeof tooltip === "string" ? tooltip.split("+").filter(Boolean) : (Array.isArray(tooltip) ? tooltip : []);
  const out = [];
  for (const word of words) {
    if (Array.isArray(word)) {
      const group = tooltipWords(word, scope);
      if (group.length === word.length) out.push(...group);   /* every word of the group survived */
    } else {
      const text = fillTemplate(word, scope);
      if (text !== null && text !== "") out.push(text);
    }
  }
  return out;
}

function sanitizeTooltip(text) {
  let out = "";
  for (const character of text.replace(/%/g, "%25").replace(/\s+/g, "+")) {
    const code = character.codePointAt(0);
    if (code >= 32 && code <= 126) out += character;
  }
  return out.slice(0, TOOLTIP_MAX);
}

/* data: alias -> readings object; aliases: bound aliases; def optional (glyph, ramps) */
function resolveTooltip(tooltip, data, aliases, def) {
  return sanitizeTooltip(tooltipWords(tooltip, makeScope(def || {}, data || {}, aliases || [])).join("+"));
}

/* URI composition rule (August §5.6): statusline and handler MUST agree. */
function composeUri(tooltip, action) {
  const tip = tooltip || "", act = action || "";
  if (!act) return "claudectl://tip/" + tip;                                /* action empty  */
  if (!tip) return act;                                                     /* tooltip empty */
  return "claudectl://tip/" + tip + "/do/" + encodeURIComponent(act);       /* both present  */
}

/* ---------- one widget (lean §5) ----------
   1. look up each bound sensor's readings
   2. every bound sensor absent -> placeholder frame, or blank when hidden
      (hidden = manifest hideAbsent OR widget hideAbsent; D5)
   3. else fill the label; it may come out empty (all parts dropped),
      which renders as blank cells, not the placeholder
   4. fit to exactly `width` cells. A throw counts as absent. */
function placeholderFrame(manifest, now) {
  const configured = manifest.placeholder && manifest.placeholder.frames;
  const frames = Array.isArray(configured) && configured.length ? configured : DEFAULT_PLACEHOLDER.frames;
  return String(frames[Math.floor(now / 1000) % frames.length]);
}

function absentWidget(def, manifest, now) {
  if (manifest.hideAbsent === true || def.hideAbsent === true) return { state: "hidden", text: " ".repeat(def.width) };
  return { state: "placeholder", text: fitText(placeholderFrame(manifest, now), def.width) };
}

function widgetData(def, readings) {
  const sensors = boundSensors(def);
  const aliases = Object.keys(sensors);
  const data = {};
  aliases.forEach(alias => {
    const found = readings ? readings[sensors[alias]] : undefined;
    if (found !== undefined && found !== null) data[alias] = found;
  });
  return { aliases, data };
}

function resolveWidget(def, manifest, readings, now) {
  try {
    const { aliases, data } = widgetData(def, readings);
    if (aliases.length > 0 && Object.keys(data).length === 0) return absentWidget(def, manifest, now);
    const scope = makeScope(def, data, aliases);
    const text = resolveLabel(def.label === undefined ? "{glyph}" : def.label, scope);
    return {
      state: text ? "ok" : "empty",
      text: fitText(text, def.width),
      measured: cellWidth(text),                                            /* for the editor's "fit" hint */
      tooltip: resolveTooltip(def.tooltip, data, aliases, def),
      action: typeof def.action === "string" ? (fillTemplate(def.action, scope) || "") : ""
    };
  } catch (error) {
    return absentWidget(def, manifest, now);
  }
}

/* ---------- the whole bar ----------
   previewLayout: per declared row (in `rows` order), the sorted widgets,
   each resolved, with the separator printed before it and the row's
   used/budget figures. previewRows flattens that to plain text. */
function previewLayout(manifest, readings, now) {
  const separators = manifest.separators || DEFAULT_SEPARATORS;
  return manifest.rows.map(rowDef => {
    const defs = sortRowWidgets(manifest.widgets.filter(def => def.row === rowDef.row));
    const items = defs.map((def, index) => Object.assign(
      { def, separator: index === 0 ? null : separatorBefore(def, rowDef, separators) },
      resolveWidget(def, manifest, readings, now)));
    return { rowDef, items, used: rowWidth(rowDef, defs, separators), budget: rowDef.budget };
  });
}

function previewRows(manifest, readings, now) {
  return previewLayout(manifest, readings, now)
    .map(row => layoutRow(row.rowDef, row.items, manifest.separators));
}

/* ---------- validation ----------
   Order and wording are pinned by contract/manifest.vectors.json; the
   engine reports the same reasons. First failure wins. */
function validateManifest(doc) {
  const fail = reason => ({ ok: false, reason });
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return fail("manifest must be a JSON object");
  if (doc.version !== 2) return fail("version must be 2");
  if (!Array.isArray(doc.rows)) return fail("rows must be an array");
  if (!Array.isArray(doc.widgets)) return fail("widgets must be an array");
  if (doc.separators !== undefined) {
    if (!doc.separators || typeof doc.separators !== "object" || Array.isArray(doc.separators)) return fail("separators must be an object");
    for (const name of Object.keys(doc.separators)) {
      const type = doc.separators[name];
      if (!type || typeof type.text !== "string" || !Number.isInteger(type.width)) return fail("separator \"" + name + "\" needs text and an integer width");
      const actual = cellWidth(type.text);
      if (type.width !== actual) return fail("separator \"" + name + "\" declares width " + type.width + " but its text is " + actual + " cells");
    }
  }
  for (let index = 0; index < doc.rows.length; index++) {
    const rowDef = doc.rows[index];
    if (!rowDef || !isPositiveInteger(rowDef.row)) return fail("rows[" + index + "] needs a positive integer row");
  }
  const seen = new Set();
  for (let index = 0; index < doc.widgets.length; index++) {
    const def = doc.widgets[index];
    if (!def || typeof def.id !== "string" || !def.id) return fail("widgets[" + index + "] needs a non-empty string id");
    for (const field of ["row", "slot", "width"]) {
      if (!isPositiveInteger(def[field])) return fail("widget \"" + def.id + "\" needs a positive integer " + field);
    }
    if (seen.has(def.id)) return fail("duplicate widget id \"" + def.id + "\"");
    seen.add(def.id);
  }
  return { ok: true };
}

/* ---------- editor model <-> manifest ----------
   The editor keeps the manifest itself as its model (state.manifest), so
   unknown fields at every level survive untouched. fromManifest fills the
   defaults a hand-written file may leave out; toManifest makes sure every
   widget's row is declared, so nothing silently fails to print. */
function defaultManifest() {
  return {
    version: 2,
    hideAbsent: false,
    placeholder: deepCopy(DEFAULT_PLACEHOLDER),
    separators: deepCopy(DEFAULT_SEPARATORS),
    rows: [
      { row: 1, separator: "space", budget: DEFAULT_BUDGET },
      { row: 2, separator: "space", budget: DEFAULT_BUDGET }
    ],
    widgets: []
  };
}

/* Also repairs fields validateManifest leaves to the editor, so a pasted
   file can never break the page: placeholder frames must be a non-empty
   list of strings, every row needs a positive integer budget (a missing
   one would switch budget enforcement off) and a separator name. */
function fromManifest(doc) {
  const manifest = deepCopy(doc);
  const defaults = defaultManifest();
  if (typeof manifest.hideAbsent !== "boolean") manifest.hideAbsent = false;
  if (!manifest.placeholder || typeof manifest.placeholder !== "object") manifest.placeholder = defaults.placeholder;
  const frames = manifest.placeholder.frames;
  if (!Array.isArray(frames) || !frames.length || !frames.every(frame => typeof frame === "string" && frame)) manifest.placeholder.frames = defaults.placeholder.frames;
  if (typeof manifest.placeholder.color !== "string") manifest.placeholder.color = defaults.placeholder.color;
  if (!manifest.separators) manifest.separators = defaults.separators;
  if (!Array.isArray(manifest.rows)) manifest.rows = [];
  manifest.rows.forEach(rowDef => {
    if (!isPositiveInteger(rowDef.budget)) rowDef.budget = DEFAULT_BUDGET;
    if (typeof rowDef.separator !== "string") rowDef.separator = "space";
  });
  if (!Array.isArray(manifest.widgets)) manifest.widgets = [];
  return { manifest };
}

function toManifest(state) {
  const manifest = deepCopy(state.manifest);
  manifest.version = 2;
  const declared = new Set(manifest.rows.map(rowDef => rowDef.row));
  manifest.widgets.forEach(def => {
    if (!declared.has(def.row)) {
      manifest.rows.push({ row: def.row, separator: "space", budget: DEFAULT_BUDGET });
      declared.add(def.row);
    }
  });
  return manifest;
}

/* Node (the engine and its tests) gets the functions as a module; in the
   browser this guard is skipped and the declarations above are globals
   the webapp's own script uses directly. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    EAST_ASIAN_WIDE, DEFAULT_SEPARATORS, DEFAULT_PLACEHOLDER, DEFAULT_BUDGET,
    stripAnsi, cellWidth, fitText, layoutRow, rowWidth, validateManifest,
    resolveWidget, resolveTooltip, composeUri, previewLayout, previewRows,
    defaultManifest, toManifest, fromManifest
  };
}
