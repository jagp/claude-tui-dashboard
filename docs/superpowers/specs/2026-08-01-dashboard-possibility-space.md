# Dashboard Possibility Space — the Idea Library

**Date:** 2026-08-01
**Status:** Research catalog (living document)
**Predecessors:** `2026-07-11-claude-dashboard-design.md` (v1 spec), `dashboard-controls-catalog.md`
**Method:** 5-agent parallel research sweep (statusline ecosystem, fleet
dashboards, CC issue tracker, OSC 8 physics, skills marketplaces) + source
reads of microsoft/terminal, microsoft/vscode, xterm.js, and the CC statusline
docs. 97 findings synthesized.

## 0. What this is

A catalog of everything that can be wired into the now-functional statusline
dashboard **without serious changes to the underlying code**, plus every
half-decent idea that is *impossible today* — recorded for posterity so the
upcoming WYSIWYG web app has an eye-catching library to show off.

Organizing principle, per control:

> **glyph** (what you see) → **tooltip** (heads-up info: the OSC 8 URI itself,
> designed as prose) → **click** (a `claudectl://` verb or web URL)

Feasibility tiers used throughout:

- **T0 — wire-up-now**: pure `statusline.js` edits (payload fields we already
  receive but don't render, cheap child-process/file reads).
- **T1 — handler verb**: needs a new verb in the `claudectl://` allowlist.
  Still zero Claude Code core changes.
- **T2 — sensor supplement**: needs a hook or state file written alongside the
  statusline (sanctioned CC user-config surface, ~6 lines of settings.json).
- **T3 — blocked / posterity**: needs CC core changes, a VS Code extension, or
  terminal features that don't exist. Recorded anyway — this is the fun shelf.

**Headline findings:**

1. **The emoji+tooltip+click paradigm is novel.** No surveyed project uses the
   hover-URI as an information channel or renders emoji buttons. Closest prior
   art: CC issue #21586's author wanted a clickable `toclipboard://` session id
   in their statusline (Anthropic fixed the regression that broke it), codachi's
   tamagotchi statusline pet, and claude-code-personalities' kaomoji mood face.
2. **The niche is uncontested and sanctioned.** Anthropic closed "built-in
   rate-limit statusline bars" (#30341) as *not_planned* — third-party
   statuslines are the blessed delivery vehicle. Crystal went commercial
   (Nimbalyst), vibe-kanban is sunsetting, native Agent View (`claude agents`)
   covers the TUI fleet list. Nobody occupies "in-terminal hover+click."
3. **Two working WYSIWYG editors already prove our web-app loop** (Powerline
   Studio, ccstatusline-editor): browser composes → JSON artifact exports →
   dumb script renders. Neither does links, tooltips, or actions — that's our
   territory.

---

## 1. The physics of the tooltip channel

The hover tooltip of an OSC 8 hyperlink **is the raw URI** — there is no
separate tooltip text field anywhere in the protocol. "Emoji holds heads-up
info in the tooltip" therefore means *designing the URL itself as prose*.

### 1.1 Hard limits (confirmed from source + empirical urlmon tests)

| Constraint | Value | Where | Source |
|---|---|---|---|
| Hover display truncation | **1024 chars**, hard cut, no ellipsis | Windows Terminal | `ControlCore.cpp` `HoveredUriText()` |
| Tooltip rendering | **wraps** (~320epx XAML bubble), text **selectable**, appears on plain hover | Windows Terminal | `TermControl.xaml` `LinkTip` |
| Stored URI cap (click payload) | **2 MB** ("like iTerm2"); zero char validation | Windows Terminal | `OutputStateMachineEngine.hpp` `MAX_URL_LENGTH` |
| Display decoding | **none** — raw emitted bytes shown; `%20` shows literally | WT + VS Code | `_hoveredHyperlinkChanged` / `_getLinkHoverString` |
| Raw spaces in URI | **OK in WT** (urlmon-verified, prose renders); **fatal in VS Code** — one space collapses hover to the word "Link" | split | `terminalLinkManager.ts` whitespace regex |
| VS Code hover format | markdown `[uri](uri) (ctrl + click)`, metachars escaped (no injection), no length cap (~10MB xterm.js OSC), wraps in hover widget | VS Code | `_getLinkHoverString` |
| VS Code click path | `URI.parse().toString()` **re-encodes** before ShellExecute → handler must always percent-decode | VS Code | `terminalLinkManager.ts` |
| `id=` grouping | same `id`+URI = **one hover/underline unit**, even non-adjacent, cross-line | WT + xterm.js (confirmed both) | `OscLinkService.ts`, `textBuffer.cpp` |
| `id=` cap | ~250 bytes (VTE) | portability floor | egmontkob gist |
| URI byte range | **32–126** printable ASCII only; newlines impossible — tooltips are ONE logical line | protocol | egmontkob gist |
| Portability floor | 2083-byte URI (VTE/iTerm2-legacy) | if ever beyond WT/VS Code | egmontkob gist |
| Scheme names | RFC 3986 `ALPHA *(ALPHA/DIGIT/+/-/.)`; **single-letter schemes rejected by Windows urlmon** (`i://` = InvalidUri); 2+ letters fine (`cc://`, `note://`) | Windows | empirical CreateUri tests |
| Click friction | WT: `"safeUriSchemes": ["claudectl"]` in settings.json auto-launches (else confirm dialog); VS Code: `allowedLinkSchemes` prompt-once-then-persist | both | `MTSMSettings.h`, `terminalConfiguration.ts` |
| Malformed URI | WT tooltip shows localized "InvalidUri" — an invalid URI kills the whole channel | WT | `_hoveredHyperlinkChanged` |
| CC sanitizer | statusline output is captured/re-rendered; only **multi-line + SGR colors + OSC 8** are blessed; assume all other OSC/DCS stripped; 300ms debounce; bar hides during permission prompts (tooltips vanish then) | Claude Code | statusline docs + #21586 |
| CC OSC 8 terminal matrix | works in **IDE terminals only** (VS Code/Cursor/Windsurf) since v2.1.42; native emulators (Konsole #26356) and tmux (#23438/#27047) broken, closed unfixed | Claude Code | issue archaeology |

### 1.2 Design rules that fall out

1. **Author tooltips space-free** with `+`/`.`/`-` separators so one string
   works in both terminals: `cc://note/5h+72%25+resets+14:30+|+burn+4.2%25/h`.
   A per-terminal "prose mode" (real spaces, WT-only) is a config option, not
   the default. `TERM_PROGRAM` env identifies the host at render time.
2. **Dual-audience URIs**: the first ~1024 chars are the human summary (WT
   display budget); the tail can carry machine args for the handler — the
   click receives the full stored URI (≤2MB WT). Keep *clickable* payloads
   ≤ ~2KB post-encoding (ShellExecute/urlmon legacy paths); anything bigger
   goes in a state file referenced by a short token.
3. **Every informational tooltip still needs a safe click**: point at an
   idempotent verb (`copy?text=…`, `noop`, open-report) so a stray Ctrl+click
   never harms. Bonus pattern: "click copies the very stats you're reading."
4. **Punctuation palette** (renders verbatim in both terminals): `| [ ] ( )
   - > = ~ * , : +` and lone `%`. Percent-encode nothing except what you must;
   it displays encoded.
5. **Hover strips**: adjacent emoji with the *same* `id`+URI hover as one unit
   (a segmented mega-control with one big tooltip); *distinct* URIs make them
   independent buttons. Both confirmed working in both engines.
6. **Feature-detect and degrade**: in tmux/Konsole render plain text + a
   printed command instead of links. Pin a smoke test that a link survives
   each CC upgrade — v2.1.3 stripped OSC 8 once already (#21586).
7. **Respect the mouse-backlash cohort** (#70622, ~74 reactions: users who hate
   in-terminal mouse interactivity): OSC 8 is hover-opt-in and captures no
   mouse events — keep it that way; never request mouse-tracking modes; every
   control must be removable in dashboard.json.

### 1.3 The paradigm

The statusline becomes a **row of gauges wearing emoji faces** — three
information densities in one cell:

| Layer | Density | Cost to user |
|---|---|---|
| Glyph | 1 symbol (ordered ramps self-read) | zero — ambient |
| Tooltip | ≤1 KB designed one-line prose | hover |
| Click | anything the OS can do | Ctrl+click |

### 1.4 Side channels beyond OSC 8 (all presumed CC-stripped from statusline stdout; `\\.\CONOUT$` direct-write bypass is the one empirical test worth running)

| Channel | Support | Use | Tier |
|---|---|---|---|
| **OSC 9;4 progress** | WT taskbar icon + tab; VS Code terminal tab (addon loaded unconditionally) | context % or rate-limit as an *ambient OS-level gauge* — visible without looking at the terminal | T2 (bypass test) |
| **OSC 52 clipboard write** | WT + VS Code by default (write-only) | terminal-layer copy without spawning a process; emit from handler on click, never per-render | T1 |
| **OSC 0/2 window title** | WT tab title; VS Code via `${sequence}` tab variable | stamp `5h 72% \| ctx 41%` into the tab — glanceable when unfocused; risks title contention with shell integration | T2 (bypass test) |
| OSC 9 plain toast | **dead on Windows** (WT parses only 9;4/9;9/9;12; VS Code only 9;9) | use BurntToast via handler instead | — |
| OSC 1337 images / sixel | VS Code only behind `enableImages` (default off); WT sixel 1.22+ | double-gated + repaint-unstable; Mission Control doesn't need it | T3 |
| OSC 4/10/11/12 palette | both engines | full-terminal red tint on critical alarm — possible, fights themes, crash leaves terminal discolored | T3 (recorded) |
| DECDLD soft fonts | WT only, not xterm.js | custom gauge glyphs — physics known, paradigm-irrelevant | T3 |

---

## 2. Payload inventory — received every tick, not yet rendered

| Field | Obvious control (all T0) |
|---|---|
| `cost.total_cost_usd` | 💰 ramp by spend; tooltip = exact $ **labeled "estimate"** (accounting distrust is a real pain point, #46917 ~219) + $/hr |
| `cost.total_duration_ms` / `total_api_duration_ms` | ⏱ session clock; tooltip = wall vs API time = "thinking ratio" |
| `cost.total_lines_added/removed` | ± churn badge, smart-hidden at zero |
| `context_window.used_percentage` + `context_window_size` | ⛁ context gauge — the ecosystem's most-shipped widget and an open ask (#18456 ~146, #79155) |
| `context_window.current_usage.*` | tooltip 4-way breakdown: fresh in / out / cache write / cache read — cache_creation is where inflation hides (#46917) |
| `exceeds_200k_tokens` + `model.id` `[1m]` suffix | ⚠ **1M-context / usage-credit trap warning** — a top May–Jul 2026 complaint cluster (#62063/#63060/#79337/#78610); warn-and-instruct, click = copy `/model` |
| `fast_mode` | ⚡ badge when on |
| `thinking.enabled` + `effort.level` | 💭 badge (half-answers #8477 "Always Show Thinking", ~353); click = transcript viewer at last thinking block |
| `output_style.name` | 🎨 badge when non-default |
| `vim.mode` | NORMAL/INSERT chip (the visibility half of #32469/#71235) |
| `agent.name` | 🤖 chip when present |
| `pr.review_state` | recolor 🔗: draft/pending/changes_requested/approved |
| `session_name` / `session_id` | identity chip **colored deterministically by hash(session_id)** — answers the "which terminal is which" cluster (#25045 ~113, #29355 ~88); tooltip = full id + worktree + branch; click = copy id |
| `version` | tooltip garnish; CC-upgrade smoke-test anchor |
| `workspace.added_dirs` | 📂+n chip; tooltip lists them |

Correctness details worth copying exactly (from claude-powerline/ccstatusline):
render the **autocompact-aware "usable %"** (subtract the ~33k buffer — the
honest number), reset context display immediately from `compact_boundary`
markers after `/compact` instead of showing stale numbers (#19669), and strip
`(1M context)` from the model name into its own badge. Note the payload gap:
**permission_mode is not in the payload** (#78847 open) — track as an unlock.

Free settings, not code: **`refreshInterval`** (bar keeps ticking while idle →
honest clocks, countdowns, and idle detection) and **`footerLinksRegexes`**
(CC's own footer grows link badges from regex matches — a second, zero-code
display surface).

---

## 3. Control catalog (T0/T1) — the wire-up-now shelf

Beyond §2's direct payload renders, in rough value order:

| Control | Glyph | Tooltip carries | Click | Tier | Notes |
|---|---|---|---|---|---|
| **Burn-rate + depletion ETA** | 🔋 ramp | `5h 38% -> 15:00 \| 7d 62% -> Mon \| burn 4.2%/h -> empty ~18:40` | open usage logbook | T0 | THE unshipped killer feature vs the #1 pain cluster (#16157 ~722, #38335 ~538). Delta of `used_percentage` across renders persisted in a state file; linear projection like claude-code-usage-bar's `->NN%`; P90-of-history limit inference portable from Usage-Monitor (~30 lines) |
| **Cache-warmth timer** | 🔥/🧊 | `cache 4:12 left \| TTL 1h \| resets w/ 5h 71%` | copy `/compact`? no — noop/copy stats | T0 | TTL auto-detect from transcript's last `ephemeral_5m/1h` usage block, anchored to last user msg (claude-powerline method); needs `refreshInterval` |
| **5h-block economics** | 💸 | `block $1.20 (2:10 left) \| today $4.80 \| proj $2.10/h` | usage report | T0 | ccusage math: UTC-floored 5h blocks, JSONL day-sum, burn tiers 2000/5000 tok/min; cache aggregates, incremental-parse by mtime |
| **Git intel** | ⑂ enriched | `main +2 -1 \| 3 staged 1 conflict \| stash 2 \| REBASE in progress` | open folder / lazygit | T0 | `.git/MERGE_HEAD`/`rebase-merge` detection (nobody else has it + high value); `--no-optional-locks`; cache invalidated by `.git/HEAD`+`.git/index` mtime = commit-instant, near-zero cost |
| **CI status** | 🚦 | `CI: 2/3 green \| lint failing 4m ago` | open checks page | T0 | `gh pr checks` / statusCheckRollup via stale-while-revalidate cache (§4.1) |
| **Staleness clock** | 🕐 | `data as of 14:32:07 \| payload frozen 4m (long turn?)` | noop | T0 | counters distrust during long turns (#77484); wall-clock vs last-payload-change delta doubles as a stall detector (#26224 ~150) |
| **Session pet / Buddy** | 🐣→🐉 | `Lv.3 \| fed 41% ctx \| mood: cozy \| 2h alive` | pet page / logbook | T0 | #45596 "Bring Back Buddy" ~2,056 reactions — massive demand for affective companions; glyph state-machine over ctx %, rate %, ±lines, duration. Default-off for minimalists |
| **Mood kaomoji** | (o´ω`o) | derived vitals | noop | T0 | claude-code-personalities prior art; token velocity + error breadcrumbs → face |
| **Fleet strip** | 🔴api 🟡docs 🟢infra | per-session `name\|state\|age\|±lines` | `focus?session=` | T1+T2 | needs-input sorted leftmost; state files from hooks (§4.3); Agent View's row grammar (name\|status\|last-line\|age) as tooltip format |
| **New-session / presets** | 🆕 | preset list | `spawn?dir=&model=&effort=` | T1 | `wt -w 0 nt -d <dir> claude …` or VS Code terminal |
| **Resume / fork** | ⏪ | last session summary | `resume?session=` | T1 | session ids free from JSONL filenames |
| **Skill launch buttons** | 🛡️🧹📝 | skill name + target | `spawn?prompt=/security-review` etc. | T1 | installed today: /security-review, /simplify, /review, /commit, feature-dev, ralph-loop (pairs with a "loop active" glyph), gitflow finish-branch |
| **Toast/TTS on click** | 🔔 | pending alerts | `toast?text=` / `speak?text=` | T1 | BurntToast + PowerShell SAPI, zero deps; absorb anotifier's verbs |
| **Copy anything** | 📋 | what it copies | `copy?text={field}` | T1 | or OSC 52 from handler |
| **Account chip** | 👤 | `jared@… \| Max plan` | noop | T0 | multi-account quota confusion (#20131 ~108); read from CC config — version-fragile, best-effort optional |
| **Theme rotation** | — | — | — | T0 | date-keyed theme pick from a pool in dashboard.json (ccstatusline-editor's novelty) |
| **Flex right-align + breakpoints** | — | — | — | T0 | flex separators absorb width; powerline-style `minWidth` breakpoints; width via env/probe once |

Presentation-layer rules to adopt as config concepts: **smart hiding** (hide
zeros, dim-don't-hide cost, show-only-when-active — kcchien), **threshold
arrays** `{value, color, glyph}` per widget instead of hardcoded tiers, and
**severity glyph swap** (the emoji itself changes with state — reinforces the
representative-emoji paradigm).

---

## 4. Methods to copy from the ecosystem

### 4.1 Caching playbook (consensus of every fast statusline)
- **Stale-while-revalidate via detached self-respawn** (ccstatusline): render
  only *reads* a per-`sha256(cwd+branch)` cache file; on miss/stale it spawns
  a detached copy of itself (`node statusline.js --refresh <source>`, `wx`
  lock file, `windowsHide`, `unref()`) and returns stale data immediately.
  Slow `gh`/network never blocks a render. Directly copyable, no deps.
- `.git/HEAD` + `.git/index` **mtime invalidation** = commit-instant cache
  busting without polling; always `--no-optional-locks`.
- JSONL aggregation is the expensive tier: cache derived metrics keyed by 5h
  block, invalidate on boundary or source mtime, **dedupe streamed entries by
  message id + request id** (or token counts overcount).
- Degrade visibly, not fatally: labeled loading placeholders, keep stale data
  on refresh failure, invalid config renders defaults + a warning badge.
  Target <50ms total render.

### 4.2 Sensing (all Windows-native, no wrapper, no tmux)
- **Passive `~/.claude/projects/**/*.jsonl` scanning** (opcode's entire session
  browser): dir enumeration = projects, file mtime = liveness, last line =
  state approximation, first line = preview. Zero cooperation from other
  sessions. This is Mission Control's fleet sensor.
- **Hook-written state-file bus** (T2): SessionStart/UserPromptSubmit/
  PreToolUse/Notification/Stop hooks write `~/.claude/fleet/<session_id>.json`;
  every statusline render readdir+parses siblings → fleet strip. Notification
  event = the crisp "needs input" flag the idle *heuristic* can't give.
- **State-transition detection inside statusline.js** (T0): persist last
  snapshot; fire toast only when a value *crosses* a threshold (ctx 80%, 5h
  90%, idle-after-long-run). Fire-and-forget spawn, debounced via state file.
- **Free sensors already running on this machine**: the installed ECC plugin
  writes `/tmp/ecc-metrics-{session}.json` per tool call + `~/.claude/metrics/
  tool-usage.jsonl` + `costs.jsonl` — last-tool/last-file breadcrumbs and
  cross-session cost, readable today (verify Windows tmpdir path; profile-gated
  by `ECC_HOOK_PROFILE`).
- **The agent-writable channel** (disler's `extras{}`): a slash command lets
  *Claude itself* post key:values into a session state file the statusline
  renders — the agent pushes its own heads-up info into the bar. Strongest
  known pattern for tooltip content beyond metrics.

### 4.3 Acting
- **Every fleet GUI bottoms out in the same CLI verbs**: `claude --resume <id>`,
  `--continue`, `-p "…" --output-format stream-json`, `--bg "task"`. These are
  claudectl argument templates, not engineering.
- **Native Agent View** (`claude agents`): a fleet button that opens it in a
  new tab beats rebuilding a TUI. Its row grammar is our tooltip format.
- **anotifier's `agentfocus://`** click-to-focus toasts independently validate
  the OS-protocol actuator; co-register or imitate for focus verbs.
- Remote access for the future web page: Cloudflare Tunnel / Tailscale, not a
  relay server (claude-code-templates precedent).

### 4.4 Mission Control display prior art
- disler's multi-agent-observability: one generic relay hook → HTTP → SQLite →
  WebSocket → live pulse chart; **emoji-per-tool vocabulary** (💻 Bash, 📖 Read,
  ✏️ Edit, 🔌 MCP) reusable in the bar today.
- Agent-Monitor's 4-state vocabulary **working|waiting|completed|error** + rules
  engine (inactivity, stuck-agent, token-threshold, error-burst) = the badge
  state model.
- Crystal's `prompt_markers` (jump-to-prompt transcript navigation) and
  per-session `execution_diffs` — for the claudectl transcript/diff viewers.
- statuslin.es — community gallery with sandbox-rendered previews; the gallery
  model for our web app's library page.

---

## 5. Pain-point-driven controls (CC issue tracker, by traction)

| Pain cluster | Issues (~reactions) | Dashboard answer | Status |
|---|---|---|---|
| Usage-limit anxiety — "it drained and I didn't notice" | #16157 (~722, open), #38335 (~538, open), #13585, #33978 consolidating 10+ | burn-rate + ETA control (§3 row 1) | **relievable now** |
| Built-in rate-limit bars | #30341 closed **not_planned** | we ARE the sanctioned path; issue doubles as a community-written spec + competitor list | validation |
| Persistent context meter | #18456 (~146), #79155 | ⛁ gauge + breakdown tooltip | **now** |
| 1M-context credit trap | #62063/#63060/#79337/#78610 (Jul 2026 cluster) | ⚠ badge on `[1m]`/`exceeds_200k` | **now** |
| Buddy / affective companion | **#45596 (~2,056)**, #41684 (RPG evolution from real token usage), #41867 | pet control (§3); web app "delight" shelf | **now** (glyph state-machine) |
| Session identification | #25045 (~113), #29355 (~88), #11145 (~93), #13514 (~108) | hash-colored identity chip | **now** (display); rename = T3 |
| Idle / needs-input alert | #13024 (~79), #36850, #8985 (~64) | idle heuristic toast (T0) → crisp via Notification hook (T2) | now / T2 |
| Which file is being read | #21151 (~186) | PreToolUse hook breadcrumb → 📄 basename, tooltip = path, click = open | **T2** |
| Statusline staleness | #77484, #26224 (~150) | last-updated clock + stall detector | **now** |
| Thinking visibility | #8477 (~353) | 💭 badge + transcript deep-link (content itself: 1-line tooltip can't) | partial now |
| Transcript/history access | #27242 (~80), #28077 (~75), #44763 (~75) | claudectl JSONL viewer: timestamps, compaction-boundary jumps, pre-compaction turns | T1 |
| Cost distrust | #46917 (~219), #64873 | "estimate" labeling + exact tokens + cache_creation surfaced | **now** |
| Multi-account confusion | #20131 (~108), #24963, #55621 | account chip | best-effort now |
| Vim mode visibility | #32469, #71235 | vim.mode chip | **now** |
| Errors surfaced late | #63875/#62123 (~117/~113 parse errors), #73365 (~174 Advisor fails silently) | last-error glyph needs a hook (T2); advisor state not in payload (T3) | T2 / T3 |
| Mouse-interactivity backlash | #70539/#70672/#70622/#65833 (~74–88 each) | design guardrail §1.2.7 — hover-opt-in only, all controls removable | guardrail |

---

## 6. Skills & plugins that pair with the dashboard

- **Installed, launchable the moment `spawn` exists** (T1): /security-review,
  /simplify, /review, /commit + /commit-push-pr, feature-dev, ralph-loop,
  claude-gitflow:finish-branch, dev-strap:ado.
- **Uninstalled but ideal buttons**: session-report + receipts (generate an
  HTML usage/impact report, claudectl opens it — "generate my report" button),
  wshobson/commands' 57 one-shots (security-scan, deps-audit, standup-notes,
  context-save/restore = a "save context before risky work" button).
- **Notification reuse**: anotifier (BurntToast + ntfy + agentfocus://),
  disler's TTS chain ("Your agent needs your input" — PowerShell SAPI port),
  wsl2-setup's Stop/PermissionRequest→toast recipes, Lockpaw's ambient screen
  glow → our cheap version: **row background tint when needs-input** (T2).
- **Hook authoring**: hookify **cannot** write flag files (message-oriented
  warn/block only) — use plugin-dev:hook-development for the real
  Stop/Notification → flag-file sensors. johnlindquist/claude-hooks scaffolds
  typed Node hooks with a tmp-dir session store the statusline could read.
- **Observability plugins** (dash0, langfuse) confirm hooks/OTel as the export
  surface; Mission Control could ingest local OTLP instead of a bespoke relay.
- **obra marketplace**: claude-session-driver (spawn-worker prior art),
  double-shot-latte (Claude-judged "finished vs should-continue vs needs-human"
  → a *3-state* attention glyph, richer than a bare Stop flag),
  episodic-memory (semantic search over past sessions — a [logbook] upgrade).

---

## 7. The posterity shelf (T3 — impossible now, recorded for the library)

**Blocked on CC core / payload gaps:**
- `permission_mode` badge (field absent from payload — #78847 is the unlock)
- Click-to-**rename** session (no external verb mutates CC's session store;
  even native renames don't persist reliably, #25090)
- Click-to-switch model/effort/thinking (no external verb; warn-and-instruct
  is the ceiling) — the old spec's Layer B bridges (ConPTY wrapper, hook
  mailbox, SendInput, MCP control plane) remain the theoretical routes
- Advisor status light (#73365), Remote Control connection health (#34255),
  background-task/subagent inventory — none in payload
- Live thinking *content* in the bar (1-line ASCII tooltip can't; viewer click
  is the honest 80%)
- Per-user monthly **billed** spend (Admin API is org-level only — #64873)
- Account *switching* on click
- tmux / Konsole / native-terminal OSC 8 (CC's repaint layer defeats
  passthrough; closed not_planned)
- Cursor-shape vim cues (#32469's actual ask)

**Blocked on terminal physics (recorded as known physics):**
- Emoji/Unicode *inside* tooltips (bytes 32–126 only — the glyph carries the
  emotion, the tooltip carries ASCII)
- Multi-line tooltip layouts (protocol-impossible; WT's soft-wrap of one long
  line is the only "layout")
- Sixel sparklines / OSC 1337 images in the bar (double-gated, repaint-unstable)
- DECDLD custom gauge glyphs (WT-only, stripped by CC)
- Full-terminal alarm tinting via OSC 4/10/11 (possible but theme-hostile,
  crash-risky — deliberately shelved)

**Wow-shelf for the web app gallery** (show these as "coming attractions"):
- **Taskbar battery**: OSC 9;4 progress = context/rate gauge on the Windows
  taskbar icon itself (one CONOUT$ passthrough test from reality)
- **Tab-title telemetry**: `5h 72% | ctx 41%` visible in the tab strip when
  the terminal is unfocused
- **Hover strips**: one `id=` mega-tooltip spanning a row of segmented emoji
- **Buddy RPG**: pet evolution driven by real token usage (#41684's exact ask)
- **Agent-authored tooltips**: Claude pushes its own status prose into the bar
  via the extras{} channel
- **Ambient alarm row**: background tint on needs-input (Lockpaw, in-bar)

---

## 8. What the WYSIWYG editor's edges must carry to the nodes

The web app is a node graph: **data sources → formatters → controls → rows**.
The exported artifact (`dashboard.json`) is the intermediary a dependency-free
`statusline.js` renders without ever throwing. Schema decisions, informed by
ccstatusline (the closest artifact prior art) and claude-powerline:

**Artifact envelope** (ccstatusline lessons): a `version` int + migration
chain; `lines[][]` of ordered control objects; **free-string `type`** so
unknown/future controls are tolerated, not fatal; per-control
`metadata: Record<string,string>` escape hatch so options never force schema
churn; **import = validate → preview → replace-or-merge** (never blind
overwrite).

**Each edge (binding) carries:**
1. **Source** — dotted payload path (`context_window.used_percentage`), a
   computed source (`git.ahead_behind`, `burn.eta`, `block.cost_today`), a
   state-file read (`fleet/*.json`, ECC metrics), or a command splice
   (ccstatusline's `--segment mode` convention: external tool emits a
   ready-made segment). Every binding declares **absence behavior**
   (hide / fallback / substitute) — half the payload fields are optional.
2. **Formatter chain** — pure functions with args: `percent0`, `usd2`,
   `tokens_exact`, `clock_hm`, `duration_short`, `truncate(n)`,
   `ascii_bar(width)`, and `ramp(scale_id)` — glyph ramps are formatters
   from number → emoji, with ZWJ/variation-selector safety flags from the
   glyph doc.
3. **Threshold array** — `[{value, color, glyph}]` per control (the WYSIWYG
   slider UI edits exactly this); severity can swap the glyph itself.
4. **Tooltip template** — single-line ASCII prose with `{binding}` slots,
   authored space-free (`+`/`.` separators) for VS Code safety with an opt-in
   WT prose mode; the editor renders a live **1024-char ruler** (WT display
   cut) and a 2KB click-budget warning; auto-percent-encodes illegal bytes;
   scheme selector (`claudectl` / registered short aliases).
5. **Click spec** — verb + `{binding}`-templated params, the verb's safety
   class (safe / confirm / destructive-absent-in-v1), fallback chain
   (repo → issues → cwd, as shipped).
6. **Placement** — row, order, `minWidth` breakpoint visibility
   (claude-powerline's grid model: named areas, `fr` columns — v2), flex
   separators for right-alignment, separator style, `merge` glue.
7. **Conditions** — `hideWhen` / `dimWhen` / `showWhen` expressions over
   bindings (`pr == null`, `used_percentage > 80`, `zero(value)`) — kcchien's
   smart-hiding as user-editable config.

**Editor features with proven demand** (both existing editors ship them):
live true-to-terminal preview (SVG-rendered, no font requirements), paste-a-
config round-trip, one-click templates, **share links** (config behind a short
URL), and a companion **apply path** — ours is better than a CLI: a
`claudectl://apply-config?url=` verb makes *installing a shared dashboard a
single click from the browser*. Theme-rotation pools (hourly/daily/weekday)
are a cheap differentiator. aitmpl.com's contrast (export = generated CLI
command, no round-trip) argues for supporting both download and install-verb.

**What no existing editor has — our moat**: link/tooltip/action authoring,
per-terminal capability profiles (VS Code vs WT tooltip rules baked into
validation), hover-strip composition, threshold-driven glyph swaps, and the
pet/companion state-machine designer.

---

## 9. Test-before-build list (cheap empirical checks that gate ideas)

1. CC current version × WT: does statusline OSC 8 reach Windows Terminal at
   all (post-2.1.42 IDE-only matrix)? Gates all WT-specific prose work.
2. `\\.\CONOUT$` write from statusline.js child: does ConPTY forward OSC 9;4
   / title changes mid-frame without garbling? Gates taskbar gauge + tab
   telemetry.
3. WinRT `Uri` vs urlmon flags: confirm raw-space prose renders in a live WT
   tooltip (CreateUri flags may differ).
4. ShellExecute with 4KB/16KB claudectl URIs (long-payload click reliability).
5. A CC-upgrade smoke test in CI: pipe fixture JSON, assert OSC 8 survives.

## 10. Sources

Key repositories: sirmalloc/ccstatusline · Owloops/claude-powerline (+
powerline.owloops.com) · refinist/ccstatusline-editor · Haleclipse/CCometixLine
· kcchien/claude-code-statusline · hagan/claudia-statusline ·
felipeelias/claude-statusline · ryoppippi/ccusage ·
Maciek-roboblog/Claude-Code-Usage-Monitor · getAsterisk/opcode ·
sugyan/claude-code-webui · smtg-ai/claude-squad · kbwo/ccmanager ·
stravu/crystal · BloopAI/vibe-kanban · slopus/happy ·
davila7/claude-code-templates (aitmpl.com) · disler/claude-code-hooks-mastery ·
disler/claude-code-hooks-multi-agent-observability ·
hoangsonww/Claude-Code-Agent-Monitor · DevinoSolutions/ai-agent-notifier ·
Piebald-AI/tweakcc · leeguooooo/claude-code-usage-bar ·
kumamaki/Claude-Code-Personalities · stefanprodan/cctop · wshobson/commands ·
johnlindquist/claude-hooks · obra/superpowers-marketplace · statuslin.es

Terminal source: microsoft/terminal (`ControlCore.cpp`, `TermControl.cpp/xaml`,
`OutputStateMachineEngine.*`, `TerminalPage.cpp`, `adaptDispatch.cpp`,
`MTSMSettings.h`, `textBuffer.cpp`) · microsoft/vscode
(`terminalLinkManager.ts`, `terminalConfiguration.ts`, `xtermTerminal.ts`) ·
xterm.js (`InputHandler.ts`, `OscLinkService.ts`) · egmontkob's OSC 8 gist.

Claude Code: statusline docs (code.claude.com/docs/en/statusline) and issues
#8477 #8985 #11008 #11145 #13008 #13024 #13514 #13585 #16157 #18456 #19669
#20131 #21151 #21586 #22115 #23438 #24963 #25045 #25090 #26224 #26356 #27047
#27242 #28077 #29355 #29928 #30341 #32469 #33978 #34255 #36850 #37986 #38335
#41684 #41867 #44763 #45596 #46917 #46419 #47345 #53486 #55621 #62063 #62123
#63060 #63875 #64873 #65833 #69411 #70539 #70622 #70672 #71235 #73365 #74066
#77484 #78610 #78847 #79155 #79337
