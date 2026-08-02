#!/usr/bin/env node
// Test harness for statusline.js — spawns the real script with fixture JSON on
// stdin and asserts on the raw escape-laden output. No framework, exit 1 on
// any failure. HOME/USERPROFILE are redirected into a temp dir so renders
// never read the developer's real ~/.claude/dashboard.json or write burn-rate
// state files outside the sandbox.

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SCRIPT = path.join(__dirname, "..", "statusline", "statusline.js");
const FIX = path.join(__dirname, "fixtures");
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-statusline-test-"));

function run(input, extraEnv) {
  return spawnSync(process.execPath, [SCRIPT], {
    input,
    encoding: "utf8",
    env: { ...process.env, USERPROFILE: fakeHome, HOME: fakeHome, ...extraEnv },
  });
}

let checks = 0;
let failures = 0;
function ok(cond, label, detail) {
  checks++;
  if (cond) {
    console.log("ok   " + label);
  } else {
    failures++;
    console.log("FAIL " + label + (detail ? "\n     " + detail : ""));
  }
}

const full = fs.readFileSync(path.join(FIX, "full.json"), "utf8");
const minimal = fs.readFileSync(path.join(FIX, "minimal.json"), "utf8");

// --- full payload: every badge lights up -------------------------------------
let r = run(full);
ok(r.status === 0, "full: exit 0");
ok(r.stdout.trim().length > 0, "full: non-empty output");
ok(r.stdout.includes("🏆"), "full: fable medal");
ok(r.stdout.includes("▅"), "full: context gauge char for 42.3%");
ok(r.stdout.includes("42%"), "full: gauge percentage");
ok(r.stdout.includes("~$3.42"), "full: cost estimate with tilde");
ok(r.stdout.includes("⚠"), "full: 1M-trap warning under [1m] model id");
ok(r.stdout.includes("Σ 96310"), "full: exact token total");
ok(
  r.stdout.includes("claudectl://tip/model+Fable+5+effort+high+v2.0.32"),
  "full: badge tooltip prose",
);
ok(
  r.stdout.includes("claudectl://tip/5h+23.4%25+resets+"),
  "full: 5h window tooltip with %25-escaped exact usage",
);
ok(
  r.stdout.includes("claudectl://tip/in+1200+out+350+cache-r+80210+cache-w+2450"),
  "full: token tooltip from current_usage",
);
ok(
  r.stdout.includes("/do/" + encodeURIComponent("claudectl://copy/0f8a3c21-77de-4b52-9c40-1b2f3d4e5a6b")),
  "full: session chip click-to-copy action",
);
ok(r.stdout.includes("dashboard-possibility"), "full: session name chip");
ok(r.stdout.includes("\x1b[4;32m"), "full: PR link green for approved");
ok(r.stdout.includes("NORMAL"), "full: vim mode chip");
ok(r.stdout.includes("💭"), "full: thinking chip");
ok(r.stdout.includes("⚡"), "full: fast-mode chip");
ok(r.stdout.includes("🤖 reviewer"), "full: agent chip");
ok(r.stdout.includes("🎨 explanatory"), "full: output-style chip");
ok(!r.stdout.includes("🔋"), "full: no burn rate on first sample");

// --- burn rate: seed a 5-minute-old sample, expect a projection ---------------
const sid = JSON.parse(full).session_id;
const stateDir = path.join(fakeHome, ".claude", "dashboard-state");
fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(
  path.join(stateDir, sid + ".json"),
  JSON.stringify([{ t: Date.now() - 300000, five_hour_used: 20, seven_day_used: 60 }]),
);
r = run(full);
ok(r.status === 0, "burn: exit 0");
ok(r.stdout.includes("🔋"), "burn: battery segment rendered");
ok(/%\/h/.test(r.stdout), "burn: rate unit %/h in display");
ok(r.stdout.includes("empty ~"), "burn: empty-at projection");
ok(r.stdout.includes("claudectl://tip/burn+"), "burn: tooltip prose");
const state = JSON.parse(fs.readFileSync(path.join(stateDir, sid + ".json"), "utf8"));
ok(Array.isArray(state) && state.length === 2, "burn: history appended (2 samples)");

