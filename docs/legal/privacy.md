---
title: "Privacy Policy"
description: "Krometrail privacy policy — what data we collect and how we use it."
---

# Privacy Policy

*Last updated: 2026-03-16*

## Website Analytics

This website (krometrail.dev) uses Google Analytics to collect anonymous usage statistics:

- Pages visited and time spent
- Referral source
- Browser type and screen resolution
- Country/region (no precise location)

### Cookies

Google Analytics sets cookies to distinguish unique visitors. You can opt out by:
- Using a browser extension like [Google Analytics Opt-out](https://tools.google.com/dlpage/gaoptout)
- Enabling "Do Not Track" in your browser

## CLI & MCP Server Telemetry

The Krometrail CLI and MCP server send a single anonymous ping on each invocation. This helps us understand how widely the tool is used. Each ping includes:

- **Event type** — `run` (CLI) or `mcp_start` (MCP server)
- **Software version** — e.g. `0.2.8`
- **OS platform** — e.g. `linux`, `darwin`, `win32`

Each ping uses a **random, non-persistent client ID** generated at invocation time. Nothing is stored on disk, and no personally identifiable information is collected.

Pings are sent to Google Analytics (GA4 Measurement Protocol) and are **skipped entirely** when:
- The build does not include the GA secret (most self-builds)
- Any of these environment variables are set: `DO_NOT_TRACK=1`, `KROMETRAIL_NO_TELEMETRY=1`, or `TELEMETRY_DISABLED=1`
- The `CI` environment variable is set (CI environments are excluded by default)

### What We Do NOT Collect

- No source code, file paths, variable values, or debugging session content
- No personal information or email addresses
- No persistent device identifiers or IP-based fingerprinting

## Third Parties

We do not sell, share, or transfer any data to third parties beyond Google Analytics (website and CLI telemetry as described above).

## Contact

For privacy questions, open an issue on [GitHub](https://github.com/nklisch/krometrail/issues).

## Changes

We may update this policy occasionally. Changes will be posted on this page with an updated date.
