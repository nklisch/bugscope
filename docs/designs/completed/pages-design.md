# Pages Design: Krometrail

## Project Understanding

Krometrail is an MCP server and CLI that gives AI coding agents eyes into running applications. It has two distinct capabilities: **browser observation** (passive recording and investigation of browser sessions via CDP) and **runtime debugging** (breakpoint-level debugging across 10 languages via DAP). Its core innovation is the **viewport abstraction** — a ~400-token compact text rendering of debug state optimized for LLM context windows. The project competes with 5+ MCP-DAP bridges (AIDB, mcp-debugger, mcp-dap-server, debugger-mcp, dap-mcp) but is the only one that addresses agent ergonomics (token awareness, context compression, viewport diffing) and the only one with browser observation capabilities.

**Audience:** AI agent developers and users (Claude Code, Codex), MCP ecosystem participants, developers building agentic systems.

**Personality:** Technical, opinionated, pragmatic. Deep architecture thinking with strong opinions about why agent ergonomics matter more than raw plumbing.

**Stage:** v0.1.0, recently renamed, preparing for public launch. 18 design phases complete.

## Site Purpose

**Product marketing site with comprehensive documentation.** The landing page tells krometrail's differentiation story — why agents need runtime observation, what makes the viewport abstraction and browser observation unique — followed by full docs covering getting started, browser observation, debugging, language adapters, and API reference.

This positioning fits because:
- The competitive landscape is active (5+ projects solving similar problems)
- Browser observation is genuinely novel — no competitor has anything like it
- The viewport abstraction needs visual explanation to communicate its value
- The project is preparing for public launch and needs to attract early adopters

## Landing Page

The landing page leads with browser observation as the marquee feature, positions runtime debugging as the powerful companion capability, and uses the viewport format as the visual signature throughout.

### Section 1: Hero

**Purpose:** Immediately communicate what krometrail does and create visual intrigue.

**Content:**
- Headline: "See what your AI agent can't" or "Give your AI agent browser eyes and a debugger"
- Subheadline: "Krometrail records browser activity and debugs running code — so AI agents can diagnose bugs they'd otherwise guess at."
- Two CTAs: "Get Started" (primary, violet) + "View on GitHub" (secondary, outlined)
- Visual hook: A split viewport rendering — left side shows a browser observation session overview (network requests, framework state diffs, markers), right side shows the debug viewport (`── STOPPED at order.py:147 ──`). Both rendered in JetBrains Mono against the dark surface color.

**Visual:**
- Full-width dark background with a subtle radial gradient (violet glow from center-top)
- The viewport/session blocks float with a thin violet/cyan left-border accent respectively
- Responsive: stacks vertically on mobile, left block (browser) on top

### Section 2: Browser Observation Showcase

**Purpose:** This is the most innovative feature — it gets dedicated, prominent treatment above the fold or immediately after the hero.

**Content:**
- Section title: "Record everything. Investigate anything."
- Subtitle: "Capture browser activity passively — network, console, DOM, storage, framework state — then search, inspect, and diff recorded sessions to diagnose bugs."
- Feature grid (2x3 or 3x2):
  - **Network** — Every request/response with headers, bodies, timing, WebSocket frames
  - **Framework State** — React & Vue component lifecycles, state diffs, store mutations, auto-detected bug patterns
  - **Console & Errors** — All output with levels, args, stack traces
  - **DOM & Input** — Structural mutations, clicks, form submissions, field changes
  - **Screenshots** — Periodic and navigation-triggered snapshots
  - **Storage** — localStorage/sessionStorage mutations and cross-tab events
- Investigation tools callout: "Search → Inspect → Diff → Replay"
  - Brief descriptions of session_search, session_inspect, session_diff, session_replay_context
- Code example: A terminal block showing a browser observation workflow (start → mark → stop → search → diff)

