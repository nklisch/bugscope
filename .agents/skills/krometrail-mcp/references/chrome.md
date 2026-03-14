# Chrome Browser Recording (CDP)

## Quick Start
```
chrome_start(url: 'http://localhost:3000', profile: 'krometrail')
# ... interact in the browser ...
chrome_mark(label: 'submitted form')
chrome_stop()
session_list()
```

## Launching Chrome

### Isolated instance (recommended)
Always pass `profile` to avoid conflicting with your regular Chrome:
```
chrome_start(profile: 'krometrail', url: 'http://localhost:3000')
```
Creates a separate Chrome with its own user-data-dir under `~/.krometrail/chrome-profiles/krometrail`. Independent cookies, storage, login state.

### Attach to existing Chrome
Chrome must have been started with `--remote-debugging-port`:
```sh
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/cdp-chrome
```
Then:
```
chrome_start(attach: true)
```

## CDP Connection Errors

**Error: "Chrome CDP not available after 10000ms"**

Likely cause: Chrome is already running without the debug port.

Fix options (returned in the error message):
1. `chrome_start(profile: 'krometrail')` — isolated instance, no conflict (recommended)
2. `pkill -f chrome && google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/...`
3. Start Chrome with debug port, then `chrome_start(attach: true)`

**Error: "Chrome not found"**

Chrome isn't in PATH. Install Chrome or specify the path manually.
Common locations:
- Linux: `/usr/bin/google-chrome`, `/usr/bin/chromium`
- macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

## Headless Environments
Chrome needs a display. Options:
- `DISPLAY=:0` if a display server is running
- Start `Xvfb :99 &` then `DISPLAY=:99 chrome_start(...)`
- Or: `chrome_start(attach: true)` and start Chrome manually with `--headless=new`

## Markers
Place markers at key moments so you can find them later:
```
chrome_mark(label: 'clicked submit')
chrome_mark(label: 'error appeared')
chrome_mark()  # unlabeled — timestamped only
```

Use `around_marker` in `session_overview` or `session_search` to center investigation on a marker.

## Tab Recording
```
chrome_start(all_tabs: true)                    # all tabs
chrome_start(tab_filter: '**/app/**')           # tabs matching URL glob
chrome_start()                                  # first/active tab only (default)
```

## Investigating Sessions

```
session_list()                                              # list recorded sessions
session_overview(session_id: '...')                         # timeline, markers, errors
session_search(session_id: '...', status_codes: [422, 500]) # find bad requests
session_search(session_id: '...', query: 'validation error')# full-text search
session_inspect(session_id: '...', event_id: '...')         # full event detail + request bodies
session_diff(session_id: '...', before: '...', after: '...')# compare two moments
session_replay_context(session_id: '...', format: 'reproduction_steps')
session_replay_context(session_id: '...', format: 'test_scaffold', test_framework: 'playwright')
```

## What Gets Recorded
- Navigation (URL changes, page loads)
- Network requests and responses (headers + bodies)
- Console output (log, warn, error)
- Unhandled JS errors and exceptions
- User input (clicks, form fills, keypresses)
- DOM mutations (significant changes)
- Form state snapshots
- Screenshots at key moments
- WebSocket frames
- Performance entries
- Storage changes (localStorage, sessionStorage, cookies)
