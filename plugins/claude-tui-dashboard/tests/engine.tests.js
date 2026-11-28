#!/usr/bin/env node
/* ENGINE CONTRACT TESTS
   Purpose: prove the statusline engine prints what the shared example files
   in ../contract/ say it must. The webapp is tested against the same files
   (tests/webapp/contract.tests.js), so if both pass, they agree.

   Covered so far: cell width and exact-width fitting (plan Task 2).
   Layout, rendering and manifest checks arrive with Tasks 3-4.

   Run: node plugins/claude-tui-dashboard/tests/engine.tests.js */
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

/* statusline.js only reads stdin when run as a program; required, it just
   hands over its functions (see the module.exports at its end). */
const E = require("../statusline/statusline.js");

const CONTRACT = path.join(__dirname, "..", "contract");
const readJson = file => JSON.parse(fs.readFileSync(path.join(CONTRACT, file), "utf8"));

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error("FAIL " + name + "\n  " + String(e.message).split("\n").join("\n  ")); }
}

/* 1. cell width: the engine's copy of the wide ranges must match the shared
      file (statusline.js deploys as one file, so it can't read the file at
      runtime; this test keeps the copy honest), then every vector. */
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

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
