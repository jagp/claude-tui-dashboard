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
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "claude-tui-dashboard-test-"));

function run(input, extraEnv) {
  return spawnSync(process.execPath, [SCRIPT], {
    input,
    encoding: "utf8",
    // CLAUDE_TUI_DASHBOARD_NO_SPAWN: never let a test fire the detached CI worker.
    env: {
      ...process.env,
      USERPROFILE: fakeHome,
      HOME: fakeHome,
      CLAUDE_TUI_DASHBOARD_NO_SPAWN: "1",
      ...extraEnv,
    },
  });
}

// Mirror of statusline.js hash8 — needed to compose state-file cache keys.
function hash8(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(7, "0").slice(0, 7);
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

// --- goal-state T0 segments ----------------------------------------------------
// (possibility-space catalog §2/§3: churn, clock, spend rate, usable %, colored
// meters, cache warmth, git intel, CI, added dirs, account, buddy, staleness)

// Threshold colors + payload-derived segments, all from the full fixture.
r = run(full);
ok(r.stdout.includes("+120") && r.stdout.includes("-30"), "churn: ±lines badge");
ok(
  r.stdout.includes("claudectl://tip/lines+added+120+removed+30+net=+90"),
  "churn: tooltip with net= token",
);
ok(r.stdout.includes("⏱ 1h30m"), "clock: wall-time display");
ok(
  r.stdout.includes("claudectl://tip/session+1h30m+api+8m3s+api-share+9%25"),
  "clock: api-share tooltip",
);
ok(r.stdout.includes("💸") && r.stdout.includes("$2.28/h"), "spend: $/h projection");
ok(r.stdout.includes("usable+50.7%25"), "gauge: autocompact-aware usable % in tooltip");
ok(r.stdout.includes("\x1b[32m▅ 42%"), "gauge: green under usable threshold");
ok(r.stdout.includes("\x1b[32m77%"), "window: 5h remaining green");
ok(r.stdout.includes("\x1b[33m39%"), "window: 7d remaining yellow");
ok(r.stdout.includes("cache-hit+95.6%25"), "tokens: cache hit rate in tooltip");
ok(r.stdout.includes("🐉"), "pet: dragon stage at high session score");
ok(
  r.stdout.includes("claudectl://tip/buddy+Lv.5+(>w<)+busy+fed+96k+tokens+alive+1h30m"),
  "pet: kaomoji mood tooltip",
);
ok(
  /claudectl:\/\/tip\/rendered\+\d{2}:\d{2}:\d{2}/.test(r.stdout),
  "stale: render stamp tooltip",
);

// Burn glyph swap: projected empty BEFORE the window reset → 🪫 in red.
const drainObj = JSON.parse(full);
drainObj.rate_limits.five_hour.resets_at = Math.floor(Date.now() / 1000) + 4 * 3600;
fs.writeFileSync(
  path.join(stateDir, sid + ".json"),
  JSON.stringify([{ t: Date.now() - 300000, five_hour_used: 20, seven_day_used: 60 }]),
);
r = run(JSON.stringify(drainObj));
ok(r.stdout.includes("🪫"), "burn: empty-battery glyph when dry before reset");
ok(r.stdout.includes("RUNS-DRY-BEFORE-RESET"), "burn: dry-before-reset warning in tooltip");

// Cache warmth: synthetic transcript with a 1-minute-old 5m-TTL usage block.
const warmObj = JSON.parse(full);
const transcript = path.join(fakeHome, "transcript.jsonl");
fs.writeFileSync(
  transcript,
  JSON.stringify({
    timestamp: new Date(Date.now() - 60000).toISOString(),
    message: { usage: { input_tokens: 5, cache_creation: { ephemeral_5m_input_tokens: 100 } } },
  }) + "\n",
);
warmObj.transcript_path = transcript;
r = run(JSON.stringify(warmObj));
ok(r.stdout.includes("🔥"), "cache: warm flame rendered");
ok(/claudectl:\/\/tip\/cache\+warm\+[34]:\d\d\+left\+TTL\+5m/.test(r.stdout), "cache: countdown tooltip");
fs.writeFileSync(
  transcript,
  JSON.stringify({
    timestamp: new Date(Date.now() - 600000).toISOString(),
    message: { usage: { input_tokens: 5, cache_creation: { ephemeral_5m_input_tokens: 100 } } },
  }) + "\n",
);
r = run(JSON.stringify(warmObj));
ok(r.stdout.includes("🧊") && r.stdout.includes("cache+cold"), "cache: expired ice cube");

// Git intel: deterministic scratch repo (1 staged, 1 untracked, then MERGE flag).
const gitOk = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
if (gitOk) {
  const scratch = path.join(fakeHome, "scratch");
  fs.mkdirSync(scratch, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: scratch, encoding: "utf8" });
  fs.writeFileSync(path.join(scratch, "a.txt"), "a\n");
  spawnSync("git", ["add", "a.txt"], { cwd: scratch, encoding: "utf8" });
  fs.writeFileSync(path.join(scratch, "b.txt"), "b\n");
  const gitObj = JSON.parse(full);
  gitObj.workspace.current_dir = scratch;
  delete gitObj.worktree;
  delete gitObj.pr;
  r = run(JSON.stringify(gitObj));
  ok(r.status === 0, "git: exit 0 on scratch repo");
  ok(r.stdout.includes("●1"), "git: staged counter");
  ok(r.stdout.includes("…1"), "git: untracked counter");
  ok(r.stdout.includes("claudectl://tip/git+staged+1+untracked+1"), "git: intel tooltip");
  fs.writeFileSync(path.join(scratch, ".git", "MERGE_HEAD"), "0".repeat(40) + "\n");
  r = run(JSON.stringify(gitObj));
  ok(r.stdout.includes("MERGE"), "git: MERGE-in-progress flag");
  fs.rmSync(path.join(scratch, ".git", "MERGE_HEAD"));
} else {
  console.log("skip git intel tests (git not on PATH)");
}

