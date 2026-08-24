#!/usr/bin/env node
// widget-map.js — deterministic tooling for the dashboard-row widget layer.
// Contract: ../../../docs/widget-schema.md (slot geometry, no-clobber rule,
// overwrite semantics). Plain CommonJS, no deps — same discipline as
// statusline.js. Two verbs:
//
//   node widget-map.js map                            print the slot legend
//   node widget-map.js add <slot> <glyph> [--force]   wire a widget into a slot
//
// Target file: --file <path> > $DASHBOARD_JSON > ~/.claude/dashboard.json —
// the same env override the renderer honors (statusline.js, dashboardRow), so
// tests and dry-runs never touch the real file.
//
// Exit codes: 0 ok · 1 usage · 2 unreadable/foreign JSON · 3 slot occupied
// without --force. The add-widget skill turns a 3 into the confirm-then-force
// overwrite flow (the future overwrite-widget-glyph function's seam).

const fs = require("fs");
const os = require("os");
const path = require("path");

// Draft constants from the widget schema — change there first, then here.
const SLOT_COUNT = 12; // 12 × SLOT_WIDTH + 11 joins = 71 cells ≤ SOFT_CAP
const SLOT_WIDTH = 5;  // per-widget cell budget (emoji = 2 cells)
const SOFT_CAP = 78;   // warn past this estimated row width; never refuse
const FLEX_GAP = 3;    // renderer's default flex gap ("   ") when COLUMNS is unset

// --- args --------------------------------------------------------------------

const argv = process.argv.slice(2);
const flags = { force: false, file: null };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--force") flags.force = true;
  else if (argv[i] === "--file") flags.file = argv[++i];
  else positional.push(argv[i]);
}
const command = positional.shift();

const targetFile =
  flags.file ||
  process.env.DASHBOARD_JSON ||
  path.join(os.homedir(), ".claude", "dashboard.json");

function usage(msg) {
  if (msg) console.error(msg);
  console.error(
    "usage: widget-map.js map [--file <path>]\n" +
      "       widget-map.js add <slot 1-" + SLOT_COUNT + "> <glyph> [--force] [--file <path>]",
  );
  process.exit(1);
}

// --- load / save -------------------------------------------------------------

// Missing file → a fresh empty v1 doc. Corrupt JSON or a foreign version →
// exit 2 and touch nothing: a broken file is the user's to inspect, and a
// non-v1 stamp already makes the renderer drop the whole row (schema doc,
// "The wire file") — overwriting it would destroy evidence.
function loadDoc() {
  let text;
  try {
    text = fs.readFileSync(targetFile, "utf8");
  } catch {
    return { version: 1, row: [] };
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    console.error(`error: ${targetFile} is not valid JSON (${e.message}) — refusing to touch it`);
    process.exit(2);
  }
  if (!doc || doc.version !== 1 || !Array.isArray(doc.row)) {
    console.error(`error: ${targetFile} is not a version-1 dashboard.json — refusing to touch it`);
    process.exit(2);
  }
  return doc;
}

// Pretty two-space JSON, matching the webapp's export formatting.
function saveDoc(doc) {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, JSON.stringify(doc, null, 2) + "\n");
}

// --- width estimation --------------------------------------------------------

// Terminal cell width, approximated per the schema doc: strip variation
// selectors and ZWJ (they join, they don't occupy), then astral code points
// (emoji live in U+1F000+) count 2 cells, everything else 1. Real terminals
// disagree at the margins — which is why SOFT_CAP warns instead of blocking.
function cellWidth(str) {
  let width = 0;
  for (const ch of String(str).replace(/[\uFE0F\u200D]/g, "")) {
    width += ch.codePointAt(0) > 0xffff ? 2 : 1;
  }
  return width;
}

// Mirror of the renderer's row assembly (statusline.js, dashboardRow): each
// renderable item contributes its glyph cells, flex contributes the default
// gap, and every pair of items is joined by one space.
function estimateRowWidth(row) {
  const widths = [];
  for (const item of row) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "flex") widths.push(FLEX_GAP);
    else if (item.type === "divider") widths.push(cellWidth(item.glyph || "|"));
    else if (item.type === "button" && typeof item.glyph === "string" && item.glyph)
      widths.push(cellWidth(item.glyph));
  }
  if (!widths.length) return 0;
  return widths.reduce((a, b) => a + b, 0) + (widths.length - 1);
}

// --- the map / legend --------------------------------------------------------