**Visual:**
- Cyan accent color (#22D3EE) used throughout this section to visually distinguish browser features
- Feature cards with subtle cyan left-border
- The investigation tools shown as a horizontal pipeline/flow diagram with arrows
- Terminal block styled as a real terminal window

### Section 3: Runtime Debugging Showcase

**Purpose:** Present the debugging capability as equally powerful, with emphasis on the viewport innovation.

**Content:**
- Section title: "Runtime debugging with a viewport built for LLMs"
- Subtitle: "Set breakpoints, step through code, and inspect variables across 6 languages — rendered in ~400 tokens per stop."
- Annotated viewport demo: The full viewport output (`── STOPPED at app/services/order.py:147 ──`) with hover/click annotations pointing to each section:
  - Call Stack → "5 frames by default, configurable"
  - Source → "15 lines of context around the current line"
  - Locals → "Auto-truncated, type-aware rendering"
  - Watch → "Persistent expressions evaluated on every stop"
- Key capabilities list: Conditional breakpoints, watch expressions, context compression (auto-summarization + viewport diffing), framework detection (pytest, jest, Django, Flask), multi-threaded debugging

**Visual:**
- Violet accent color (#7C3AED) used throughout to distinguish debug features
- The viewport demo is the visual centerpiece — large, well-spaced, with clear annotations
- Subtle animation: annotations fade in as user scrolls to the section

### Section 4: Language Support Grid

**Purpose:** Show multi-language breadth as a competitive advantage.

**Content:**
- Grid of 6 primary languages with icons, debugger names, and "Stable" badges:
  - Python (debugpy), Node.js (js-debug), Go (Delve), Rust (CodeLLDB), Java (java-debug), C/C++ (GDB/lldb-dap)
- Secondary row or note: "+ Ruby, C#, Swift, Kotlin adapters"

**Visual:**
- Compact card grid, each card shows a language icon (or monogram), debugger name, status badge
- Hover: card border shifts to violet
- Responsive: 3x2 on desktop, 2x3 on tablet, stacked on mobile

### Section 5: Quick Start

**Purpose:** Get visitors from "interested" to "trying it" in 30 seconds.

**Content:**
- Tabbed setup:
  - **MCP** tab: JSON config snippet for Claude Code settings.json
  - **CLI** tab: `npm install -g krometrail` or `bash scripts/install.sh`
  - **npm** tab: `bunx krometrail --mcp`
- Below tabs: A brief terminal walkthrough showing a complete debug session (launch → breakpoint → inspect → fix)

**Visual:**
- Tabs styled with violet active state
- Terminal blocks with dark surface background, title bar, copy button

### Section 6: Comparison Table

**Purpose:** Transparently position krometrail against alternatives. Build trust through honesty.

**Content:**
- Table comparing krometrail vs. AIDB, mcp-debugger, mcp-dap-server across:
  - Viewport abstraction (compact, token-budgeted output)
  - Context compression (auto-summarization, diffing, progressive detail)
  - Browser observation (recording, investigation, framework state)
  - Language count (6 stable + 4 additional)
  - Conditional breakpoints
  - Watch expressions
  - Framework detection (pytest, jest, Django, etc.)
  - CLI parity (every MCP tool available as shell command)
  - Token awareness

**Visual:**
- Clean table with check/cross/partial icons
- Krometrail column highlighted with subtle violet background
- Responsive: horizontal scroll on mobile with sticky first column

### Section 7: Footer

**Purpose:** Navigation and links.

**Content:**
- Documentation link
- GitHub repository link
- License (MIT)
- "Built with Bun, TypeScript, and too many debugger protocols"

**Visual:**
- Minimal, dark, single-row on desktop

## Content Architecture

```
/ (Landing page)
│
├── /guide/                         ← "Guide" nav item
│   ├── Getting Started
│   ├── MCP Configuration
│   ├── CLI Installation
│   └── Your First Debug Session
│
├── /browser/                       ← "Browser" nav item
│   ├── Overview
│   ├── Recording Sessions
│   ├── Investigation Tools
│   │   ├── Search
│   │   ├── Inspect
│   │   ├── Diff
│   │   └── Replay Context
│   ├── Framework Observation
│   │   ├── React
│   │   └── Vue
│   └── Markers & Screenshots
│
├── /debugging/                     ← "Debugging" nav item
│   ├── Overview
│   ├── Breakpoints & Stepping
│   ├── Variables & Evaluation
│   ├── Watch Expressions
│   ├── Context Compression
│   ├── Multi-threaded Debugging
│   └── Framework Detection
│
├── /languages/                     ← "Languages" nav item
│   ├── Python
│   ├── Node.js / TypeScript
│   ├── Go
│   ├── Rust
│   ├── Java
│   ├── C / C++
│   ├── Ruby
│   ├── C#
│   ├── Swift
│   └── Kotlin
│
├── /reference/                     ← "Reference" nav item
│   ├── MCP Tools (all 28)
│   ├── CLI Commands
│   ├── Viewport Format
│   ├── Configuration
│   └── Adapter SDK
│
└── /about/                         ← "About" nav item (footer or secondary)
    ├── Architecture
    ├── Prior Art & Comparison
    └── Vision & Roadmap
```

**Top navigation:** Guide | Browser | Debugging | Languages | Reference

**Sidebar:** Context-sensitive per section. VitePress generates sidebars from directory structure.

**Search:** VitePress built-in local search (no external service needed).

## Visual Identity

### Color Palette

| Role | Value | Usage |
|------|-------|-------|
| Primary | `#7C3AED` | Brand color, CTAs, debug feature accents, active nav states |
| Primary hover | `#6D28D9` | Darkened primary for hover states |
| Accent | `#22D3EE` | Browser observation features, secondary highlights, links |
| Accent hover | `#06B6D4` | Darkened accent for hover states |
| Background | `#111113` | Page background |
| Surface | `#1A1A1E` | Cards, code blocks, sidebar background |
| Surface elevated | `#222226` | Hovered cards, active sidebar items |
| Text primary | `#EDEDEF` | Body text, headings |
| Text secondary | `#71717A` | Muted descriptions, meta text |
| Text tertiary | `#52525B` | Placeholder text, disabled states |
| Warning | `#FBBF24` | Breakpoint markers, caution callouts |
| Error | `#EF4444` | Error states, exception highlights |
| Success | `#22C55E` | Status badges, success callouts |
| Border | `#27272A` | Card borders, dividers, code block borders |
| Border highlight | `#3F3F46` | Hovered borders, focus rings |

### Dual-Tone Strategy

The violet/cyan dual-tone maps directly to krometrail's two feature domains:
- **Violet (#7C3AED)** = Runtime debugging (breakpoints, stepping, viewport, DAP)
- **Cyan (#22D3EE)** = Browser observation (recording, investigation, CDP)

This dual-tone appears consistently:
- Landing page section accents
- Documentation sidebar icons
- Code block left-border accents (violet for debug examples, cyan for browser examples)
- Feature card borders

### Aesthetic

**Typography:**
- Body: Inter (400, 500, 600 weights) — clean, neutral, excellent readability
- Code: JetBrains Mono (400, 700) — the viewport renders and all code blocks
- Headings: Inter 600 — same family, weight differentiation only

**Spacing:**
- Generous padding throughout — the viewport examples need room to breathe
- Section spacing: 96px between major landing page sections
- Card padding: 24px
- Content max-width: 1200px (landing page), 960px (docs)

**Component Style:**
- Border radius: 8px for cards and containers, 6px for code blocks, 4px for buttons and badges
- Borders: 1px solid `#27272A`, shifting to `#3F3F46` on hover
- Shadows: Minimal — a subtle box-shadow on elevated surfaces only (`0 4px 16px rgba(0,0,0,0.3)`)
- No heavy gradients — one subtle radial gradient on the hero background (violet glow), otherwise flat

**Code Blocks:**
- Background: `#1A1A1E` (surface color)
- Left border: 3px solid, colored by context (violet for debug, cyan for browser, `#27272A` for generic)
- Font: JetBrains Mono 14px
- Syntax highlighting: Dark theme with violet/cyan accents integrated (keywords in violet, strings in cyan)
- Copy button: Appears on hover, top-right corner

**Dark/Light Mode:**
- Dark is primary and default
- Light mode supported via VitePress theme toggle with CSS variable overrides
- Light mode inverts the background tones but preserves violet/cyan brand colors

**Hover & Interaction:**
- Cards: Border color transitions from `#27272A` → `#3F3F46`, subtle box-shadow appears
- Buttons: Background darkens slightly, no transform/scale effects
- Links: Underline on hover, cyan color
- No heavy animations — subtle opacity and color transitions (150ms ease)

## Custom Components

### HeroSection.vue

**Purpose:** Landing page hero with split viewport/session demo and CTAs.

**Props:**
- `headline: string` — Main tagline
- `subtitle: string` — Supporting copy
- `primaryCta: { label: string, href: string }` — Primary button
- `secondaryCta: { label: string, href: string }` — Secondary button

**Behavior:**
- Renders two side-by-side code blocks: browser session overview (left, cyan border) and debug viewport (right, violet border)
- Subtle radial gradient background emanating from top-center (violet → transparent)
- Blocks render in JetBrains Mono with syntax-aware coloring
- Responsive: blocks stack vertically on mobile, browser block on top
- No animation on initial load — static, fast-rendering

### BrowserShowcase.vue

**Purpose:** Dedicated browser observation feature section with capability grid and investigation pipeline.

**Props:**
- `features: { icon: string, title: string, description: string }[]` — Captured data types
- `pipeline: { step: string, description: string }[]` — Investigation workflow steps

**Behavior:**
- Renders a 3x2 (or 2x3) grid of feature cards, each with a cyan left-border accent
- Below the grid: a horizontal pipeline diagram showing Search → Inspect → Diff → Replay with connecting arrows
- Each pipeline step is clickable, linking to the relevant docs page
- Responsive: grid becomes 2-column on tablet, single-column on mobile; pipeline becomes vertical

### ViewportDemo.vue

**Purpose:** Interactive annotated viewport showcase for the debugging section.

**Props:**
- `viewportText: string` — Raw viewport output text
- `annotations: { line: number, label: string, description: string }[]` — Callout annotations

**Behavior:**
- Renders the viewport text in a styled code block with violet left-border
- Annotation markers appear as small badges along the right edge, aligned to specific lines
- Hovering/clicking an annotation shows a tooltip with the description
- Toggle button switches between "Full Viewport" and "Diff Mode" to demonstrate compression
- Responsive: annotations collapse to an expandable list below the viewport on mobile

### LanguageGrid.vue

**Purpose:** Grid showing supported language adapters with status.

**Props:**
- `languages: { name: string, icon: string, debugger: string, status: 'stable' | 'beta' | 'experimental' }[]`

**Behavior:**
- Responsive grid of compact cards (3 columns desktop, 2 tablet, 1 mobile)
- Each card: language monogram/icon, name, debugger name, colored status badge
- Hover: border shifts to violet, subtle elevation
- Primary 6 languages shown prominently; additional 4 shown in a secondary row or "more" disclosure

### TerminalBlock.vue

**Purpose:** Enhanced code block styled as a terminal window for CLI examples.

**Props:**
- `title: string` — Window title bar text (e.g., "Terminal")
- `commands: { prompt?: string, command: string, output?: string }[]` — Command/output pairs
- `accent: 'violet' | 'cyan'` — Left-border color (debug vs browser context)

**Behavior:**
- Renders a terminal window with macOS-style title bar (three dots + title)
- Commands shown with `$` prompt in muted color, command text in primary text color
- Output lines in text-secondary color
- Copy button (copies commands only, not output) on hover
- Left-border accent colored by the `accent` prop

### ComparisonTable.vue

**Purpose:** Feature comparison table vs. competitor MCP-DAP projects.

**Props:**
- `features: string[]` — Row labels
- `projects: { name: string, values: ('yes' | 'no' | 'partial' | string)[] }[]` — Column data

**Behavior:**
- Responsive table with sticky first column (feature names) on horizontal scroll
- Boolean values rendered as check (green), cross (muted), or partial (amber) icons
- String values rendered as text
- Krometrail column has a subtle violet background tint to highlight it
- Hover: row background lightens slightly for readability

### SetupTabs.vue

**Purpose:** Tabbed installation/configuration instructions.

**Props:**
- `tabs: { label: string, language: string, code: string }[]`

**Behavior:**
- Tab bar with violet active indicator
- Content area renders code blocks with syntax highlighting per language
- Copy button per tab
- First tab active by default
- Responsive: tabs scroll horizontally if they overflow on mobile

## Implementation Notes

- **VitePress version:** Use latest stable VitePress (1.x). Custom theme extends the default theme with CSS variable overrides for the Chrome Inspector palette.
- **Font loading:** Import Inter and JetBrains Mono via Google Fonts in the VitePress head config. Use `font-display: swap` to avoid FOIT.
- **CSS architecture:** All custom styles via CSS custom properties in `.vitepress/theme/custom.css`. Override VitePress's built-in `--vp-c-brand-*` variables for consistent theming. No preprocessors or utility frameworks.
- **Component location:** Custom Vue SFCs live in `.vitepress/theme/components/`. Register globally in `.vitepress/theme/index.ts`.
- **Content source:** Landing page is a custom Vue layout, not markdown. Documentation pages are markdown with occasional embedded Vue components for interactive demos.
- **Deployment:** GitHub Actions workflow: on push to main → build VitePress → deploy to GitHub Pages via `actions/deploy-pages@v4`.
- **Image assets:** Language icons can be simple SVG monograms or sourced from devicon. Keep assets minimal — the site should feel text-and-code-first.
- **Existing docs migration:** The project has extensive docs (VISION, ARCH, UX, SPEC, INTERFACE, TESTING, PRIOR_ART, ADAPTER-SDK). These can be reorganized into the content architecture above with minimal rewriting — primarily restructuring and adding frontmatter.
- **Performance:** VitePress generates static HTML. No client-side data fetching. Custom components should be lightweight — no heavy animation libraries. Target < 200KB total JS bundle.
- **SEO:** VitePress handles meta tags via frontmatter. Add Open Graph tags for social sharing. The landing page should have a descriptive `<title>` and meta description targeting "AI agent debugging" and "browser observation for AI" keywords.