// CI: canned stale-while-revalidate cache → colored rollup + checks-page link.
const realCwd = JSON.parse(full).workspace.current_dir;
fs.writeFileSync(
  path.join(stateDir, `ci-12-${hash8(realCwd)}.json`),
  JSON.stringify({ at: Date.now(), checks: { pass: 2, fail: 1, pending: 0, total: 3 } }),
);
r = run(full);
ok(r.stdout.includes("🚦"), "ci: traffic light rendered from cache");
ok(r.stdout.includes("\x1b[31m2/3"), "ci: red rollup when a check fails");
ok(
  r.stdout.includes("https://github.com/jared/claude-tui-dashboard/pull/12/checks"),
  "ci: click opens checks page",
);

// Added-dirs chip.
const dirsObj = JSON.parse(full);
dirsObj.workspace.added_dirs = ["C:\\one", "C:\\two"];
r = run(JSON.stringify(dirsObj));
ok(r.stdout.includes("📂+2"), "added-dirs: count chip");

// Account chip: best-effort ~/.claude.json read (cache cleared first — earlier
// renders cached the "no config" answer for six hours).
try {
  fs.rmSync(path.join(stateDir, "account.json"));
} catch {}
fs.writeFileSync(
  path.join(fakeHome, ".claude.json"),
  JSON.stringify({ oauthAccount: { emailAddress: "jared@example.com", organizationName: "Acme" } }),
);
r = run(full);
ok(r.stdout.includes("👤"), "account: chip rendered");
ok(r.stdout.includes("claudectl://tip/account+jared@example.com+Acme"), "account: identity tooltip");

// Pet kill switch for minimalists.
r = run(full, { CLAUDE_TUI_DASHBOARD_NO_PET: "1" });
ok(!r.stdout.includes("🐉"), "pet: hidden under CLAUDE_TUI_DASHBOARD_NO_PET");