// Buttons carrying an integer slot in range are the widget layer; everything
// else on the row is left alone (schema doc, "Ordering & insertion").
const isWidget = (item) =>
  item &&
  typeof item === "object" &&
  item.type === "button" &&
  Number.isInteger(item.slot) &&
  item.slot >= 1 &&
  item.slot <= SLOT_COUNT;

// One legend cell: content right-aligned in a 4-cell column, with emoji width
// accounted so the glyph row stays aligned under the slot numbers.
function cell(text) {
  return " ".repeat(Math.max(1, 4 - cellWidth(text))) + text;
}

function printMap(doc) {
  const bySlot = new Map();
  const dupes = [];
  let dividers = 0;
  let flexes = 0;
  let slotless = 0;
  for (const item of doc.row) {
    if (isWidget(item)) {
      if (bySlot.has(item.slot)) dupes.push(item.slot);
      else bySlot.set(item.slot, item);
    } else if (item && typeof item === "object") {
      if (item.type === "divider") dividers++;
      else if (item.type === "flex") flexes++;
      else if (item.type === "button") slotless++;
    }
  }

  let header = " slot ";
  let glyphs = " glyph";
  for (let n = 1; n <= SLOT_COUNT; n++) {
    header += cell(String(n));
    glyphs += cell(bySlot.has(n) ? bySlot.get(n).glyph : "·");
  }
  console.log(header);
  console.log(glyphs);

  const width = estimateRowWidth(doc.row);
  const extras = [];
  if (dividers) extras.push(`${dividers} divider${dividers > 1 ? "s" : ""}`);
  if (flexes) extras.push(`${flexes} flex`);
  if (slotless) extras.push(`${slotless} slotless button${slotless > 1 ? "s" : ""}`);
  const census = extras.length ? `   (also on the row: ${extras.join(" · ")})` : "";
  const mark = width > SOFT_CAP ? "⚠ OVER SOFT CAP — the bar may wrap" : "✓";
  console.log(` row width ≈ ${width} / ${SOFT_CAP} cells ${mark}${census}`);
  for (const s of dupes) console.log(` warn: slot ${s} claimed by more than one item — first wins`);
}

// --- add ---------------------------------------------------------------------

function addWidget(slot, glyph) {
  const doc = loadDoc();
  const existing = doc.row.find((item) => isWidget(item) && item.slot === slot);

  if (existing && !flags.force) {
    console.error(`occupied: slot ${slot} holds "${existing.glyph}" — re-run with --force to overwrite the glyph`);
    process.exit(3);
  }

  if (existing) {
    // Glyph-only overwrite: tooltip/action/keybind and unknown fields survive
    // (schema doc, "Occupancy & overwrite" — the overwrite-widget-glyph seam).
    existing.glyph = glyph;
  } else {
    // Stable-insert before the first higher-slotted widget so slotted items
    // stay ascending without ever moving dividers/flex/slotless buttons.
    const widget = { type: "button", glyph, slot };
    let at = -1;
    let lastWidget = -1;
    for (let i = 0; i < doc.row.length; i++) {
      if (!isWidget(doc.row[i])) continue;
      lastWidget = i;
      if (at === -1 && doc.row[i].slot > slot) at = i;
    }
    if (at === -1) at = lastWidget + 1 || doc.row.length; // after last widget, else append
    doc.row.splice(at, 0, widget);
  }

  saveDoc(doc);
  console.log(`${existing ? "overwrote" : "wired"} slot ${slot} → ${glyph}  (${targetFile})`);
  if (/\u200D/.test(glyph))
    console.log(" warn: glyph is a ZWJ sequence — may split or tofu in some terminals (see customizing-glyphs.md)");
  if (cellWidth(glyph) > SLOT_WIDTH)
    console.log(` warn: glyph is ${cellWidth(glyph)} cells — over the ${SLOT_WIDTH}-cell slot budget`);
  printMap(doc);
}

// --- dispatch ----------------------------------------------------------------

if (command === "map") {
  printMap(loadDoc());
} else if (command === "add") {
  const slot = Number(positional[0]);
  const glyph = positional[1];
  if (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT)
    usage(`error: slot must be an integer 1-${SLOT_COUNT}, got "${positional[0]}"`);
  if (!glyph) usage("error: missing <glyph>");
  addWidget(slot, glyph);
} else {
  usage(command ? `error: unknown command "${command}"` : undefined);
}
