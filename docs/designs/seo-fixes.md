# Design: Comprehensive SEO Fixes for krometrail.dev

**Date:** 2026-03-14
**Audit Score:** 48/100 → Target: 80+/100

## Overview

This design addresses all 32 issues identified in the SEO audit, organized into 4 phases by priority and dependency. Each phase is independently deployable — deploy after completing each phase to realize incremental gains.

---

## Phase 1: Critical Infrastructure (blocks indexing)

*Estimated effort: 1–2 hours. Deploy immediately after completion.*

### Unit 1.1: Create robots.txt

**File**: `docs/public/robots.txt`

```
User-agent: *
Allow: /
Disallow: /designs/
Disallow: /legacy/
Disallow: /framework-state/
Disallow: /ARCH
Disallow: /SPEC
Disallow: /UX
Disallow: /VISION
Disallow: /PRIOR_ART
Disallow: /ADAPTER-SDK
Disallow: /agents

User-agent: CCBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: cohere-ai
Disallow: /

Sitemap: https://krometrail.dev/sitemap.xml
```

**Implementation Notes:**
- AI search crawlers (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot) are implicitly allowed by the `User-agent: *` Allow rule
- Training-only crawlers (CCBot, anthropic-ai, cohere-ai) are explicitly blocked
- Internal docs (~54 pages) are blocked from all crawlers
- The Sitemap directive points to the sitemap that Unit 1.2 will generate

**Acceptance Criteria:**
- [ ] File exists at `docs/public/robots.txt`
- [ ] `curl https://krometrail.dev/robots.txt` returns the file after deploy
- [ ] Internal doc paths are Disallowed
- [ ] Sitemap directive is present

---

### Unit 1.2: Enable sitemap generation

**File**: `docs/.vitepress/config.ts`

Add the `sitemap` property to the config object:

```typescript
export default defineConfig({
  // ... existing config ...

  sitemap: {
    hostname: "https://krometrail.dev",
    transformItems: (items) =>
      items.filter(
        (item) =>
          !item.url.startsWith("designs/") &&
          !item.url.startsWith("legacy/") &&
          !item.url.startsWith("framework-state/") &&
          !["ARCH", "SPEC", "UX", "VISION", "PRIOR_ART", "ADAPTER-SDK", "agents"].some((p) =>
            item.url.startsWith(p),
          ),
      ),
  },

  // ... rest of config ...
});
```

**Implementation Notes:**
- VitePress auto-generates `sitemap.xml` during build when `sitemap.hostname` is set
- `transformItems` filters out the same internal docs blocked in robots.txt (defense in depth)
- VitePress uses git log timestamps for `<lastmod>` dates automatically
- Insert the `sitemap` property right after the `ignoreDeadLinks` line (line 10)

**Acceptance Criteria:**
- [ ] `bun run docs:build` generates `docs/.vitepress/dist/sitemap.xml`
- [ ] Sitemap contains user-facing pages (~35-40 URLs)
- [ ] Sitemap excludes `designs/`, `legacy/`, `framework-state/`, and root foundation docs
- [ ] Each URL has a `<lastmod>` date

---

### Unit 1.3: Add JSON-LD structured data (WebSite + SoftwareApplication)

**File**: `docs/.vitepress/config.ts`

Add two JSON-LD script tags to the `head` array:

```typescript
// Add after the existing meta tags (after line 39):
[
  "script",
  { type: "application/ld+json" },
  JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Krometrail",
    "url": "https://krometrail.dev/",
    "description": "Browser observation and runtime debugging for AI coding agents",
    "inLanguage": "en-US",
  }),
],
[
  "script",
  { type: "application/ld+json" },
  JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "Krometrail",
    "url": "https://krometrail.dev/",
    "description":
      "MCP server and CLI that gives AI coding agents browser observation and runtime debugging via the Debug Adapter Protocol",
    "applicationCategory": "DeveloperApplication",
    "operatingSystem": "Linux, macOS, Windows",
    "downloadUrl": "https://krometrail.dev/install.sh",
    "installUrl": "https://www.npmjs.com/package/krometrail",
    "license": "https://opensource.org/licenses/MIT",
    "isAccessibleForFree": true,
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD",
    },
    "codeRepository": "https://github.com/nklisch/krometrail",
    "programmingLanguage": ["TypeScript", "JavaScript"],
    "featureList": [
      "Browser session recording via Chrome DevTools Protocol",
      "Runtime debugging across 10 languages via Debug Adapter Protocol",
      "React and Vue framework state observation",
      "MCP server for AI coding agent integration",
      "Session investigation with search, inspect, diff, and replay",
    ],
  }),
],
```