// --- tooltip physics: no whitespace in ANY emitted URI -------------------------
// Swept over the everything-on payload: dashboard row + warm cache + added dirs
// + account chip + CI cache all emitting URIs at once.
const denseObj = JSON.parse(full);
denseObj.transcript_path = transcript;
denseObj.workspace.added_dirs = ["C:\\one", "C:\\two"];
r = run(JSON.stringify(denseObj), dashEnv);
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

// --- widget-map.js (add-widget skill tooling) ----------------------------------
// The slot tool and the renderer must speak the same wire format: wire widgets
// with the tool, then render the same file through DASHBOARD_JSON. Contract
// under test: docs/widget-schema.md (exit codes, no-clobber rule, soft cap).
const WIDGET_TOOL = path.join(__dirname, "..", "skills", "add-widget", "scripts", "widget-map.js");
const widgetFile = path.join(fakeHome, "widget-test.json");
const widgetTool = (args) =>
  spawnSync(process.execPath, [WIDGET_TOOL, ...args, "--file", widgetFile], { encoding: "utf8" });

let w = widgetTool(["add", "3", "🔥"]);
ok(w.status === 0, "widget: add to missing file exits 0", w.stderr);
ok(w.stdout.includes("🔥"), "widget: legend shows the wired glyph");
w = widgetTool(["add", "3", "📈"]);
ok(w.status === 3, "widget: occupied slot exits 3 without --force");

// Enrich the occupant, then force: overwrite must be glyph-only.
let widgetDoc = JSON.parse(fs.readFileSync(widgetFile, "utf8"));
widgetDoc.row[0].tooltip = "keep+me";
widgetDoc.row[0].action = "claudectl://open/C:/x";
fs.writeFileSync(widgetFile, JSON.stringify(widgetDoc));
w = widgetTool(["add", "3", "📈", "--force"]);
ok(w.status === 0, "widget: --force exits 0", w.stderr);
widgetDoc = JSON.parse(fs.readFileSync(widgetFile, "utf8"));
ok(
  widgetDoc.row[0].glyph === "📈" &&
    widgetDoc.row[0].tooltip === "keep+me" &&
    widgetDoc.row[0].action === "claudectl://open/C:/x",
  "widget: --force overwrites glyph only — tooltip/action survive",
);

widgetTool(["add", "1", "🧪"]);
widgetDoc = JSON.parse(fs.readFileSync(widgetFile, "utf8"));
ok(
  widgetDoc.row[0].slot === 1 && widgetDoc.row[1].slot === 3,
  "widget: stable-insert keeps slotted items ascending",
);

// End-to-end: the renderer draws the tool-written row as the last line.
r = run(minimal, { DASHBOARD_JSON: widgetFile });
const widgetRow = r.stdout.trim().split("\n").pop();
ok(
  widgetRow.includes("🧪") && widgetRow.includes("📈"),
  "widget: renderer draws the tool-written row",
  widgetRow,
);

// Soft cap warns but never refuses (78 cells; 40 emoji ≈ 80).
w = widgetTool(["add", "5", "🔥".repeat(40)]);
ok(w.status === 0 && w.stdout.includes("OVER SOFT CAP"), "widget: soft cap warns without refusing");

// A corrupt file is refused untouched — exit 2, evidence preserved.
fs.writeFileSync(widgetFile, "{nope");
w = widgetTool(["map"]);
ok(w.status === 2, "widget: corrupt JSON exits 2");
ok(fs.readFileSync(widgetFile, "utf8") === "{nope", "widget: corrupt file left untouched");

// --- wrap up -------------------------------------------------------------------
try {
  fs.rmSync(fakeHome, { recursive: true, force: true });
} catch {}
console.log(failures ? `\n${failures}/${checks} checks FAILED` : `\nall ${checks} checks passed`);
process.exit(failures ? 1 : 0);
