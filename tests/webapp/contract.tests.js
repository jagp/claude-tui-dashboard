#!/usr/bin/env node
/* WEBAPP CONTRACT TESTS
   Purpose: prove the webapp's preview matches what the real statusline prints.

   How: the webapp's pure functions (between `// <contract>` and
   `// </contract>` in webapp/index.html) are run against the shared example
   files in plugins/claude-tui-dashboard/contract/. The statusline engine is
   tested against the same files, so if both pass, they agree.

   Run: node tests/webapp/contract.tests.js */
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..", "..");
const CONTRACT = path.join(ROOT, "plugins", "claude-tui-dashboard", "contract");
const readJson = f => JSON.parse(fs.readFileSync(path.join(CONTRACT, f), "utf8"));

/* normalise line endings: a Windows checkout (core.autocrlf) brings CRLF */
const html = fs.readFileSync(path.join(ROOT, "webapp", "index.html"), "utf8").replace(/\r\n/g, "\n");
const m = html.match(/\/\/ <contract>\n([\s\S]*?)\n\s*\/\/ <\/contract>/);
if (!m) { console.error("FAIL: contract sentinels not found in webapp/index.html"); process.exit(1); }
const NAMES = ["stripAnsi", "cellWidth", "fitText", "layoutRow", "rowWidth", "validateManifest",
  "resolveWidget", "resolveTooltip", "composeUri", "previewLayout", "previewRows",
  "defaultManifest", "toManifest", "fromManifest", "EAST_ASIAN_WIDE", "SAMPLE_READINGS"];
const C = new Function(m[1] + "\n;return {" + NAMES.join(",") + "};")();

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error("FAIL " + name + "\n  " + String(e.message).split("\n").join("\n  ")); }
}
const clone = o => JSON.parse(JSON.stringify(o));

/* 1. cell width */
const cw = readJson("cell-width.vectors.json");
check("EAST_ASIAN_WIDE matches the contract file", () => assert.deepStrictEqual(C.EAST_ASIAN_WIDE, cw.eastAsianWide));
cw.vectors.forEach(([text, want]) =>
  check("cellWidth " + JSON.stringify(text), () => assert.strictEqual(C.cellWidth(text), want)));

/* 2. sample readings */
check("SAMPLE_READINGS matches sensors.sample.json", () => {
  const file = readJson("sensors.sample.json"); delete file.$comment;
  assert.deepStrictEqual(C.SAMPLE_READINGS, file);
});

/* 3. fitText */
[["ab", 4, "ab  "], ["abcdef", 4, "abc…"], ["中文字", 4, "中… "], ["abc", 3, "abc"], ["ab", 1, "…"], ["🔥", 3, "🔥 "]]
  .forEach(([t, w, want]) => check("fitText " + JSON.stringify([t, w]), () => {
    assert.strictEqual(C.fitText(t, w), want);
    assert.strictEqual(C.cellWidth(C.fitText(t, w)), w);
  }));

/* 4. layout vectors */
readJson("layout.vectors.json").cases.forEach(c => {
  check("layout " + c.name, () => assert.deepStrictEqual(C.previewRows(c.manifest, {}, 0), c.expectRows));
  check("layout widths " + c.name, () => {
    const widths = c.manifest.rows.map(r => C.rowWidth(r, c.manifest.widgets.filter(w => w.row === r.row), c.manifest.separators));
    assert.deepStrictEqual(widths, c.expectWidths);
    assert.deepStrictEqual(c.expectRows.map(C.cellWidth), c.expectWidths);
  });
  check("layoutRow " + c.name, () => {
    const rows = c.manifest.rows.map(r => {
      const items = c.manifest.widgets
        .map((def, i) => ({ def, i }))
        .filter(x => x.def.row === r.row)
        .sort((a, b) => a.def.slot - b.def.slot || a.i - b.i)
        .map(x => ({ def: x.def, text: C.fitText(x.def.label, x.def.width) }));
      return C.layoutRow(r, items, c.manifest.separators);
    });
    assert.deepStrictEqual(rows, c.expectRows);
  });
});

/* 5. render vectors */
readJson("render.vectors.json").cases.forEach(c =>
  check("render " + c.name, () => assert.deepStrictEqual(C.previewRows(c.manifest, c.readings, c.now), c.expectRows)));

/* 6. manifest validation */
readJson("manifest.vectors.json").cases.forEach(c =>
  check("validateManifest " + c.name, () => {
    const r = C.validateManifest(c.manifest);
    if (c.reason === null) assert.deepStrictEqual(r, { ok: true });
    else assert.deepStrictEqual(r, { ok: false, reason: c.reason });
  }));

/* 7. model round trip, unknown fields preserved */
check("defaultManifest is valid", () => assert.deepStrictEqual(C.validateManifest(C.defaultManifest()), { ok: true }));
check("round trip keeps unknown fields at every level", () => {
  const doc = C.defaultManifest();
  doc.futureTop = { a: 1 };
  doc.rows[0].futureRow = "x";
  doc.widgets.push({ id: "w1", row: 1, slot: 1, width: 3, glyph: "🔥", futureWidget: [1, 2], meta: { k: "v" } });
  assert.deepStrictEqual(C.toManifest(C.fromManifest(clone(doc))), doc);
});
check("toManifest output is valid", () => {
  const st = C.fromManifest(C.defaultManifest());
  assert.deepStrictEqual(C.validateManifest(C.toManifest(st)), { ok: true });
});
check("fromManifest fills missing separators and placeholder", () => {
  const st = C.fromManifest({ version: 2, rows: [{ row: 1, separator: "space", budget: 78 }], widgets: [] });
  const out = C.toManifest(st);
  assert.deepStrictEqual(out.separators, C.defaultManifest().separators);
  assert.deepStrictEqual(out.placeholder, C.defaultManifest().placeholder);
});

/* 8. tooltip sanitising + URI rule (August 5.3, 5.6) */
check("tooltip words join with +, % becomes %25", () =>
  assert.strictEqual(C.resolveTooltip(["burn", "{burn.rateText}%/h"], { burn: { rateText: "4.2" } }, ["burn"]), "burn+4.2%25/h"));
check("tooltip drops words with an empty placeholder, and whole groups", () =>
  assert.strictEqual(C.resolveTooltip(["git", ["ahead", "{git.ahead}"], ["behind", "{git.behind}"]], { git: { ahead: 2, behind: null } }, ["git"]), "git+ahead+2"));
check("tooltip whitespace -> +, non-ASCII dropped, 1000 clip", () => {
  assert.strictEqual(C.resolveTooltip(["a b", "é!"], {}, []), "a+b+!");
  assert.strictEqual(C.resolveTooltip(["x".repeat(1200)], {}, []).length, 1000);
});
check("composeUri rule", () => {
  assert.strictEqual(C.composeUri("hi", ""), "claudectl://tip/hi");
  assert.strictEqual(C.composeUri("", "https://x"), "https://x");
  assert.strictEqual(C.composeUri("hi", "claudectl://open/C:/x"), "claudectl://tip/hi/do/" + encodeURIComponent("claudectl://open/C:/x"));
});

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