// --- burn rate: falling usage (window reset) stays hidden ---------------------
fs.writeFileSync(
  path.join(stateDir, sid + ".json"),
  JSON.stringify([{ t: Date.now() - 300000, five_hour_used: 90, seven_day_used: 60 }]),
);
r = run(full);
ok(r.status === 0 && !r.stdout.includes("🔋"), "burn: hidden when usage fell");

// --- minimal payload: quiet but alive -----------------------------------------
r = run(minimal);
ok(r.status === 0, "minimal: exit 0");
ok(r.stdout.trim().length > 0, "minimal: non-empty output");
ok(r.stdout.includes("usage n/a"), "minimal: usage n/a placeholder");
ok(!r.stdout.includes("~$"), "minimal: no cost badge");
ok(!r.stdout.includes("⚠"), "minimal: no 1M-trap");
ok(r.stdout.includes("min00000"), "minimal: session id prefix chip");

// --- garbage stdin: never throws, always prints -------------------------------
for (const garbage of ["{", "", "null", "[1,2", "\x00\x01"]) {
  r = run(garbage);
  ok(
    r.status === 0 && r.stdout.trim().length > 0,
    `garbage ${JSON.stringify(garbage)}: exit 0 + output`,
    `status=${r.status} stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`,
  );
}

// --- dashboard.json row 3 ------------------------------------------------------
const dashEnv = { DASHBOARD_JSON: path.join(FIX, "dashboard-sample.json") };
r = run(full, dashEnv);
ok(r.status === 0, "dash: exit 0");
ok(r.stdout.includes("🔥"), "dash: button glyph on row 3");
ok(r.stdout.includes("📈"), "dash: second button glyph");
ok(
  r.stdout.includes(
    "claudectl://tip/cache+hot+4:12+left/do/" +
      encodeURIComponent("claudectl://open/C:/Users/jared"),
  ),
  "dash: tip+do URI composition",
);
ok(r.stdout.includes("claudectl://tip/tokens+today+81k"), "dash: tooltip-only button URI");
ok(r.stdout.split("\n").filter(Boolean).length === 3, "dash: exactly three rows");

// flex spreads across COLUMNS when the terminal reports a width
r = run(full, { ...dashEnv, COLUMNS: "80" });
ok(r.status === 0 && /  {10,}/.test(r.stdout.split("\n")[2] || ""), "dash: flex gap widens under COLUMNS=80");

// invalid file → silently no row 3
const badPath = path.join(fakeHome, "bad.json");
fs.writeFileSync(badPath, "{nope");
r = run(full, { DASHBOARD_JSON: badPath });
ok(r.status === 0 && !r.stdout.includes("🔥"), "dash-invalid: bad JSON silently skipped");
fs.writeFileSync(badPath, JSON.stringify({ version: 2, row: [] }));
r = run(full, { DASHBOARD_JSON: badPath });
ok(r.status === 0 && r.stdout.split("\n").filter(Boolean).length === 2, "dash-invalid: wrong version skipped");

// --- tooltip physics: no whitespace in ANY emitted URI -------------------------
r = run(full, dashEnv);
const uris = [...r.stdout.matchAll(/\x1b\]8;;([^\x07\x1b]*)/g)].map((m) => m[1]).filter(Boolean);
ok(uris.length > 0, "uris: links present");
ok(
  uris.every((u) => !/\s/.test(u)),
  "uris: no whitespace in any link URI",
  uris.filter((u) => /\s/.test(u)).join(" | "),
);
ok(
  uris.every((u) => [...u].every((ch) => ch.charCodeAt(0) >= 33 && ch.charCodeAt(0) <= 126)),
  "uris: printable ASCII only",
);

// --- wrap up -------------------------------------------------------------------
try {
  fs.rmSync(fakeHome, { recursive: true, force: true });
} catch {}
console.log(failures ? `\n${failures}/${checks} checks FAILED` : `\nall ${checks} checks passed`);
process.exit(failures ? 1 : 0);
