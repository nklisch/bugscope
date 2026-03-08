## Browser Lens Investigation Workflow

When the user mentions a browser issue, bug, or unexpected behavior:

1. **Find the session:**
   `agent-lens browser sessions --has-markers`
   Look for sessions with markers near the reported time.

2. **Get the overview:**
   `agent-lens browser overview <session_id> --around-marker M1`
   Understand the navigation path, errors, and markers.

3. **Search for errors:**
   `agent-lens browser search <session_id> --status-codes 400,422,500`
   Find network failures. Also try:
   `agent-lens browser search <session_id> --query "validation error"`

4. **Inspect the problem moment:**
   `agent-lens browser inspect <session_id> --marker M1 --include network_body,console_context`
   Get full request/response bodies, console output, and surrounding events.

5. **Compare before and after:**
   `agent-lens browser diff <session_id> --before <load_time> --after <error_time> --include form_state`
   See what changed between page load and the error.

6. **Generate reproduction artifacts:**
   `agent-lens browser replay-context <session_id> --around-marker M1 --format reproduction_steps`
   Or generate a test:
   `agent-lens browser replay-context <session_id> --around-marker M1 --format test_scaffold --framework playwright`

### Tips
- Markers placed by the user are labeled [user]. Auto-detected markers are [auto].
- Use `--token-budget` to control response size (default: 3000 tokens for overview, 2000 for search).
- Event IDs from search results can be used with `--event <id>` in inspect.
- HAR export: `agent-lens browser export <session_id> --format har --output debug.har`