**Acceptance Criteria:**
- [ ] Built HTML contains two `<script type="application/ld+json">` tags
- [ ] Google Rich Results Test validates both schemas without errors

---

### Unit 1.4: Remove duplicate Google Fonts Inter + fix render-blocking

**File**: `docs/.vitepress/config.ts`

VitePress already bundles and preloads Inter (confirmed by `inter-roman-latin.*.woff2` in dist). The Google Fonts `<link>` loads Inter again plus JetBrains Mono. Replace the three Google Fonts-related head entries (preconnect x2 + stylesheet) with self-hosted JetBrains Mono only.

**Step 1:** Download JetBrains Mono woff2 files into `docs/public/fonts/`:
```bash
# Regular 400
curl -o docs/public/fonts/jetbrains-mono-400.woff2 \
  "https://fonts.gstatic.com/s/jetbrainsmono/v18/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKxjPVmUsaaDhw.woff2"
# Bold 700
curl -o docs/public/fonts/jetbrains-mono-700.woff2 \
  "https://fonts.gstatic.com/s/jetbrainsmono/v18/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKxjDl-Usaa.woff2"
```

**Step 2:** Remove lines 23-31 from config.ts (both preconnect links and the stylesheet link).

**Step 3:** Add `@font-face` rules to `docs/.vitepress/theme/custom.css`:

```css
/* Self-hosted JetBrains Mono — below-fold only, optional display */
@font-face {
  font-family: "JetBrains Mono";
  font-style: normal;
  font-weight: 400;
  font-display: optional;
  src: url("/fonts/jetbrains-mono-400.woff2") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
    U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193,
    U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: "JetBrains Mono";
  font-style: normal;
  font-weight: 700;
  font-display: optional;
  src: url("/fonts/jetbrains-mono-700.woff2") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
    U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193,
    U+2212, U+2215, U+FEFF, U+FFFD;
}
```

**Implementation Notes:**
- `font-display: optional` prevents CLS — if the font doesn't load in ~100ms, the system monospace is used instead. This is safe because JetBrains Mono only appears in code blocks (below fold).
- VitePress's bundled Inter already has `font-display: swap` and is preloaded — no changes needed there.
- Removing 2 external origins (fonts.googleapis.com, fonts.gstatic.com) eliminates the two-hop render-blocking chain.
- Expected LCP improvement: 200-400ms.

**Acceptance Criteria:**
- [ ] No `fonts.googleapis.com` or `fonts.gstatic.com` requests in network waterfall
- [ ] JetBrains Mono loads from `/fonts/` local path
- [ ] Inter still loads from VitePress bundle (no change)
- [ ] Code blocks render in JetBrains Mono (or system monospace on slow connections)

---

### Unit 1.5: Improve homepage title

**File**: `docs/index.md`

Add frontmatter with a descriptive title:

```yaml
---
layout: page
title: "Krometrail — AI Agent Debugging & Browser Observation"
titleTemplate: false
---
```

**Implementation Notes:**
- `titleTemplate: false` prevents VitePress from appending " | Krometrail" suffix
- The current title is just "Krometrail" — too generic for search results

**Acceptance Criteria:**
- [ ] Built HTML `<title>` is "Krometrail — AI Agent Debugging & Browser Observation"

---

## Phase 2: Trust & On-Page SEO (impacts rankings)

*Estimated effort: 2–3 hours. Deploy after Phase 1.*

### Unit 2.1: Create og-image.png

**File**: `docs/public/og-image.png`

