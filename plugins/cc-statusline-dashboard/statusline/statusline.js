#!/usr/bin/env node
// Claude Code status line — reads live session JSON from stdin and prints two
// rows (plus an optional third exported from the dashboard).
// Docs: https://code.claude.com/docs/en/statusline
// Plain CommonJS, no deps. Must always print (and never throw), or the bar hides.
//
// Layout (goal state — the full T0 "wire-up-now" shelf from the possibility-
// space catalog, docs/superpowers/specs/2026-08-01-dashboard-possibility-space.md):
//   line 1:  <model><effort> <ctx gauge> [⚠]   ⌛ <rem5h>% [<reset>] | 📅 <rem7d>% [<reset>] | 🔋 <burn> | Σ <tokens> | ~$<cost> | 💸 <$/h> | ⏱ <wall> | 🔥 <cache>   <session> <±churn> <chips> 👤 🐉 <clock>
//   line 2:  ⑂ <short branch> <git intel>   🔗 PR #<n>   🚦 <ci>   [📒] [📜] [🌳]
//   line 3:  only when ~/.claude/dashboard.json exists — the exported button row
//
// Model = a medal ladder (haiku 🥉 · sonnet 🥈 · opus 🥇 · fable 🏆); the
// ranking reads straight off the glyphs. Σ is the exact token count (raw
// digits, no abbreviation). Branches show as f/first-three-words.
//
// Tooltips: most line-1 segments are OSC 8 links whose URI is designed prose —
// claudectl://tip/<plus-separated-words>. Hovering a link shows the raw URI,
// so the URI *is* the tooltip. Physics: VS Code collapses the hover to the
// word "Link" if the URI carries ANY whitespace, Windows Terminal shows only
// the first 1024 chars, and only bytes 32-126 survive — so tips join words
// with + (never spaces) and '%' travels as %25. The handler treats "tip" as a
// no-op; a "/do/<encoded action>" suffix (session chip → copy id) confirms
// then dispatches through the normal allowlist.
//
// T0 boundary (sacred): everything here is payload fields plus cheap local
// reads — state files under ~/.claude/dashboard-state/, the transcript tail,
// .git metadata, one cached `git status`, and a detached `gh` refresh for CI.
// No new handler verbs: every click is tip / copy / open / spawn or https.
// Render cost stays well under CC's 300ms debounce; every sensor swallows
// its own errors — telemetry must never cost the statusline.
//
// Line 2 always carries at least two links — when the session has no worktree
// or PR it pads from repo → issues → cwd fallbacks — plus the emoji controls
// (📒 logs folder · 📜 transcript · 🌳 base branch). Every link is an OSC 8
// hyperlink (Ctrl/Alt+click).
//
// Local paths: on Windows they use the custom claudectl:// scheme. VS Code's
// terminal hijacks file:// links into Quick Open, but it must hand an unknown
// scheme to the OS, where the registered handler (claudectl-handler.ps1,
// installed by claudectl-register.ps1) opens folders in Explorer and reveals
// files. On macOS/Linux no such hijack exists, so plain file:// links are
// emitted and the OS file manager handles them.
//
// Kill switches (env): CC_STATUSLINE_NO_SPAWN=1 disables the detached CI
// refresh child; CC_STATUSLINE_NO_PET=1 hides the session buddy.

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

// --- CI refresh mode ---------------------------------------------------------

// `node statusline.js --ci-refresh <cwd> <pr#> <cacheFile> <lockFile>` is the
// stale-while-revalidate worker: the render path never waits on `gh` — it
// spawns this detached copy and returns stale data immediately (ccstatusline's
// caching playbook). Writes {at, checks|null}; null caches "gh unavailable or
// failed" so renders don't respawn a doomed child every tick.
if (process.argv[2] === "--ci-refresh") {
  const [, , , ciCwd, prNumber, cacheFile, lockFile] = process.argv;
  try {
    let checks = null;
    const r = cp.spawnSync("gh", ["pr", "checks", String(prNumber), "--json", "bucket"], {
      cwd: ciCwd || undefined,
      encoding: "utf8",
      timeout: 20000,
      windowsHide: true,
    });
    if (!r.error && r.status === 0 && r.stdout) {
      try {
        const arr = JSON.parse(r.stdout);
        if (Array.isArray(arr)) {
          const c = { pass: 0, fail: 0, pending: 0, total: 0 };
          for (const it of arr) {
            const b = String(it?.bucket || "").toLowerCase();
            if (b === "pass" || b === "skipping") c.pass++;
            else if (b === "fail" || b === "cancel") c.fail++;
            else c.pending++;
            c.total++;
          }
          checks = c;
        }
      } catch {}
    }
    try {
      fs.writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), checks }));
    } catch {}
  } catch {
  } finally {
    try {
      fs.unlinkSync(lockFile);
    } catch {}
  }
  process.exit(0);
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let line = "status";
  try {
    line = render(JSON.parse(raw), raw);
  } catch {
    // Leave the fallback; never throw out of the status command.
  }
  process.stdout.write(line + "\n");
});

// --- glyph scales (swap any of these in one place) --------------------------

// Model tier, least → most capable. A podium/medal ladder: the emojis form a
// self-ordering ranking (bronze → silver → gold → trophy), so the difference
// between them *is* the relationship — no legend needed. Chosen to stay clear
// of the circle ramp used for effort so the two badges never blur together.
const MODEL_ICON = { haiku: "🥉", sonnet: "🥈", opus: "🥇", fable: "🏆" };
// Unknown/future model: a generic medal — "a ranked model, tier unclassified".
const MODEL_FALLBACK = "🎖️";

// Reasoning effort, mirroring the model-picker UI: empty → half → full →
// double → star.
const EFFORT_ICON = {
  low: "○",
  medium: "◐",
  high: "●",
  xhigh: "◉", // ultracode reports as xhigh
  max: "★",
};
const EFFORT_FALLBACK = "·";

// Context fill, 0→100% in five steps. A rising bar reads as "filling up"
// without a legend, and the block characters stay one cell wide everywhere.
const GAUGE = ["▁", "▃", "▅", "▇", "█"];

