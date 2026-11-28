#!/usr/bin/env node
/* WEBAPP CONTRACT TESTS
   Purpose: prove the webapp runs on the shared widget-engine rules and keeps
   no copy of its own.

   The rules live in one file,
   plugins/claude-tui-dashboard/statusline/statusline-contract.js, which both
   the statusline and the webapp load. Its behaviour is tested once, in
   plugins/claude-tui-dashboard/tests/engine.tests.js. This file checks only
   what is webapp-only:
     1. index.html loads the shared file (once, by the right relative path)
     2. index.html does not redefine any of its functions
     3. the page's embedded preview data matches contract/sensors.sample.json

   Run: node tests/webapp/contract.tests.js */
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..", "..");
const HTML_PATH = path.join(ROOT, "webapp", "index.html");
const SHARED_PATH = path.join(ROOT, "plugins", "claude-tui-dashboard", "statusline", "statusline-contract.js");
/* normalise line endings: a Windows checkout (core.autocrlf) brings CRLF */
const html = fs.readFileSync(HTML_PATH, "utf8").replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error("FAIL " + name + "\n  " + String(e.message).split("\n").join("\n  ")); }
}

/* 1. the page loads the shared file exactly once, and the path resolves */
check("index.html loads statusline-contract.js once, by a path that exists", () => {
  const tags = [...html.matchAll(/<script\s+src="([^"]*statusline-contract\.js)"/g)];
  assert.strictEqual(tags.length, 1, "script tags found: " + tags.length);
  const resolved = path.resolve(path.dirname(HTML_PATH), tags[0][1]);
  assert.strictEqual(resolved, SHARED_PATH);
});

/* 2. no second copy: every function and constant the shared file exports
      must be declared only there */
check("index.html redefines none of the shared names", () => {
  const shared = Object.keys(require(SHARED_PATH));
  const redefined = shared.filter(name => new RegExp("(function|const|let|var|class)\\s+" + name + "\\b").test(html));
  assert.deepStrictEqual(redefined, []);
});

/* 3. preview data: the page's SAMPLE_READINGS equals the shared sample file */
check("SAMPLE_READINGS matches sensors.sample.json", () => {
  const m = html.match(/const SAMPLE_READINGS = (\{[\s\S]*?\n\});/);
  assert.ok(m, "SAMPLE_READINGS not found in index.html");
  const file = JSON.parse(fs.readFileSync(path.join(ROOT, "plugins", "claude-tui-dashboard", "contract", "sensors.sample.json"), "utf8"));
  delete file.$comment;
  assert.deepStrictEqual(JSON.parse(m[1]), file);
});

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
