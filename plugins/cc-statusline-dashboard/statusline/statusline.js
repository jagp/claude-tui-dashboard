#!/usr/bin/env node
// Claude Code status line — reads live session JSON from stdin and prints two
// rows (plus an optional third exported from the dashboard).
// Docs: https://code.claude.com/docs/en/statusline
// Plain CommonJS, no deps. Must always print (and never throw), or the bar hides.
//
// Layout:
//   line 1:  <model><effort> <ctx gauge> [⚠]   ⌛ <rem5h>% [<reset>]  |  📅 <rem7d>% [<reset>]  |  Σ <tokens>  |  ~$<cost>  |  🔋 <burn>   <session> <chips>
//   line 2:  ⑂ <short branch>   🔗 PR #<n>   [📒] [📜] [🌳]
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

const fs = require("fs");
const os = require("os");
const path = require("path");

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let line = "status";
  try {
    line = render(JSON.parse(raw));
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

function modelIcon(model) {
  const s = `${model?.id || ""} ${model?.display_name || ""}`.toLowerCase();
  for (const key of ["fable", "opus", "sonnet", "haiku"]) {
    if (s.includes(key)) return MODEL_ICON[key];
  }
  return MODEL_FALLBACK;
}

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

// --- rate-limit windows -----------------------------------------------------

const pad2 = (n) => String(n).padStart(2, "0");
const hm = (dt) => `${dt.getHours()}:${pad2(dt.getMinutes())}`;          // 15:20
const mdhm = (dt) => `${dt.getMonth() + 1}/${dt.getDate()} ${hm(dt)}`;   // 7/11 4:37

// One window → "<icon> <remaining>% [<reset>]". Remaining = 100 − consumed.
// No countdown — just the absolute reset stamp. The hover carries the exact
// (undrounded) consumed percentage: "5h+23.4%25+resets+15:20".
function windowSegment(icon, label, win, fmt) {
  if (!win || win.used_percentage == null) return null;
  const rem = Math.max(0, 100 - Math.round(win.used_percentage));
  let reset = "";
  let stamp = null;
  if (win.resets_at != null) {
    stamp = fmt(new Date(win.resets_at * 1000));
    reset = ` [${stamp}]`;
  }
  const parts = [label, `${win.used_percentage}%`];
  if (stamp) parts.push("resets", stamp);
  return tip(parts, `${icon} ${rem}%${reset}`);
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
  return parts.length ? parts.join("  |  ") : "usage n/a";
}

// --- session token total -----------------------------------------------------

// Full fidelity — the exact count as raw digits, never abbreviated or grouped:
// 950 → "950", 162_000 → "162000", 1_234_567 → "1234567". Only the Σ prefix,
// no separators or unit suffixes. The hover breaks the current turn down by
// stream: in/out/cache-read/cache-write.
function tokenSegment(cw) {
  const total = (cw?.total_input_tokens || 0) + (cw?.total_output_tokens || 0);
  if (total <= 0) return null;
  const u = cw?.current_usage || {};
  return tip(
    [
      "in", u.input_tokens || 0,
      "out", u.output_tokens || 0,
      "cache-r", u.cache_read_input_tokens || 0,
      "cache-w", u.cache_creation_input_tokens || 0,
    ],
    `Σ ${total}`,
  );
}

// --- context gauge -----------------------------------------------------------

// "▅ 42%" — how full the context window is. Hidden at zero/absent (no noise
// at session start). Hover: absolute used/size plus both percentages.
function gaugeSegment(cw) {
  const pct = Number(cw?.used_percentage);
  if (!pct || pct < 0) return null;
  const glyph = GAUGE[Math.max(0, Math.min(GAUGE.length - 1, Math.floor(pct / 20)))];
  const size = Number(cw?.context_window_size) || 0;
  const rem = cw?.remaining_percentage != null ? cw.remaining_percentage : Math.max(0, 100 - pct);
  const parts = ["ctx"];
  if (size > 0) parts.push(`${Math.round((size * pct) / 100)}/${size}`);
  parts.push("used", `${pct}%`, "remaining", `${rem}%`);
  return tip(parts, `${glyph} ${Math.round(pct)}%`);
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

// --- small mode chips ---------------------------------------------------------

// Tiny presence indicators, each smart-hidden when its field is absent so the
// quiet path stays quiet: vim mode (dim caps), 💭 extended thinking, ⚡ fast
// mode, 🤖 running agent, 🎨 non-default output style.
function smallChips(d) {
  const chips = [];
  if (d?.vim?.mode) {
    const mode = String(d.vim.mode).toUpperCase();
    chips.push(tip(["vim", mode], `\x1b[2m${mode}\x1b[22m`));
  }
  if (d?.thinking?.enabled) chips.push(tip(["thinking", "enabled"], "💭"));
  if (d?.fast_mode) chips.push(tip(["fast-mode", "on"], "⚡"));
  if (d?.agent?.name) chips.push(tip(["agent", d.agent.name], `🤖 ${d.agent.name}`));
  const style = d?.output_style?.name;
  if (style && style !== "default") chips.push(tip(["output-style", style], `🎨 ${style}`));
  return chips;
}

// --- burn rate (🔋) -----------------------------------------------------------

// Each render appends {t, five_hour_used, seven_day_used} to a per-session
// history file under ~/.claude/dashboard-state/, then projects the 5h window
// linearly from the oldest sample at least a minute back. Rendered only when
// the trend is real: ≥2 samples, ≥60s apart, and rising (a window reset makes
// the delta negative, which hides it until the trend re-establishes). Every fs
// error is swallowed — telemetry must never cost the statusline.
function burnSegment(d) {
  const rl = d?.rate_limits;
  const sid = d?.session_id;
  if (!rl || !sid) return null;
  try {
    const dir = path.join(os.homedir(), ".claude", "dashboard-state");
    const file = path.join(dir, String(sid).replace(/[^\w.-]/g, "_") + ".json");
    let hist = [];
    try {
      hist = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!Array.isArray(hist)) hist = [];
    } catch {}
    const cur = {
      t: Date.now(),
      five_hour_used: rl.five_hour?.used_percentage ?? null,
      seven_day_used: rl.seven_day?.used_percentage ?? null,
    };
    hist.push(cur);
    if (hist.length > 50) hist = hist.slice(-50);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(hist));
    } catch {}
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
    return tip(
      ["burn", `${rateTxt}%/h`, "5h-empty", `~${hm(empty)}`, "samples", hist.length],
      `🔋 ${rateTxt}%/h empty ~${hm(empty)}`,
    );
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

function render(d) {
  // Identity cluster: medal+effort badge (hover: model/effort/version), then
  // the context gauge and the 1M-trap warning when they have something to say.
  const badgeText = `${modelIcon(d?.model)}${EFFORT_ICON[d?.effort?.level] || EFFORT_FALLBACK}`;
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

  // Metered cluster: rate windows, exact tokens, estimated cost, burn rate.
  const segs = [usageLine(d?.rate_limits)];
  const tok = tokenSegment(d?.context_window);
  if (tok) segs.push(tok);
  const cost = costSegment(d?.cost);
  if (cost) segs.push(cost);
  const burn = burnSegment(d);
  if (burn) segs.push(burn);

  // Identity tail: hued session chip + tiny mode chips.
  const tail = [sessionChip(d), ...smallChips(d)].filter(Boolean).join(" ");

  const line1 = [head, segs.join("  |  "), tail].filter(Boolean).join("   ");

  // Navigation line: branch/worktree → open the folder via the OS handler
  // (Explorer/Finder in a passthrough terminal); PR → GitHub.
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
  if (branch && wtPath) {
    nav.push(osc8(localUrl(wtPath), `⑂ ${shortBranch(branch)}`));
  } else if (wtPath) {
    const base = wtPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
    nav.push(osc8(localUrl(wtPath), `📂 ${base}`));
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