// Session buddy, a growth ladder over cumulative session activity (#45596
// "Bring Back Buddy", the glyph state-machine version). Thresholds are score
// ceilings over lines-touched + minutes-alive + ktokens-fed. The mood face
// rides in the tooltip as ASCII kaomoji, because the URI channel only carries
// bytes 32-126 — the emoji holds the emotion, the tooltip holds the vitals.
const PET_STAGES = [
  [5, "🥚"],
  [25, "🐣"],
  [75, "🐥"],
  [200, "🦕"],
  [Infinity, "🐉"],
];

function modelIcon(model) {
  const s = `${model?.id || ""} ${model?.display_name || ""}`.toLowerCase();
  for (const key of ["fable", "opus", "sonnet", "haiku"]) {
    if (s.includes(key)) return MODEL_ICON[key];
  }
  return MODEL_FALLBACK;
}

// --- SGR color helpers -------------------------------------------------------

// Foreground-only coloring (39 restores the default fg without touching other
// attributes) plus dim. Threshold coloring is per-segment: each meter picks
// green/yellow/red from its own semantics, so color is never decorative —
// every hue is a reading.
const C = { red: "31", green: "32", yellow: "33", magenta: "35", cyan: "36" };
const col = (c, s) => `\x1b[${c}m${s}\x1b[39m`;
const dim = (s) => `\x1b[2m${s}\x1b[22m`;

// Dim separator between line-1 meters: quieter than the old "  |  " so the
// data carries the color and the plumbing recedes — and two cells narrower,
// which the denser bar needs.
const SEP = " \x1b[2m|\x1b[22m ";

// --- clickable links (OSC 8) ------------------------------------------------

// Ctrl/Cmd/Alt+click opens the URL in a hyperlink-aware terminal (Windows
// Terminal, VS Code, iTerm2, WezTerm). ST ("\x1b\\") terminators parse more
// reliably through ConPTY than BEL.
const ST = "\x1b\\";

// Bare envelope: the text keeps whatever styling it already carries. Tip links
// use this so a hover affordance never repaints its segment as "clickable".
function linkWrap(url, text) {
  return `\x1b]8;;${url}${ST}${text}\x1b]8;;${ST}`;
}

// A visibly clickable link: underlined + cyan so it reads as actionable;
// 24;39 restores just underline/color, not all SGR.
function osc8(url, text) {
  return linkWrap(url, `\x1b[4;36m${text}\x1b[24;39m`);
}

// A link dressed as a button: dim brackets around the clickable label.
function button(url, text) {
  return `\x1b[2m[\x1b[22m${osc8(url, text)}\x1b[2m]\x1b[22m`;
}

// --- tooltips (claudectl://tip/) --------------------------------------------

// One tooltip word: '%' escaped first so exact percentages read back, every
// whitespace run collapsed to a single +, anything outside printable ASCII
// dropped (raw spaces or control bytes would collapse the hover to "Link").
function tipText(s) {
  return String(s)
    .replace(/%/g, "%25")
    .replace(/\s+/g, "+")
    .replace(/[^\x21-\x7E]/g, "");
}

// Designed prose → URI. Windows Terminal truncates the hover at 1024 chars and
// the schema caps tooltips at 1000, so the joined prose is clipped to match.
function tipUrl(parts) {
  return "claudectl://tip/" + parts.map(tipText).filter(Boolean).join("+").slice(0, 1000);
}

// Wrap a segment so hovering it reveals the prose. Display text unchanged.
function tip(parts, text) {
  return linkWrap(tipUrl(parts), text);
}

// --- state files (~/.claude/dashboard-state/) --------------------------------

// The statusline's only scratch surface: tiny JSON files for burn history,
// git/CI/account caches and the staleness meta. Reads return null on any
// problem, writes are fire-and-forget — a broken state dir degrades features,
// never the bar.
const stateDir = () => path.join(os.homedir(), ".claude", "dashboard-state");
const safeFile = (s) => String(s).replace(/[^\w.-]/g, "_");

function readState(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir(), name), "utf8"));
  } catch {
    return null;
  }
}

function writeState(name, obj) {
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(path.join(stateDir(), name), JSON.stringify(obj));
  } catch {}
}

// djb2-xor over a string → 7 base36 chars. Cache keys only, not cryptography.
function hash8(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(7, "0").slice(0, 7);
}

// --- rate-limit windows -----------------------------------------------------

const pad2 = (n) => String(n).padStart(2, "0");
const hm = (dt) => `${dt.getHours()}:${pad2(dt.getMinutes())}`;          // 15:20
const mdhm = (dt) => `${dt.getMonth() + 1}/${dt.getDate()} ${hm(dt)}`;   // 7/11 4:37

// One window → "<icon> <remaining>% [<reset>]". Remaining = 100 − consumed,
// colored by runway (≤20 red · ≤45 yellow · else green) so the number reads
// as fuel, not trivia; the reset stamp is dimmed to plumbing. The hover
// carries the exact (unrounded) consumed percentage:
// "5h+23.4%25+resets+15:20+remaining+77%25".
function windowSegment(icon, label, win, fmt) {
  if (!win || win.used_percentage == null) return null;
  const rem = Math.max(0, 100 - Math.round(win.used_percentage));
  let reset = "";
  let stamp = null;
  if (win.resets_at != null) {
    stamp = fmt(new Date(win.resets_at * 1000));
    reset = dim(` [${stamp}]`);
  }
  const parts = [label, `${win.used_percentage}%`];
  if (stamp) parts.push("resets", stamp);
  parts.push("remaining", `${rem}%`);
  const color = rem <= 20 ? C.red : rem <= 45 ? C.yellow : C.green;
  return tip(parts, `${icon} ${col(color, `${rem}%`)}${reset}`);
}

function usageLine(rl) {
  if (!rl) return "usage n/a";
  const parts = [];
  const five = windowSegment("⌛", "5h", rl.five_hour, hm);
  const seven = windowSegment("📅", "7d", rl.seven_day, mdhm);
  if (five) parts.push(five);
  if (seven) parts.push(seven);
  // Any future window (e.g. a model-specific cap) renders generically by key.
  for (const key of Object.keys(rl)) {
    if (key === "five_hour" || key === "seven_day") continue;
    const seg = windowSegment(key, key, rl[key], mdhm);
    if (seg) parts.push(seg);
  }
  return parts.length ? parts.join(SEP) : "usage n/a";
}

// --- session token total -----------------------------------------------------