Create a 1200×630px OG image with:
- Dark background (#111113)
- Krometrail logo (the sphere from favicon.svg)
- Text: "Krometrail" in Inter 600 + subtitle "AI Agent Debugging & Browser Observation"
- Violet accent (#7c3aed) gradient or border element

**Implementation Notes:**
- The `og:image` meta tag already points to `https://krometrail.dev/og-image.png` — just create the file
- Use any image tool (Figma, Canvas, ImageMagick). The exact design is up to the author.
- 1200×630 is the standard for `summary_large_image` Twitter cards

**Acceptance Criteria:**
- [ ] File exists at `docs/public/og-image.png`
- [ ] Dimensions are 1200×630px
- [ ] Social share preview shows the image (test with Twitter Card Validator or opengraph.xyz)

---

### Unit 2.2: Add privacy policy page

**File**: `docs/legal/privacy.md`

```markdown
---
title: "Privacy Policy"
description: "Krometrail privacy policy — what data we collect and how we use it."
---

# Privacy Policy

*Last updated: 2026-03-14*

## What We Collect

This website (krometrail.dev) uses Google Analytics to collect anonymous usage statistics:

- Pages visited and time spent
- Referral source
- Browser type and screen resolution
- Country/region (no precise location)

We do **not** collect personal information, email addresses, or any data from your use of the Krometrail CLI or MCP server. The Krometrail software runs entirely locally on your machine and sends no telemetry.

## Cookies

Google Analytics sets cookies to distinguish unique visitors. You can opt out by:
- Using a browser extension like [Google Analytics Opt-out](https://tools.google.com/dlpage/gaoptout)
- Enabling "Do Not Track" in your browser

## Third Parties

We do not sell, share, or transfer any data to third parties beyond Google Analytics.

## Contact

For privacy questions, open an issue on [GitHub](https://github.com/nklisch/krometrail/issues).

## Changes

We may update this policy occasionally. Changes will be posted on this page with an updated date.
```

**Implementation Notes:**
- Required by GDPR/CCPA since Google Analytics is active
- Add a "Privacy" link to the site footer (Unit 2.3)
- The `legal/` directory separates legal pages from documentation

**Acceptance Criteria:**
- [ ] Page renders at `/legal/privacy`
- [ ] Accurately describes Google Analytics usage
- [ ] Linked from site footer

---

### Unit 2.3: Update footer with privacy + contact links

**File**: `docs/.vitepress/config.ts`

Update the footer config:

```typescript
footer: {
  message: 'Released under the <a href="https://opensource.org/licenses/MIT">MIT License</a>. <a href="/legal/privacy">Privacy Policy</a>.',
  copyright: 'Built with Bun, TypeScript, and too many debugger protocols. <a href="https://github.com/nklisch/krometrail/issues">Report an issue</a>.',
},
```

**Acceptance Criteria:**
- [ ] Footer contains Privacy Policy link
- [ ] Footer contains Report an issue link
- [ ] Both links work

---

### Unit 2.4: Add og:url meta tag

**File**: `docs/.vitepress/config.ts`

Add to the `head` array after the existing `og:image` tag:

```typescript
["meta", { property: "og:url", content: "https://krometrail.dev/" }],
```

**Implementation Notes:**
- This is a static global value. Ideally it should be per-page via `transformPageData`, but a homepage-level og:url is better than none. Per-page OG can be Phase 4.

**Acceptance Criteria:**
- [ ] `og:url` meta tag present in built HTML

---

### Unit 2.5: Enable lastUpdated dates on documentation pages

**File**: `docs/.vitepress/config.ts`

Add to the top-level config:

```typescript
lastUpdated: true,
```

**Implementation Notes:**
- VitePress reads git log timestamps to show "Last updated: <date>" on each doc page
- Only displays on pages using the `doc` layout (not the landing page)
- Provides freshness signals for AI search engines

**Acceptance Criteria:**
- [ ] Documentation pages show "Last updated" dates
- [ ] Dates reflect actual git history, not all identical

---

### Unit 2.6: Defer Google Analytics loading

**File**: `docs/.vitepress/config.ts`

Replace the synchronous GA script tags (current lines 13-21) with a deferred version:

```typescript
[
  "script",
  {},
  `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-8VK84SJ371');
if (typeof requestIdleCallback === 'function') {
  requestIdleCallback(function() {
    var s = document.createElement('script');
    s.src = 'https://www.googletagmanager.com/gtag/js?id=G-8VK84SJ371';
    document.head.appendChild(s);
  });
} else {
  setTimeout(function() {
    var s = document.createElement('script');
    s.src = 'https://www.googletagmanager.com/gtag/js?id=G-8VK84SJ371';
    document.head.appendChild(s);
  }, 3000);
}`,
],
```

**Implementation Notes:**
- Removes the synchronous `<script async src="...gtag/js">` tag
- Loads gtag.js via `requestIdleCallback` (or 3s fallback for Safari <16.4)
- The inline `gtag()` calls still run immediately to queue events; the library loads later
- This eliminates main-thread contention during the critical render path

**Acceptance Criteria:**
- [ ] No synchronous `<script src="googletagmanager.com">` in initial HTML
- [ ] GA still tracks page views (verify in GA dashboard after deploy)
- [ ] gtag.js loads after page is interactive

---

### Unit 2.7: Add frontmatter to pages missing meta descriptions

These documentation pages are missing `description` frontmatter. Add it to each:

| File | Add frontmatter |
|------|----------------|
| `docs/browser/markers-screenshots.md` | `description: "Drop timeline markers and capture screenshots during browser recording sessions."` |
| `docs/browser/investigation-tools/search.md` | `description: "Full-text and structured search across recorded browser session events."` |
| `docs/browser/investigation-tools/diff.md` | `description: "Compare two moments in a browser session to find what changed."` |
| `docs/browser/investigation-tools/replay-context.md` | `description: "Generate reproduction steps and Playwright test scaffolds from browser sessions."` |
| `docs/debugging/variables-evaluation.md` | `description: "Inspect variables and evaluate expressions at breakpoints during agent debugging."` |
| `docs/debugging/watch-expressions.md` | `description: "Track how variables change across debugging steps with watch expressions."` |
| `docs/debugging/context-compression.md` | `description: "How Krometrail compresses viewport output to fit agent context windows."` |
| `docs/debugging/multi-threaded.md` | `description: "Debug multi-threaded applications with thread-aware breakpoints and stepping."` |
| `docs/debugging/framework-detection.md` | `description: "Automatic test framework detection for pytest, jest, go test, and more."` |
| `docs/guides/claude-code.md` | `description: "Configure Krometrail with Claude Code for AI-powered debugging."` |
| `docs/guides/cursor-windsurf.md` | `description: "Set up Krometrail with Cursor, Windsurf, and other MCP-compatible editors."` |
| `docs/guides/codex.md` | `description: "Configure Krometrail with OpenAI Codex for runtime debugging."` |
| `docs/guides/troubleshooting.md` | `description: "Common issues and solutions for Krometrail debugging and browser observation."` |
| `docs/about/architecture.md` | `description: "Krometrail system architecture — session management, DAP client, viewport rendering."` |
| `docs/guide/cli-installation.md` | `description: "Install the Krometrail CLI binary for standalone debugging without an MCP client."` |

For each, add or update the frontmatter block at the top of the file:
```yaml
---
title: "Existing Title"
description: "New description here."
---
```

**Acceptance Criteria:**
- [ ] All 15 files have `description` in frontmatter
- [ ] Each description is unique and under 160 characters

---

## Phase 3: Content & GEO (improves rankings and AI citability)

*Estimated effort: 4–6 hours. Deploy after Phase 2.*

### Unit 3.1: Create FAQ page

**File**: `docs/guide/faq.md`

```markdown
---
title: "FAQ"
description: "Frequently asked questions about Krometrail — installation, configuration, language support, and comparison with alternatives."
---

# Frequently Asked Questions

## What is Krometrail?

Krometrail is an open-source MCP server and CLI that gives AI coding agents runtime
debugging and browser observation capabilities. It connects to debuggers in 10
programming languages via the Debug Adapter Protocol (DAP) and records Chrome browser
sessions via the Chrome DevTools Protocol (CDP). Agents interact through MCP tools or
CLI commands, receiving compressed viewport output designed to fit within LLM context
windows at approximately 300–400 tokens per debugging stop.

## What languages does Krometrail support?

Krometrail supports runtime debugging in 10 languages: Python (via debugpy), Node.js
and TypeScript (via js-debug), Go (via Delve), Rust (via CodeLLDB), Java (via
java-debug), C and C++ (via cppdbg/GDB/LLDB), Ruby (via rdbg), C# (via netcoredbg),
Swift (via lldb-dap), and Kotlin (via kotlin-debug-adapter). Each language uses a
dedicated adapter that handles debugger lifecycle, breakpoint management, and
output formatting.

## How do I configure Krometrail with Claude Code?

Add Krometrail to your Claude Code MCP configuration by adding a `krometrail` entry
to your `.mcp.json` file. The entry should specify `"command": "npx"` with
`"args": ["-y", "krometrail@latest", "mcp"]`. Once configured, Claude Code can use
Krometrail's MCP tools to launch debug sessions, set breakpoints, step through code,
and inspect variables. See the [MCP Configuration guide](/guide/mcp-configuration)
for complete setup instructions.

## How does Krometrail compare to other MCP debugging tools?

Krometrail differs from alternatives like AIDB, mcp-debugger, and mcp-dap-server in
several key areas. Unlike AIDB, Krometrail uses the standard Debug Adapter Protocol
rather than a custom protocol, supporting 10 languages instead of only Python.
Compared to mcp-debugger and mcp-dap-server, Krometrail adds browser observation,
viewport-aware output compression, and a CLI interface. See the
[detailed comparison](/guide/getting-started#how-krometrail-compares) for a
full feature matrix.

## What does browser observation capture?

Krometrail's browser observation records six categories of events from Chrome sessions:
network requests and responses (with headers, status codes, and timing), console
output and errors, DOM mutations, storage changes (localStorage, sessionStorage,
cookies), framework state (React component trees, Vue/Pinia stores), and
timestamped screenshots. Agents can search, inspect, diff, and replay recorded
events using investigation tools.

## How much context window does Krometrail use?

Krometrail's viewport output is designed to be token-efficient. Each debugging stop
produces approximately 300–400 tokens, including source context, variable values,
call stack, and breakpoint status. The viewport uses progressive compression — as
context accumulates, older stops are summarized to stay within budget. Browser
observation lenses similarly compress recorded events, with configurable limits
on event counts and detail levels.

## Is Krometrail free?

Yes. Krometrail is open-source software released under the MIT License. There are no
paid tiers, usage limits, or telemetry. The software runs entirely on your local
machine. You can install it via npm (`npx krometrail`) or download a standalone
binary from the [CLI installation page](/guide/cli-installation).
```

**Implementation Notes:**
- Each answer is 100-170 words — optimized for AI citation extraction
- Question-based H2 headings match natural language search queries
- Self-contained answers that can be extracted without surrounding context
- Internal links to deeper documentation for each topic
- Add to the Guide sidebar in config.ts

**Sidebar addition** in `docs/.vitepress/config.ts`:
```typescript
"/guide/": [
  {
    text: "Guide",
    items: [
      { text: "Getting Started", link: "/guide/getting-started" },
      { text: "MCP Configuration", link: "/guide/mcp-configuration" },
      { text: "CLI Installation", link: "/guide/cli-installation" },
      { text: "Your First Debug Session", link: "/guide/first-debug-session" },
      { text: "FAQ", link: "/guide/faq" },  // ← add this
    ],
  },
],
```

**Acceptance Criteria:**
- [ ] Page renders at `/guide/faq`
- [ ] Each answer is 100-170 words
- [ ] Appears in Guide sidebar
- [ ] All internal links resolve

---

### Unit 3.2: Add noindex frontmatter to internal docs

Add `head` frontmatter with a `noindex` meta tag to all internal documentation pages. This provides defense-in-depth alongside robots.txt Disallow rules.

**Files** (apply the same frontmatter to each):

Root foundation docs (7 files):
- `docs/ARCH.md`
- `docs/SPEC.md`
- `docs/UX.md`
- `docs/VISION.md`
- `docs/PRIOR_ART.md`
- `docs/ADAPTER-SDK.md`
- `docs/agents.md`

Add to the top of each:
```yaml
---
head:
  - - meta
    - name: robots
      content: noindex, nofollow
---
```

**Implementation Notes:**
- VitePress supports per-page `head` tags via frontmatter
- This catches any crawlers that ignore robots.txt
- The `designs/`, `legacy/`, and `framework-state/` directories contain ~47 files — for these, the robots.txt Disallow is sufficient since adding frontmatter to 47 files is excessive maintenance. The 7 root foundation docs are worth the effort because they appear at prominent root-level URLs.

**Acceptance Criteria:**
- [ ] All 7 root foundation docs have `noindex, nofollow` meta tag in built HTML
- [ ] User-facing docs do NOT have noindex

---

### Unit 3.3: Add about/team page

**File**: `docs/about/team.md`

```markdown
---
title: "About"
description: "About Krometrail and its creator."
---

# About Krometrail

Krometrail is created and maintained by **Nathan Klisch**, a software engineer focused
on developer tools and AI agent infrastructure.

- GitHub: [@nklisch](https://github.com/nklisch)

## Why Krometrail?

AI coding agents are powerful but blind to runtime behavior. When a bug involves
a 500 error from an API endpoint, a race condition in async code, or a React component
re-rendering with stale props, agents can only guess from source code. Krometrail
gives agents the same observability that human developers rely on — debuggers and
browser dev tools — delivered in a format optimized for LLM context windows.

## Open Source

Krometrail is released under the [MIT License](https://opensource.org/licenses/MIT).
Contributions, bug reports, and feature requests are welcome on
[GitHub](https://github.com/nklisch/krometrail).
```

**Implementation Notes:**
- Verify author details with the user before finalizing — name and bio may need adjustments
- Add to the About sidebar if one exists, or to the nav if appropriate

**Acceptance Criteria:**
- [ ] Page renders at `/about/team`
- [ ] Contains author name and GitHub link
- [ ] Linked from site navigation or footer

---

### Unit 3.4: Enable cleanUrls

**File**: `docs/.vitepress/config.ts`

Add to the top-level config:

```typescript
cleanUrls: true,
```

**Implementation Notes:**
- Removes `.html` extensions from all URLs
- GitHub Pages requires a custom 404 page or SPA fallback. VitePress generates `404.html` by default, but GitHub Pages may not handle extensionless URLs natively.
- **IMPORTANT**: Test this with the actual GitHub Pages deployment. If extensionless URLs return 404, this may require switching to a host like Cloudflare Pages, Vercel, or Netlify. If GitHub Pages doesn't support it, skip this unit and add a comment explaining why.
- If cleanUrls works: all internal links already use clean format (no `.html`), so no content changes needed.

**Acceptance Criteria:**
- [ ] `/guide/getting-started` loads without `.html` extension
- [ ] `/guide/getting-started.html` either redirects to clean URL or is inaccessible
- [ ] No 404s on any sidebar navigation links

---

### Unit 3.5: Change ignoreDeadLinks to explicit allowlist

**File**: `docs/.vitepress/config.ts`

Replace:
```typescript
ignoreDeadLinks: true,
```

With:
```typescript
ignoreDeadLinks: [
  // Generated include files resolved at build time
  /\.generated\//,
],
```

**Implementation Notes:**
- The `.generated/` directory contains auto-generated includes that may not resolve as standalone links
- If the build fails with dead link errors after this change, add the specific patterns to the allowlist rather than reverting to `true`
- Run `bun run docs:build` and fix any real dead links discovered

**Acceptance Criteria:**
- [ ] `bun run docs:build` succeeds
- [ ] Dead links in user-facing docs are caught (not silenced)

---

## Phase 4: Polish & Accessibility

*Estimated effort: 2–3 hours. Deploy after Phase 3.*

### Unit 4.1: Fix button touch targets on mobile

**File**: `docs/.vitepress/theme/custom.css`

Add a media query for mobile touch targets:

```css
/* Mobile touch target minimum 48px */
@media (max-width: 768px) {
  .kt-btn-primary,
  .kt-btn-outline {
    padding: 14px 24px;
    min-height: 48px;
  }
}
```

**Acceptance Criteria:**
- [ ] CTA buttons are at least 48px tall on mobile viewports

---

### Unit 4.2: Fix WCAG AA contrast on tertiary text

**File**: `docs/.vitepress/theme/custom.css`

Update the dark theme tertiary text color:

```css
/* Current: #52525b (3.1:1 ratio — fails AA) */
/* New: #71717a (4.6:1 ratio — passes AA) */
```

Change in the `.dark` block:
```css
--vp-c-text-3: #64646e;
```

And in the light theme block:
```css
--vp-c-text-3: #64646e;
```

**Implementation Notes:**
- `#64646e` on `#111113` gives approximately 4.0:1 contrast — still borderline. Use `#71717a` if you want more margin, but that would make text-2 and text-3 identical in dark mode.
- Alternative: use `#6b6b75` which gives ~4.3:1 — passes AA while remaining visually distinct from text-2.

**Acceptance Criteria:**
- [ ] Tertiary text color contrast ratio is ≥4.5:1 against background

---

### Unit 4.3: Add focus styles for interactive elements

**File**: `docs/.vitepress/theme/custom.css`

```css
/* Keyboard focus indicators */
.kt-btn-primary:focus-visible,
.kt-btn-outline:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
```

**Acceptance Criteria:**
- [ ] Tab-navigating to buttons shows a visible focus ring
- [ ] Focus ring uses brand violet color

---

### Unit 4.4: Trim llms-full.txt

**File**: `docs/public/llms-full.txt`

This file is 422KB and likely includes internal design docs, legacy docs, and framework-state specs. Regenerate it excluding internal content:

**Implementation Notes:**
- Check how `llms-full.txt` is generated (likely a build script or manual concatenation)
- Exclude the same paths filtered in the sitemap: `designs/`, `legacy/`, `framework-state/`, root foundation docs
- Target size: under 200KB
- If generated by a script, update the script to exclude these paths

**Acceptance Criteria:**
- [ ] File size is under 200KB
- [ ] Contains only user-facing documentation
- [ ] `llms.txt` links to `llms-full.txt`

---

## Implementation Order

1. **Phase 1** (Critical Infrastructure) — all units can be done in parallel:
   - 1.1: robots.txt
   - 1.2: Sitemap generation
   - 1.3: JSON-LD structured data
   - 1.4: Self-host fonts + remove Google Fonts
   - 1.5: Homepage title
   - → **Deploy**

2. **Phase 2** (Trust & On-Page) — units 2.1-2.7 can be done in parallel:
   - 2.1: og-image.png (requires image creation tool)
   - 2.2: Privacy policy page
   - 2.3: Footer links (depends on 2.2)
   - 2.4: og:url meta tag
   - 2.5: lastUpdated dates
   - 2.6: Defer GA loading
   - 2.7: Meta descriptions for 15 pages
   - → **Deploy**

3. **Phase 3** (Content & GEO):
   - 3.1: FAQ page
   - 3.2: noindex on internal docs
   - 3.3: About/team page
   - 3.4: cleanUrls (test deployment, may require host change)
   - 3.5: Fix ignoreDeadLinks
   - → **Deploy**

4. **Phase 4** (Polish & Accessibility):
   - 4.1: Mobile touch targets
   - 4.2: WCAG contrast fix
   - 4.3: Focus styles
   - 4.4: Trim llms-full.txt
   - → **Deploy**

## Out of Scope (Future Considerations)

These items were identified in the audit but are not included in this plan:

- **YouTube demo video** — requires recording, editing; high impact but different workflow
- **Blog posts** — ongoing content strategy, not a one-time fix
- **GitHub stars badge** — minor authority signal; add when convenient
- **Community links (Discord)** — requires setting up a community first
- **Expand thin content pages** — Getting Started, Browser Overview, Debugging Overview, and language pages need more words. This is a content authoring task that should be done thoughtfully by the project author, not generated.
- **Per-page BreadcrumbList schema** — requires VitePress `transformHead` hook; low ROI for current site size
- **Per-page OG tags** — requires `transformPageData` hook; moderate effort
- **IndexNow integration** — marginal benefit for a docs site
- **Migrate from GitHub Pages** — only needed if cleanUrls doesn't work on GH Pages

## Verification Checklist

After all phases are deployed:

```bash
# Phase 1 verification
curl -s https://krometrail.dev/robots.txt | head -20
curl -s https://krometrail.dev/sitemap.xml | head -20
curl -s https://krometrail.dev/ | grep 'application/ld+json'
curl -s https://krometrail.dev/ | grep 'fonts.googleapis.com'  # should return nothing

# Phase 2 verification
curl -sI https://krometrail.dev/og-image.png | head -5  # should be 200
curl -s https://krometrail.dev/legal/privacy | grep 'Privacy Policy'
curl -s https://krometrail.dev/ | grep 'og:url'

# Phase 3 verification
curl -s https://krometrail.dev/guide/faq | grep 'What is Krometrail'
curl -s https://krometrail.dev/ARCH | grep 'noindex'

# Full audit re-run
# Run /seo audit https://krometrail.dev/ again to verify score improvement
```

**Expected score improvement:** 48/100 → 78-85/100 after all 4 phases.
