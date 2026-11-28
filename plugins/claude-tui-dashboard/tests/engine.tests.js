#!/usr/bin/env node
/* ENGINE CONTRACT TESTS
   Purpose: prove the widget-engine rules print what the shared example files
   in ../contract/ say they must.

   The rules live in one file, ../statusline/statusline-contract.js. The
   statusline require()s it and the webapp loads it with a <script> tag, so
   these checks cover both. (tests/webapp/contract.tests.js only checks what is
   webapp-only: that the page loads this file and keeps no copy of its own.)

   Run: node plugins/claude-tui-dashboard/tests/engine.tests.js */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { spawnSync } = require("child_process");

/* statusline.js only reads stdin when run as a program; required, it hands
   over the contract functions it runs on (see the end of statusline.js). */
const STATUSLINE = path.join(__dirname, "..", "statusline", "statusline.js");
const E = require(STATUSLINE);

const CONTRACT = path.join(__dirname, "..", "contract");
const readJson = file => JSON.parse(fs.readFileSync(path.join(CONTRACT, file), "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error("FAIL " + name + "\n  " + String(e.message).split("\n").join("\n  ")); }
}

/* 1. cell width: the code's copy of the wide ranges must match the shared
      file (the statusline can't read the JSON at runtime; this keeps the
      copy honest), then every vector. */
const cw = readJson("cell-width.vectors.json");
check("EAST_ASIAN_WIDE matches the contract file", () => assert.deepStrictEqual(E.EAST_ASIAN_WIDE, cw.eastAsianWide));
cw.vectors.forEach(([text, want]) =>
  check("cellWidth " + JSON.stringify(text), () => assert.strictEqual(E.cellWidth(text), want)));

/* 2. stripAnsi: colors (CSI) and OSC 8 links with either terminator go */
check("stripAnsi removes CSI and both OSC 8 terminators", () => {
  assert.strictEqual(E.stripAnsi("\x1b[31mred\x1b[39m"), "red");
  assert.strictEqual(E.stripAnsi("\x1b]8;;https://x\x1b\\link\x1b]8;;\x1b\\"), "link");
  assert.strictEqual(E.stripAnsi("\x1b]8;;https://x\x07link\x1b]8;;\x07"), "link");
});

/* 3. fitText: pad short text, cut long text to width-1 cells plus "…" */
[["ab", 4, "ab  "], ["abcdef", 4, "abc…"], ["中文字", 4, "中… "], ["x", 1, "x"], ["xy", 1, "…"],
 ["abc", 3, "abc"], ["ab", 1, "…"], ["🔥", 3, "🔥 "]]
  .forEach(([text, width, want]) =>
    check("fitText " + JSON.stringify([text, width]), () => assert.strictEqual(E.fitText(text, width), want)));

/* 4. sweep: whatever the text, the result is always exactly `width` cells */
cw.vectors.forEach(([text]) => {
  for (let width = 1; width <= 8; width++)
    check("fitText exact width " + JSON.stringify([text, width]), () =>
      assert.strictEqual(E.cellWidth(E.fitText(E.stripAnsi(text), width)), width));
});

/* 5. layout vectors: rows of static widgets, three ways
      - previewRows on the whole manifest
      - rowWidth from declared widths alone, which must equal the printed width
      - layoutRow fed pre-fitted labels */
readJson("layout.vectors.json").cases.forEach(c => {
  check("layout " + c.name, () => assert.deepStrictEqual(E.previewRows(c.manifest, {}, 0), c.expectRows));
  check("layout widths " + c.name, () => {
    const widths = c.manifest.rows.map(r => E.rowWidth(r, c.manifest.widgets.filter(w => w.row === r.row), c.manifest.separators));
    assert.deepStrictEqual(widths, c.expectWidths);
    assert.deepStrictEqual(c.expectRows.map(E.cellWidth), c.expectWidths);
  });
  check("layoutRow " + c.name, () => {
    const rows = c.manifest.rows.map(r => {
      const items = c.manifest.widgets
        .map((def, i) => ({ def, i }))
        .filter(x => x.def.row === r.row)
        .sort((a, b) => a.def.slot - b.def.slot || a.i - b.i)
        .map(x => ({ def: x.def, text: E.fitText(x.def.label, x.def.width) }));
      return E.layoutRow(r, items, c.manifest.separators);
    });
    assert.deepStrictEqual(rows, c.expectRows);
  });
});

/* 6. render vectors: widgets with sensor readings, placeholders, hiding */
readJson("render.vectors.json").cases.forEach(c =>
  check("render " + c.name, () => assert.deepStrictEqual(E.previewRows(c.manifest, c.readings, c.now), c.expectRows)));

/* 7. manifest validation: valid, or rejected with this exact reason */
readJson("manifest.vectors.json").cases.forEach(c =>
  check("validateManifest " + c.name, () => {
    const result = E.validateManifest(c.manifest);
    if (c.reason === null) assert.deepStrictEqual(result, { ok: true });
    else assert.deepStrictEqual(result, { ok: false, reason: c.reason });
  }));

/* 8. model round trip: the editor's model <-> the file, unknown fields kept */
check("defaultManifest is valid", () => assert.deepStrictEqual(E.validateManifest(E.defaultManifest()), { ok: true }));
check("round trip keeps unknown fields at every level", () => {
  const doc = E.defaultManifest();
  doc.futureTop = { a: 1 };
  doc.rows[0].futureRow = "x";
  doc.widgets.push({ id: "w1", row: 1, slot: 1, width: 3, glyph: "🔥", futureWidget: [1, 2], meta: { k: "v" } });
  assert.deepStrictEqual(E.toManifest(E.fromManifest(clone(doc))), doc);
});
check("toManifest output is valid", () => {
  const state = E.fromManifest(E.defaultManifest());
  assert.deepStrictEqual(E.validateManifest(E.toManifest(state)), { ok: true });
});
check("fromManifest fills missing separators and placeholder", () => {
  const state = E.fromManifest({ version: 2, rows: [{ row: 1, separator: "space", budget: 78 }], widgets: [] });
  const out = E.toManifest(state);
  assert.deepStrictEqual(out.separators, E.defaultManifest().separators);
  assert.deepStrictEqual(out.placeholder, E.defaultManifest().placeholder);
});

/* 9. tooltip sanitising + URI rule (August 5.3, 5.6) */
check("tooltip words join with +, % becomes %25", () =>
  assert.strictEqual(E.resolveTooltip(["burn", "{burn.rateText}%/h"], { burn: { rateText: "4.2" } }, ["burn"]), "burn+4.2%25/h"));
check("tooltip drops words with an empty placeholder, and whole groups", () =>
  assert.strictEqual(E.resolveTooltip(["git", ["ahead", "{git.ahead}"], ["behind", "{git.behind}"]], { git: { ahead: 2, behind: null } }, ["git"]), "git+ahead+2"));
check("tooltip whitespace -> +, non-ASCII dropped, 1000 clip", () => {
  assert.strictEqual(E.resolveTooltip(["a b", "é!"], {}, []), "a+b+!");
  assert.strictEqual(E.resolveTooltip(["x".repeat(1200)], {}, []).length, 1000);
});
check("composeUri rule", () => {
  assert.strictEqual(E.composeUri("hi", ""), "claudectl://tip/hi");
  assert.strictEqual(E.composeUri("", "https://x"), "https://x");
  assert.strictEqual(E.composeUri("hi", "claudectl://open/C:/x"), "claudectl://tip/hi/do/" + encodeURIComponent("claudectl://open/C:/x"));
});

/* 10. never throw: deployed without statusline-contract.js beside it, the
       statusline still prints its bar and exits 0 */
check("statusline prints without statusline-contract.js", () => {
  const lonely = fs.mkdtempSync(path.join(os.tmpdir(), "statusline-alone-"));
  try {
    fs.copyFileSync(STATUSLINE, path.join(lonely, "statusline.js"));
    const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "minimal.json"), "utf8");
    const run = spawnSync(process.execPath, [path.join(lonely, "statusline.js")], {
      input: fixture, encoding: "utf8", env: { ...process.env, HOME: lonely, USERPROFILE: lonely, CLAUDE_TUI_DASHBOARD_NO_SPAWN: "1" }
    });
    assert.strictEqual(run.status, 0, run.stderr);
    assert.ok(run.stdout.trim().length > 0 && run.stdout.trim() !== "status", "printed: " + JSON.stringify(run.stdout));
  } finally {
    fs.rmSync(lonely, { recursive: true, force: true });
  }
});

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