// Full fidelity — the exact count as raw digits, never abbreviated or grouped:
// 950 → "950", 162_000 → "162000", 1_234_567 → "1234567". Only the Σ prefix,
// no separators or unit suffixes. The hover breaks the current turn down by
// stream — in/out/cache-read/cache-write — plus the cache hit rate, because
// cache_creation is where cost inflation hides (#46917).
function tokenSegment(cw) {
  const total = (cw?.total_input_tokens || 0) + (cw?.total_output_tokens || 0);
  if (total <= 0) return null;
  const u = cw?.current_usage || {};
  const parts = [
    "in", u.input_tokens || 0,
    "out", u.output_tokens || 0,
    "cache-r", u.cache_read_input_tokens || 0,
    "cache-w", u.cache_creation_input_tokens || 0,
  ];
  const inflow =
    (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  if (inflow > 0 && (u.cache_read_input_tokens || 0) > 0) {
    parts.push("cache-hit", `${((u.cache_read_input_tokens / inflow) * 100).toFixed(1)}%`);
  }
  return tip(parts, `Σ ${total}`);
}

// --- context gauge -----------------------------------------------------------

// "▅ 42%" — how full the context window is. Hidden at zero/absent (no noise at
// session start). The displayed number stays the payload's own percentage
// (matching CC's /context), but the *color* is driven by the honest
// autocompact-aware "usable %" — used tokens over (window − 33k reserve) — so
// the gauge goes yellow/red before autocompact actually looms, not after.
// Hover: absolute used/size, both percentages, and the usable math.
const AUTOCOMPACT_RESERVE = 33000;

function gaugeSegment(cw) {
  const pct = Number(cw?.used_percentage);
  if (!pct || pct < 0) return null;
  const glyph = GAUGE[Math.max(0, Math.min(GAUGE.length - 1, Math.floor(pct / 20)))];
  const size = Number(cw?.context_window_size) || 0;
  const rem = cw?.remaining_percentage != null ? cw.remaining_percentage : Math.max(0, 100 - pct);
  const usedTok = size > 0 ? Math.round((size * pct) / 100) : 0;
  const usableSize = size > AUTOCOMPACT_RESERVE ? size - AUTOCOMPACT_RESERVE : 0;
  const usablePct = usableSize ? Math.min(100, (usedTok / usableSize) * 100) : pct;
  const parts = ["ctx"];
  if (size > 0) parts.push(`${usedTok}/${size}`);
  parts.push("used", `${pct}%`);
  if (usableSize) {
    parts.push("usable", `${usablePct.toFixed(1)}%`, "of", `${usableSize}`, "(autocompact-buffer-33k)");
  }
  parts.push("remaining", `${rem}%`);
  const color = usablePct >= 90 ? C.red : usablePct >= 70 ? C.yellow : C.green;
  return tip(parts, col(color, `${glyph} ${Math.round(pct)}%`));
}

// --- session cost ------------------------------------------------------------

function fmtDur(ms) {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (s <= 0) return "0s";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h${m}m`;
  if (m) return `${m}m${s % 60}s`;
  return `${s % 60}s`;
}

// "~$3.42" — the tilde flags it as an estimate, which the hover repeats
// explicitly along with wall-clock vs time actually spent inside the API.
function costSegment(cost) {
  const usd = Number(cost?.total_cost_usd);
  if (!usd || usd <= 0) return null;
  return tip(
    [
      "estimated", `$${usd.toFixed(2)}`,
      "wall", fmtDur(cost?.total_duration_ms),
      "api", fmtDur(cost?.total_api_duration_ms),
    ],
    `~$${usd.toFixed(2)}`,
  );
}

// --- spend rate (💸) ---------------------------------------------------------

// The money twin of 🔋: session dollars per hour, projected linearly. Only
// rendered once the session is ≥10 minutes old — earlier rates are noise.
// Colors: ≥$6/h red · ≥$2.5/h yellow · else green.
function spendRateSegment(cost) {
  const usd = Number(cost?.total_cost_usd);
  const wall = Number(cost?.total_duration_ms);
  if (!usd || usd <= 0 || !wall || wall < 600000) return null;
  const rate = usd / (wall / 3600000);
  const txt = rate >= 10 ? `$${rate.toFixed(0)}/h` : `$${rate.toFixed(2)}/h`;
  const color = rate >= 6 ? C.red : rate >= 2.5 ? C.yellow : C.green;
  return tip(
    ["spend-rate", txt, "session", fmtDur(wall), "spent", `$${usd.toFixed(2)}`, "(estimate)"],
    `💸 ${col(color, txt)}`,
  );
}

// --- session clock (⏱) -------------------------------------------------------

// Wall time, with the "thinking ratio" in the hover: how much of the session
// was actually inside the API vs waiting on the human. Hidden for the first
// minute — a 40-second clock is noise.
function clockSegment(cost) {
  const wall = Number(cost?.total_duration_ms);
  if (!wall || wall < 60000) return null;
  const api = Number(cost?.total_api_duration_ms) || 0;
  const share = Math.round((api / wall) * 100);
  return tip(
    ["session", fmtDur(wall), "api", fmtDur(api), "api-share", `${share}%`],
    `⏱ ${fmtDur(wall)}`,
  );
}

// --- cache warmth (🔥/🧊) ----------------------------------------------------

// Prompt-cache countdown, sensed from the transcript tail (claude-powerline's
// method): the last usage block names the TTL tier (ephemeral_1h vs 5m) and
// its timestamp anchors the countdown. Warm = 🔥 with m:ss left (yellow in
// the final minute); expired = a dim 🧊 — the next message pays a fresh cache
// write. Reads only the last 64KB of the transcript; hidden when there's no
// transcript, no usage yet, or the transcript is a day cold (dead session).
function cacheSegment(d) {
  try {
    const tp = d?.transcript_path;
    if (!tp) return null;
    const st = fs.statSync(tp);
    const want = Math.min(st.size, 65536);
    if (want <= 0) return null;
    const buf = Buffer.alloc(want);
    const fd = fs.openSync(tp, "r");
    try {
      fs.readSync(fd, buf, 0, want, st.size - want);
    } finally {
      fs.closeSync(fd);
    }
    const lines = buf.toString("utf8").split("\n");
    let lastTs = null;
    let ttlMs = 5 * 60000;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"usage"')) continue;
      try {
        const e = JSON.parse(lines[i]);
        const u = e?.message?.usage || e?.usage;
        if (!u || !e?.timestamp) continue;
        const ts = Date.parse(e.timestamp);
        if (!ts) continue;
        lastTs = ts;
        const cc = u.cache_creation || {};
        if ((cc.ephemeral_1h_input_tokens || 0) > 0) ttlMs = 3600000;
        break;
      } catch {
        // Torn/partial line mid-write — keep scanning backwards.
      }
    }
    if (lastTs == null) return null;
    const age = Date.now() - lastTs;
    if (age > 86400000) return null;
    const ttlTxt = ttlMs === 3600000 ? "1h" : "5m";
    const left = ttlMs - age;
    if (left <= 0) {
      return tip(
        ["cache", "cold", "TTL", ttlTxt, "expired", hm(new Date(lastTs + ttlMs)), "next-msg-rewrites-cache"],
        dim("🧊"),
      );
    }
    const t = `${Math.floor(left / 60000)}:${pad2(Math.floor((left % 60000) / 1000))}`;
    const color = left < 60000 ? C.yellow : C.green;
    return tip(["cache", "warm", t, "left", "TTL", ttlTxt], `🔥 ${col(color, t)}`);
  } catch {
    return null;
  }
}

// --- 1M-context trap ---------------------------------------------------------

// A [1m] model (or a session already past 200k tokens) burns usage credits far
// faster than the standard window. Yellow ⚠ so it registers before the bill.
function trapSegment(d) {
  const id = String(d?.model?.id || "").toLowerCase();
  if (!id.includes("[1m]") && !d?.exceeds_200k_tokens) return null;
  return tip(
    ["warn", "1M-context-burns-usage-credits-fast", "switch", "via", "/model"],
    "\x1b[33m⚠\x1b[39m",
  );
}

// --- session chip ------------------------------------------------------------

// The session's name (else the id's first 8 chars), tinted by a stable hash of
// the id so the same session always wears the same color across renders and
// panes. Hover carries the full id; a click offers to copy it (tip/do compose:
// the handler confirms, then dispatches claudectl://copy/ via the allowlist).
function sessionChip(d) {
  const sid = d?.session_id;
  if (!sid) return null;
  const s = String(sid);
  const name = d?.session_name || s.slice(0, 8);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  // Map into the 6×6×6 ANSI-256 cube, reflecting away from the near-black
  // corner so every hue stays readable on a dark background.
  let r = h % 6, g = ((h / 6) | 0) % 6, b = ((h / 36) | 0) % 6;
  if (r + g + b < 4) { r = 5 - r; g = 5 - g; b = 5 - b; }
  const c = 16 + 36 * r + 6 * g + b;
  const uri =
    tipUrl(["session", s, "click", "copies", "id"]) +
    "/do/" + encodeURIComponent("claudectl://copy/" + s);
  return linkWrap(uri, `\x1b[38;5;${c}m${name}\x1b[39m`);
}

// --- churn badge (±lines) ----------------------------------------------------

// Lines added/removed this session, green-on-red, smart-hidden at zero so a
// read-only session stays quiet. Hover carries the net.
function churnSegment(cost) {
  const add = Number(cost?.total_lines_added) || 0;
  const rem = Number(cost?.total_lines_removed) || 0;
  if (!add && !rem) return null;
  // Net rides in one "net=+90" token — a bare "+90" word would collide with
  // the tooltip's own + separators and read as "net++90".
  const net = add - rem;
  return tip(
    ["lines", "added", add, "removed", rem, `net=${net >= 0 ? "+" : ""}${net}`],
    `${col(C.green, `+${add}`)}${col(C.red, `-${rem}`)}`,
  );
}

// --- small mode chips ---------------------------------------------------------

// Tiny presence indicators, each smart-hidden when its field is absent so the
// quiet path stays quiet: vim mode (colored by mode — INSERT green, VISUAL
// magenta, NORMAL dim), 💭 extended thinking, ⚡ fast mode, 🤖 running agent,
// 🎨 non-default output style, 📂+n added workspace dirs (hover lists them).
function smallChips(d) {
  const chips = [];
  if (d?.vim?.mode) {
    const mode = String(d.vim.mode).toUpperCase();
    const dress =
      mode === "INSERT" ? col(C.green, mode) : mode === "VISUAL" ? col(C.magenta, mode) : dim(mode);
    chips.push(tip(["vim", mode], dress));
  }
  if (d?.thinking?.enabled) chips.push(tip(["thinking", "enabled"], "💭"));
  if (d?.fast_mode) chips.push(tip(["fast-mode", "on"], "⚡"));
  if (d?.agent?.name) {
    chips.push(tip(["agent", d.agent.name], `🤖 ${String(d.agent.name).slice(0, 12)}`));
  }
  const style = d?.output_style?.name;
  if (style && style !== "default") chips.push(tip(["output-style", style], `🎨 ${style}`));
  const dirs = d?.workspace?.added_dirs;
  if (Array.isArray(dirs) && dirs.length) {
    chips.push(tip(["added-dirs", ...dirs], `📂+${dirs.length}`));
  }
  return chips;
}

// --- account chip (👤) -------------------------------------------------------

// Which account is this terminal burning quota on (#20131)? Best-effort read
// of CC's own config (~/.claude.json — version-fragile by nature), cached six
// hours in the state dir because that file can be megabytes. Glyph-only in
// the bar; the identity lives in the hover. Hidden when unknown.
function accountChip() {
  try {
    let acct = readState("account.json");
    if (!acct || Date.now() - (acct.at || 0) > 21600000) {
      let email = null;
      let org = null;
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude.json"), "utf8"));
        email = cfg?.oauthAccount?.emailAddress || null;
        org = cfg?.oauthAccount?.organizationName || null;
      } catch {}
      acct = { at: Date.now(), email, org };
      writeState("account.json", acct);
    }
    if (!acct.email) return null;
    return tip(["account", acct.email, acct.org || ""], "👤");
  } catch {
    return null;
  }
}

// --- session buddy (🥚→🐉) ---------------------------------------------------

// The affective companion (#45596, ~2,056 reactions): a creature that grows
// with real session activity — lines touched + minutes alive + ktokens fed —
// and whose *mood* reads the same vitals the meters show (context pressure,
// rate-limit runway). Pure glyph state-machine, zero cost, and honest: a
// frazzled dragon means your context and quota really are under pressure.
// CC_STATUSLINE_NO_PET=1 for minimalists.
function petSegment(d) {
  try {
    if (process.env.CC_STATUSLINE_NO_PET) return null;
    const cost = d?.cost || {};
    const cw = d?.context_window || {};
    const lines = (Number(cost.total_lines_added) || 0) + (Number(cost.total_lines_removed) || 0);
    const mins = (Number(cost.total_duration_ms) || 0) / 60000;
    const ktok = ((cw.total_input_tokens || 0) + (cw.total_output_tokens || 0)) / 1000;
    const score = lines + mins + ktok;
    if (score <= 0) return null;
    let lvl = PET_STAGES.length;
    let glyph = PET_STAGES[PET_STAGES.length - 1][1];
    for (let i = 0; i < PET_STAGES.length; i++) {
      if (score < PET_STAGES[i][0]) {
        lvl = i + 1;
        glyph = PET_STAGES[i][1];
        break;
      }
    }
    const pct = Number(cw.used_percentage) || 0;
    const rl5 = d?.rate_limits?.five_hour?.used_percentage;
    const rem5 = rl5 != null ? 100 - rl5 : null;
    let mood = "cozy";
    let face = "(^-^)";
    if (pct >= 80 || (rem5 != null && rem5 <= 15)) {
      mood = "frazzled";
      face = "(x_x)";
    } else if (pct >= 60 || (rem5 != null && rem5 <= 35)) {
      mood = "worried";
      face = "(o_o;)";
    } else if (lines > 0) {
      mood = "busy";
      face = "(>w<)";
    }
    return tip(
      [
        "buddy", `Lv.${lvl}`, face, mood,
        "fed", `${Math.round(ktok)}k`, "tokens",
        "alive", fmtDur(cost.total_duration_ms),
        "touched", lines, "lines",
      ],
      glyph,
    );
  } catch {
    return null;
  }
}

// --- staleness clock ---------------------------------------------------------

// "When is this data from?" (#77484) — a dim hh:mm:ss render stamp at the end
// of the bar. Doubles as a stall detector: the payload hash is remembered per
// session, and once the same payload has been re-rendering for >2.5 minutes
// (a long turn — CC freezes the payload mid-turn) the stamp turns yellow with
// a * and the hover says how long it has been frozen.
function staleSegment(d, rawJson) {
  try {
    const now = Date.now();
    let frozenMs = 0;
    const sid = d?.session_id;
    if (sid) {
      const key = `meta-${safeFile(sid)}.json`;
      const h = hash8(String(rawJson));
      const prev = readState(key);
      if (prev && prev.h === h && prev.first) {
        frozenMs = now - prev.first;
      } else {
        writeState(key, { h, first: now });
      }
    }
    const t = new Date(now);
    const stamp = `${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}`;
    const parts = ["rendered", stamp];
    let text = dim(stamp);
    if (frozenMs > 150000) {
      parts.push("payload-frozen", fmtDur(frozenMs), "(long-turn?)");
      text = col(C.yellow, `${stamp}*`);
    }
    return tip(parts, text);
  } catch {
    return null;
  }
}

// --- burn rate (🔋/🪫) --------------------------------------------------------

// Each render appends {t, five_hour_used, seven_day_used} to a per-session
// history file under ~/.claude/dashboard-state/, then projects the 5h window
// linearly from the oldest sample at least a minute back. Rendered only when
// the trend is real: ≥2 samples, ≥60s apart, and rising (a window reset makes
// the delta negative, which hides it until the trend re-establishes). The
// glyph itself carries severity: 🔋 while the window outlasts the projection,
// 🪫 red when the tank runs dry BEFORE the reset stamp — the one state that
// deserves alarm (#16157's exact anxiety). Every fs error is swallowed —
// telemetry must never cost the statusline.
function burnSegment(d) {
  const rl = d?.rate_limits;
  const sid = d?.session_id;
  if (!rl || !sid) return null;
  try {
    const file = safeFile(sid) + ".json";
    let hist = readState(file);
    if (!Array.isArray(hist)) hist = [];
    const cur = {
      t: Date.now(),
      five_hour_used: rl.five_hour?.used_percentage ?? null,
      seven_day_used: rl.seven_day?.used_percentage ?? null,
    };
    hist.push(cur);
    if (hist.length > 50) hist = hist.slice(-50);
    writeState(file, hist);
    if (cur.five_hour_used == null) return null;
    // Oldest usable sample ≥60s back anchors the projection.
    let base = null;
    for (const s of hist) {
      if (s && s.five_hour_used != null && cur.t - s.t >= 60000) { base = s; break; }
    }
    if (!base) return null;
    const delta = cur.five_hour_used - base.five_hour_used;
    if (delta <= 0) return null;
    const rate = delta / ((cur.t - base.t) / 3600000); // % per hour
    const empty = new Date(cur.t + ((100 - cur.five_hour_used) / rate) * 3600000);
    const rateTxt = rate >= 10 ? String(Math.round(rate)) : rate.toFixed(1);
    const resetsAt = rl.five_hour?.resets_at != null ? new Date(rl.five_hour.resets_at * 1000) : null;
    const dryBeforeReset = !!(resetsAt && empty < resetsAt);
    const glyph = dryBeforeReset ? "🪫" : "🔋";
    const color = dryBeforeReset ? C.red : rate >= 15 ? C.yellow : C.green;
    const parts = ["burn", `${rateTxt}%/h`, "5h-empty", `~${hm(empty)}`];
    if (dryBeforeReset && resetsAt) parts.push("RUNS-DRY-BEFORE-RESET", hm(resetsAt));
    if (cur.seven_day_used != null) parts.push("7d", `${cur.seven_day_used}%`, "used");
    parts.push("samples", hist.length);
    return tip(parts, `${glyph} ${col(color, `${rateTxt}%/h`)} empty ~${hm(empty)}`);
  } catch {
    return null;
  }
}

// --- git intel (line 2) -------------------------------------------------------

// The enriched ⑂: ahead/behind, staged/modified/untracked/conflicts, stash
// depth, and in-progress operations (MERGE/REBASE/CHERRY-PICK/BISECT — the
// state nobody else surfaces and the one a glance most wants to catch).
// Cost discipline: one `git --no-optional-locks status --porcelain=v2` cached
// in the state dir, invalidated by .git/HEAD + .git/index mtimes (commit-
// instant) OR a 15s TTL (worktree edits don't touch .git). Operation flags
// and stash depth are raw fs peeks — free every render. Worktree .git files
// (gitdir: pointers) are resolved so this works inside .claude/worktrees/*.
function resolveGitDirs(cwd) {
  try {
    const dotgit = path.join(cwd, ".git");
    const st = fs.statSync(dotgit);
    let gitdir = dotgit;
    if (st.isFile()) {
      const m = fs.readFileSync(dotgit, "utf8").match(/^gitdir:\s*(.+?)\s*$/m);
      if (!m) return null;
      gitdir = path.resolve(cwd, m[1]);
    }
    let commondir = gitdir;
    try {
      const c = fs.readFileSync(path.join(gitdir, "commondir"), "utf8").trim();
      if (c) commondir = path.resolve(gitdir, c);
    } catch {}
    return { gitdir, commondir };
  } catch {
    return null;
  }
}

function parsePorcelainV2(out) {
  const d = { ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicts: 0 };
  for (const ln of String(out).split("\n")) {
    if (ln.startsWith("# branch.ab ")) {
      const m = ln.match(/\+(\d+) -(\d+)/);
      if (m) {
        d.ahead = +m[1];
        d.behind = +m[2];
      }
    } else if (ln.startsWith("1 ") || ln.startsWith("2 ")) {
      const xy = ln.slice(2, 4);
      if (xy[0] !== "." && xy[0] !== " ") d.staged++;
      if (xy[1] !== "." && xy[1] !== " ") d.modified++;
    } else if (ln.startsWith("u ")) {
      d.conflicts++;
    } else if (ln.startsWith("? ")) {
      d.untracked++;
    }
  }
  return d;
}

function gitIntel(cwd) {
  try {
    if (!cwd) return null;
    const g = resolveGitDirs(cwd);
    if (!g) return null;
    const mt = (p) => {
      try {
        return fs.statSync(p).mtimeMs;
      } catch {
        return 0;
      }
    };
    const headM = mt(path.join(g.gitdir, "HEAD"));
    const indexM = mt(path.join(g.gitdir, "index"));
    const key = `git-${hash8(String(cwd))}.json`;
    const cached = readState(key);
    let data = null;
    if (cached && cached.headM === headM && cached.indexM === indexM && Date.now() - cached.at < 15000) {
      data = cached.data;
    } else {
      const r = cp.spawnSync(
        "git",
        ["--no-optional-locks", "status", "--porcelain=v2", "--branch"],
        { cwd, encoding: "utf8", timeout: 1500, windowsHide: true },
      );
      if (!r.error && r.status === 0) {
        data = parsePorcelainV2(r.stdout);
        writeState(key, { at: Date.now(), headM, indexM, data });
      } else if (cached) {
        data = cached.data; // degrade to stale, never to a crash
      }
    }
    if (!data) return null;
    // Operation state + stash depth: free fs peeks, always live.
    const exists = (p) => {
      try {
        fs.statSync(p);
        return true;
      } catch {
        return false;
      }
    };
    const op = exists(path.join(g.gitdir, "MERGE_HEAD"))
      ? "MERGE"
      : exists(path.join(g.gitdir, "rebase-merge")) || exists(path.join(g.gitdir, "rebase-apply"))
        ? "REBASE"
        : exists(path.join(g.gitdir, "CHERRY_PICK_HEAD"))
          ? "CHERRY-PICK"
          : exists(path.join(g.gitdir, "BISECT_LOG"))
            ? "BISECT"
            : null;
    let stash = 0;
    try {
      stash = fs
        .readFileSync(path.join(g.commondir, "logs", "refs", "stash"), "utf8")
        .split("\n")
        .filter(Boolean).length;
    } catch {}
    return { ...data, op, stash };
  } catch {
    return null;
  }
}

// Render intel as compact colored counters. Clean tree = a lone green ✔ so
// "nothing to report" is itself a report. Vocabulary: ↑ahead ↓behind ●staged
// ✚modified …untracked ✖conflicts ⚑stash + red CAPS operation flag.
function gitIntelText(gi) {
  if (!gi) return null;
  const bits = [];
  const parts = ["git"];
  if (gi.ahead) { bits.push(col(C.green, `↑${gi.ahead}`)); parts.push("ahead", gi.ahead); }
  if (gi.behind) { bits.push(col(C.red, `↓${gi.behind}`)); parts.push("behind", gi.behind); }
  if (gi.staged) { bits.push(col(C.green, `●${gi.staged}`)); parts.push("staged", gi.staged); }
  if (gi.modified) { bits.push(col(C.yellow, `✚${gi.modified}`)); parts.push("modified", gi.modified); }
  if (gi.untracked) { bits.push(dim(`…${gi.untracked}`)); parts.push("untracked", gi.untracked); }
  if (gi.conflicts) { bits.push(col(C.red, `✖${gi.conflicts}`)); parts.push("conflicts", gi.conflicts); }
  if (gi.stash) { bits.push(col(C.magenta, `⚑${gi.stash}`)); parts.push("stash", gi.stash); }
  if (gi.op) { bits.push(col(C.red, gi.op)); parts.push(gi.op, "in-progress"); }
  if (!bits.length) return tip(["git", "clean"], col(C.green, "✔"));
  return tip(parts, bits.join(" "));
}

// --- CI status (🚦) -----------------------------------------------------------

// PR check rollup, stale-while-revalidate: the render only ever reads the
// cache; when it's past TTL a detached `--ci-refresh` child re-runs `gh pr
// checks` and rewrites it (a lock file prevents a spawn stampede; a crashed
// child's lock is stolen after 3 minutes). TTLs: 90s while checks are
// pending, 5m once settled, 15m after a gh failure. The label IS the reading
// (passed/total, colored) so nothing is lost to the hover, and the click
// opens the PR's checks page.
function ciSegment(d, cwd) {
  try {
    const pr = d?.pr;
    if (pr?.number == null) return null;
    const key = `ci-${pr.number}-${hash8(String(cwd || ""))}.json`;
    const cached = readState(key);
    const ttl = !cached ? 0 : cached.checks ? (cached.checks.pending > 0 ? 90000 : 300000) : 900000;
    const fresh = cached && Date.now() - (cached.at || 0) < ttl;
    if (!fresh && !process.env.CC_STATUSLINE_NO_SPAWN) {
      const lock = path.join(stateDir(), key + ".lock");
      let locked = false;
      try {
        fs.mkdirSync(stateDir(), { recursive: true });
        fs.writeFileSync(lock, "", { flag: "wx" });
        locked = true;
      } catch {
        try {
          if (Date.now() - fs.statSync(lock).mtimeMs > 180000) {
            fs.writeFileSync(lock, "");
            locked = true;
          }
        } catch {}
      }
      if (locked) {
        try {
          cp.spawn(
            process.execPath,
            [__filename, "--ci-refresh", String(cwd || ""), String(pr.number), path.join(stateDir(), key), lock],
            { detached: true, stdio: "ignore", windowsHide: true },
          ).unref();
        } catch {
          try {
            fs.unlinkSync(lock);
          } catch {}
        }
      }
    }
    const c = cached?.checks;
    if (!c || !c.total) return null;
    const color = c.fail > 0 ? C.red : c.pending > 0 ? C.yellow : C.green;
    const label = `🚦 ${col(color, `${c.pass}/${c.total}`)}`;
    const checksUrl = pr.url ? String(pr.url).replace(/\/+$/, "") + "/checks" : null;
    if (checksUrl) return linkWrap(checksUrl, label);
    const parts = ["CI", `${c.pass}/${c.total}`, "passing"];
    if (c.fail) parts.push(c.fail, "failing");
    if (c.pending) parts.push(c.pending, "pending");
    return tip(parts, label);
  } catch {
    return null;
  }
}

// --- dashboard row (line 3) ---------------------------------------------------

// The webapp exports ~/.claude/dashboard.json (v1: {version, row:[…]}); when
// it parses and matches, its row renders as a third line. Buttons compose
// their URI per the shared tip/do contract, dividers render dim, flex items
// become padding — spread across COLUMNS when the terminal reports a width,
// else a fixed three-space gap. Anything invalid (missing file, bad JSON,
// wrong version, junk items) silently yields no row: the statusline must
// never wear its config file's mistakes.
function dashboardRow() {
  try {
    const file =
      process.env.DASHBOARD_JSON || path.join(os.homedir(), ".claude", "dashboard.json");
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!doc || doc.version !== 1 || !Array.isArray(doc.row)) return null;
    const items = [];
    let flexCount = 0;
    let plainLen = 0;
    for (const it of doc.row) {
      if (!it || typeof it !== "object") continue;
      if (it.type === "flex") {
        items.push({ flex: true });
        flexCount++;
        continue;
      }
      const glyph =
        typeof it.glyph === "string" && it.glyph ? it.glyph : it.type === "divider" ? "|" : null;
      if (!glyph) continue;
      if (it.type === "divider") {
        items.push({ text: `\x1b[2m${glyph}\x1b[22m` });
        plainLen += glyph.length;
        continue;
      }
      if (it.type !== "button") continue;
      // URI composition per the shared contract: tip alone, action alone, or
      // tip + "/do/" + encoded action. Tooltips are re-sanitized here so a
      // sloppy exporter can't smuggle a space into the hover.
      const tooltip = typeof it.tooltip === "string" ? tipText(it.tooltip).slice(0, 1000) : "";
      const action = typeof it.action === "string" ? it.action : "";
      let uri = null;
      if (tooltip && action) uri = "claudectl://tip/" + tooltip + "/do/" + encodeURIComponent(action);
      else if (tooltip) uri = "claudectl://tip/" + tooltip;
      else if (action) uri = action;
      items.push({ text: uri ? osc8(uri, glyph) : glyph });
      plainLen += glyph.length;
    }
    if (!items.length) return null;
    let gap = "   ";
    const cols = parseInt(process.env.COLUMNS, 10);
    if (flexCount && cols > 0) {
      const spare = cols - plainLen - (items.length - 1);
      gap = " ".repeat(Math.max(1, Math.floor(spare / flexCount)));
    }
    return items.map((i) => (i.flex ? gap : i.text)).join(" ");
  } catch {
    return null;
  }
}

// --- local-path links ---------------------------------------------------------

// "C:\a b\c" → "C:/a%20b/c". Every segment percent-encoded (spaces, #, etc.
// silently kill clickability in Windows Terminal) but the drive colon kept —
// encoding it also breaks linkification.
// encodeURIComponent throws URIError on unpaired UTF-16 surrogates, which NTFS
// permits in names; without the fallback one such directory anywhere in a path
// would collapse the whole statusline to the "status" fallback. Replacing the
// lone surrogate with U+FFFD yields a dead link for that exotic segment but
// keeps every other segment — and the rest of the bar — intact.
function encodeSegment(seg) {
  try {
    return encodeURIComponent(seg);
  } catch {
    return encodeURIComponent(
      seg.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�"),
    );
  }
}

function encodePath(p) {
  const s = String(p).replace(/\\/g, "/");
  const m = s.match(/^([A-Za-z]:)(.*)$/);
  const drive = m ? m[1] : "";
  const rest = m ? m[2] : s;
  return drive + rest.split("/").map(encodeSegment).join("/");
}

// Link to a local path. Windows: the claudectl:// protocol — an OS-registered
// handler (install: claudectl-register.ps1) that opens folders as an Explorer
// window and reveals files with /select. Unlike file://, VS Code's integrated
// terminal cannot handle this scheme itself, so it hands the click to the OS
// instead of hijacking it into Quick Open. Elsewhere: plain file://, which the
// OS resolves to Finder / the default file manager.
const isWindows = process.platform === "win32";
const localUrl = (p) =>
  isWindows ? "claudectl://open/" + encodePath(p) : "file://" + encodePath(p);

const dirname = (p) => String(p).replace(/[\\/][^\\/]*$/, "");

// Compact a gitflow branch for display: collapse the "type/" prefix to its
// initial (feature/ → f/, hotfix/ → h/, release/ → r/, …) and keep only the
// first three hyphen/underscore-separated words of the rest.
//   feature/statusline-fidelity-emoji-links → f/statusline-fidelity-emoji
//   develop                                  → develop
function shortBranch(b) {
  if (!b) return b;
  const slash = b.indexOf("/");
  let prefix = "";
  let rest = b;
  if (slash !== -1) {
    prefix = b.slice(0, slash).charAt(0) + "/"; // feature → "f/"
    rest = b.slice(slash + 1);
  }
  const words = rest.split(/[-_]/).filter(Boolean).slice(0, 3).join("-");
  return prefix + words;
}

// --- render -----------------------------------------------------------------

// The PR link inherits its review state as color — the same 🔗 reads at a
// glance as merge-ready (green), blocked (red), not-yet-real (dim draft) or
// waiting (yellow). Unknown states keep the standard cyan link dress.
const PR_STYLE = {
  approved: ["4;32", "24;39"],
  changes_requested: ["4;31", "24;39"],
  draft: ["2;4", "22;24"],
  pending: ["4;33", "24;39"],
};

function render(d, rawJson) {
  // Identity cluster: medal+effort badge (hover: model/effort/version), then
  // the context gauge and the 1M-trap warning when they have something to say.
  // A max-effort star glows yellow — the one effort level worth a glance.
  const effortGlyph = EFFORT_ICON[d?.effort?.level] || EFFORT_FALLBACK;
  const badgeText = `${modelIcon(d?.model)}${
    d?.effort?.level === "max" ? col(C.yellow, effortGlyph) : effortGlyph
  }`;
  const badge = tip(
    [
      "model", d?.model?.display_name || d?.model?.id || "unknown",
      "effort", d?.effort?.level || "default",
      d?.version ? `v${d.version}` : "",
    ],
    badgeText,
  );
  const head = [badge, gaugeSegment(d?.context_window), trapSegment(d)]
    .filter(Boolean)
    .join(" ");

  // Metered cluster: rate windows, burn projection, exact tokens, estimated
  // cost, spend rate, session clock, cache warmth — every gauge wears its
  // threshold color, every hover carries the exact numbers.
  const segs = [usageLine(d?.rate_limits)];
  for (const seg of [
    burnSegment(d),
    tokenSegment(d?.context_window),
    costSegment(d?.cost),
    spendRateSegment(d?.cost),
    clockSegment(d?.cost),
    cacheSegment(d),
  ]) {
    if (seg) segs.push(seg);
  }

  // Identity tail: hued session chip, churn badge, tiny mode chips, account,
  // buddy — and the staleness clock dead last: the bar signs its own render.
  const tail = [
    sessionChip(d),
    churnSegment(d?.cost),
    ...smallChips(d),
    accountChip(),
    petSegment(d),
    staleSegment(d, rawJson),
  ]
    .filter(Boolean)
    .join(" ");

  const line1 = [head, segs.join(SEP), tail].filter(Boolean).join("   ");

  // Navigation line: branch/worktree → open the folder via the OS handler
  // (Explorer/Finder in a passthrough terminal); PR → GitHub. The branch link
  // is followed by the git-intel counters (their own hover unit).
  const ws = d?.workspace;
  const wt = d?.worktree;
  const wtPath = wt?.path || ws?.current_dir;
  const branch = wt?.branch || ws?.git_worktree;
  const wtName = wt?.name || ws?.git_worktree;
  const repo = ws?.repo;
  const repoUrl =
    repo?.owner && repo?.name
      ? `https://${repo.host || "github.com"}/${repo.owner}/${repo.name}`
      : null;

  const nav = [];
  const intelCwd = ws?.current_dir || wtPath;
  if (branch && wtPath) {
    const intel = gitIntelText(gitIntel(intelCwd));
    nav.push(
      osc8(localUrl(wtPath), `⑂ ${shortBranch(branch)}`) + (intel ? ` ${intel}` : ""),
    );
  } else if (wtPath) {
    const base = wtPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
    const intel = gitIntelText(gitIntel(intelCwd));
    nav.push(osc8(localUrl(wtPath), `📂 ${base}`) + (intel ? ` ${intel}` : ""));
  }
  if (wt && wtName && branch && wtName !== branch && wtPath) {
    nav.push(osc8(localUrl(wtPath), `📂 ${wtName}`));
  }
  if (d?.pr?.number != null && d?.pr?.url) {
    const label = `🔗 PR #${d.pr.number}`;
    const st = PR_STYLE[d?.pr?.review_state];
    nav.push(
      st
        ? linkWrap(d.pr.url, `\x1b[${st[0]}m${label}\x1b[${st[1]}m`)
        : osc8(d.pr.url, label),
    );
  }
  const ci = ciSegment(d, intelCwd);
  if (ci) nav.push(ci);

  // Pad so line 2 always shows at least two links: repo → issues → cwd.
  const fallbacks = [];
  if (repoUrl) {
    fallbacks.push(osc8(repoUrl, `🌐 ${repo.owner}/${repo.name}`));
    fallbacks.push(osc8(repoUrl + "/issues", "🐛 issues"));
  }
  if (wtPath) fallbacks.push(osc8(localUrl(wtPath), "📁 cwd"));
  while (nav.length < 2 && fallbacks.length) nav.push(fallbacks.shift());

  // Controls, rendered as clickable emojis in dim brackets: [📒] logs folder →
  // Explorer (a ledger/logbook, not a wooden log — kept clear of the 🌳 branch
  // metaphor), [📜] transcript file → OS default app, [🌳] base branch → its
  // GitHub tree (or the trunk folder when there's no repo).
  const buttons = [];
  const tp = d?.transcript_path;
  if (tp) {
    const logsDir = dirname(tp);
    // dirname of a separator-less path returns it unchanged — skip the logs
    // button rather than duplicating the transcript link.
    if (logsDir && logsDir !== tp) buttons.push(button(localUrl(logsDir), "📒"));
    buttons.push(button(localUrl(tp), "📜"));
  }
  const baseBranch = wt?.original_branch || branch;
  if (baseBranch) {
    const basePath = wt?.original_cwd || ws?.project_dir || wtPath;
    const target = repoUrl
      ? `${repoUrl}/tree/${baseBranch.split("/").map(encodeURIComponent).join("/")}`
      : basePath
        ? localUrl(basePath)
        : null;
    if (target) buttons.push(button(target, "🌳"));
  }

  const line2Parts = [...nav];
  if (buttons.length) line2Parts.push(buttons.join(" "));

  const lines = [line1];
  if (line2Parts.length) lines.push(line2Parts.join("   "));
  const row3 = dashboardRow();
  if (row3) lines.push(row3);
  return lines.join("\n");
}
