# claude-tui-dashboard

Statusline and session tooling for the [Claude Code](https://code.claude.com) terminal interface.
Upgrade your statusline into a *dashboard*! A configurable, heavily customizeable command center lives directly below your cursor, ready to display critical data and dispatch commands with the click of a button-emoji.  With its constellation of pluggable wiidgets, each extensible and "skinnable" out of the box, Claude TUI Dashboard is the right tool for every situation.  

## Default Dashboard config
```
🏆●   ⌛ 80% [15:20]  |  📅 62% [7/28 4:37]  |  Σ 162345
⑂ f/claude-tui-dashboard   🔗 PR #12   [📒] [📜] [🌳]
```

This what you'll get moments after popping open the Dashboard, no configuration necessary.

### Features:

#### TUI Actions
- **Clickable everything** (OSC 8, Ctrl/Alt+click): branch folder, PR, logs folder, transcript, base branch

#### Emoji Buttons
- While every part of the display can incoprorate the "Label: <value>" paradigm that's well-worn by other statusline options, the heart of the Dashboard paradigm is our adoption of emojis as dynamic, extensible, universal, language-agnostic diagnostic displays


#### Tooltip HUD
- (under heavy development) Every party of your dashboard can display an handy parcel of alphanumeric data that updates in real time, simply by hovering over the various dashboard widgets.  Like an ASCII bar chart for your context window component, but low on space?  Donm't display any labels or numbers next to the graphics -- instead, shunt the data you need into a tooltip!  The exact counts of context window, usage %, cost, etc are all exact (never approximated), and at your fingertips without having to wait a turn and a half tro issue a command.  Try it: 

Note: the tooltip format heavily limits what can be represented, so it's more like assemblnig a scrabble word from pieces, than filling out a handwiritten text area.  See the tooltip HUD spec

#### Thematic Icon Families 
- the Dashboard is populated by a system of emoji families who sharing space yet retain their individual meaning while expressing a unique diagnostic critera that remains performant, and more thana little fun.
- **Ramping effort/intensity system keeps you apprised of critical system internals while minimizing cognitive load. Fully reskinnable, with a dozen logical families of severity represented by a variable number of glyphs - still occupying only 1 'slot' per widget.  More than a dozen of these ramp families included** (🥉 haiku → 🏆 fable) and **effort dial** (○–★) 

#### Widget system
- The Dashboard is composed of a finite number of multi-character areas which operate like widgets.  
- A positional map can be unfurled over the display, making it easy to see where data renders, in the Laboratory mode
- Every widget supports:
   * A static label (optionally collapsible under certain scenarios)
   * Slots for emojis, double width emojis, and soon alternate glyphs pulled from the enormous ISO space
   * Dynamic data strings 
   * A hoverable tooltip element

- a few specialized widgets occupy multiple widgets widths, allowing your UI to be flexible to the max


#### Headline Meters, Dials, and Diagnostics
- **Rate-limit windows** as remaining % with their reset stamps
- **Exact session token count** — raw digits, never abbreviated


-Under the hood, a **Windows protocol** designed with safety in mind fromm the first commits powers the advanced functionality allowing the Dashnoard to actually be interactive - in a meangful way.  The `claudectl://` protocol** supports an extensible vocabulary of actions which are directly mapped to dozens of potential "cantrips" outt of the box.  So: folder links open in Explorer even, git status diagnostics link to their actual browser-based GitHub views, sessions can be spawned and killed with the click of a button, and so on.  

####   (lots more still to document, right out of the tin)

- (docs coming soon)


## Requirements 

```- Sorry, Linux bros - Claude TUI Dashboard is Windows-only in the Alpha phase```

Requirements: Node.js, a hyperlink-aware terminal (Windows Terminal, VS Code,
iTerm2, WezTerm). The Explorer integration is Windows-only; everything else is
cross-platform.


## Install

`/claude-tui-dashboard:uninstall` restores whatever statusline was live before
install. On Windows, **Settings > Apps > "Claude Control Protocol (claudectl)"**
does the same via the OS-standard flow.

### Marketplace 
Use the Claude Code plugin marketyplace syustem to keep your user interface tuned for maximum impact :

```
/plugin marketplace add <path-or-git-url-of-this-repo>
/plugin install claude-tui-dashboard@claude-tui-dashboard
/claude-tui-dashboard:activate-dashboard
```
## Uninstall



Full details — what each glyph means, how the protocol handler stays
non-destructive, manual install steps — in
[`plugins/claude-tui-dashboard/README.md`](plugins/claude-tui-dashboard/README.md).


`/claude-tui-dashboard:deactivate-dashboard` restores whatever statusline was live before
install. On Windows, **Settings > Apps > "Claude Control Protocol (claudectl)"**
does the same via the OS-standard flow.

## Customizing

Both glyph scales live in one place at the top of `statusline.js`. A catalog of
ready-made alternative ramps (psychology 😴🙂🤔🧐🤯, caffeine, creature-size,
gemstones, …) plus terminal-rendering caveats:
[`plugins/claude-tui-dashboard/docs/customizing-glyphs.md`](plugins/claude-tui-dashboard/docs/customizing-glyphs.md).


```
.claude-plugin/marketplace.json     marketplace listing
plugins/claude-tui-dashboard/    the installable plugin (single source of truth)
  statusline/                       statusline.js + claudectl protocol scripts
  skills/activate-dashboard, skills/deactivate-dashboard  the /claude-tui-dashboard:* skills
  docs/customizing-glyphs.md        glyph-ramp catalog
  CHANGELOG.md · LICENSE · README.md
docs/superpowers/                   design spec & implementation plan for the
                                    interactive dashboard this grew out of
```

## Roadmap

- I've got quite a lot already developed but not quite ready for wide release yet.  Here's a taste:
* Dashboard familiar - imagine a Tamagotchi that cheers you up when the code isn't flowing, and levels up just by your token churn
* new widgets incprooprating community feedback and popular requests
* new tooltip-based protocol schema verbs
* Clipboard integration: exfiltrate diagnostics, and import repetitive patterns
* Prompt rolodex 
* Colorized glyphs
* conditional displays
* formatting atoms 
* 3rd party project integrations
* additional glyph families and fonts
* ... and so much mroe! 

## Contributing

- Contributinos to the project are most welcome!  Pull requests and Issues are great places to dive right in. 

## Feedback

As this is my first "serious tool" designed from the ground up to be built with other peolpe's needs and idiosyncratic demands in mind, I welcome all kinds of respectful, constructive criticism.  If there's a feature, guideline, widget, approach, standard, philosophy or coding pattern you think the project would benefit from, don't be shy!  Just becuase it's not in here yet doesn't mean there isn't a place for it.  

## License

[MIT](LICENSE)
