import { defineCommand } from "citty";
import type { SessionSummary } from "../../browser/investigation/query-engine.js";
import type { BrowserSessionInfo, Marker } from "../../browser/types.js";
import { DaemonClient, ensureDaemon } from "../../daemon/client.js";
import { getDaemonSocketPath } from "../../daemon/protocol.js";

/**
 * Create a DaemonClient ensuring the daemon is running.
 * Uses a longer timeout for browser.start since Chrome launch may take a few seconds.
 */
async function getClient(timeoutMs = 30_000): Promise<DaemonClient> {
	const socketPath = getDaemonSocketPath();
	await ensureDaemon(socketPath);
	return new DaemonClient({ socketPath, requestTimeoutMs: timeoutMs });
}

function formatSessionInfo(info: BrowserSessionInfo): string {
	const lines: string[] = [];
	const startedAt = new Date(info.startedAt).toLocaleTimeString();
	lines.push(`Browser recording active since ${startedAt}`);
	lines.push(`Events: ${info.eventCount}  Markers: ${info.markerCount}  Buffer age: ${Math.round(info.bufferAgeMs / 1000)}s`);
	if (info.tabs.length > 0) {
		lines.push("Tabs:");
		for (const tab of info.tabs) {
			const title = tab.title ? `"${tab.title}" ` : "";
			lines.push(`  ${title}(${tab.url})`);
		}
	}
	return lines.join("\n");
}

export const browserStartCommand = defineCommand({
	meta: {
		name: "start",
		description: "Launch Chrome and start recording browser events",
	},
	args: {
		port: {
			type: "string",
			description: "Chrome remote debugging port",
			default: "9222",
		},
		profile: {
			type: "string",
			description: "Chrome profile name (creates isolated user-data-dir under ~/.agent-lens/chrome-profiles/)",
		},
		attach: {
			type: "boolean",
			description: "Attach to an already-running Chrome instance (don't launch Chrome)",
			default: false,
		},
		"all-tabs": {
			type: "boolean",
			description: "Record all browser tabs (default: first/active tab only)",
			default: false,
		},
		tab: {
			type: "string",
			description: "Record only tabs matching this URL pattern",
		},
	},
	async run({ args }) {
		const client = await getClient(30_000);
		try {
			const info = await client.call<BrowserSessionInfo>("browser.start", {
				port: Number.parseInt(args.port, 10),
				profile: args.profile,
				attach: args.attach,
				allTabs: args["all-tabs"],
				tabFilter: args.tab,
			});
			process.stdout.write(`${formatSessionInfo(info)}\n`);
		} catch (err) {
			process.stderr.write(`Error: ${(err as Error).message}\n`);
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

export const browserMarkCommand = defineCommand({
	meta: {
		name: "mark",
		description: "Place a marker in the browser recording buffer",
	},
	args: {
		label: {
			type: "positional",
			description: "Label for the marker",
			required: false,
		},
	},
	async run({ args }) {
		const client = await getClient();
		try {
			const marker = await client.call<Marker>("browser.mark", {
				label: args.label,
			});
			const time = new Date(marker.timestamp).toLocaleTimeString();
			const label = marker.label ? `"${marker.label}"` : "(unlabeled)";
			process.stdout.write(`Marker placed: ${label} at ${time}\n`);
		} catch (err) {
			process.stderr.write(`Error: ${(err as Error).message}\n`);
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

export const browserStatusCommand = defineCommand({
	meta: {
		name: "status",
		description: "Show browser recording status",
	},
	async run() {
		const client = await getClient();
		try {
			const info = await client.call<BrowserSessionInfo | null>("browser.status", {});
			if (!info) {
				process.stdout.write("No active browser recording. Run `agent-lens browser start` to begin.\n");
				return;
			}
			process.stdout.write(`${formatSessionInfo(info)}\n`);
		} catch (err) {
			process.stderr.write(`Error: ${(err as Error).message}\n`);
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

export const browserStopCommand = defineCommand({
	meta: {
		name: "stop",
		description: "Stop browser recording",
	},
	args: {
		"close-browser": {
			type: "boolean",
			description: "Also close the Chrome browser",
			default: false,
		},
	},
	async run({ args }) {
		const client = await getClient();
		try {
			await client.call("browser.stop", {
				closeBrowser: args["close-browser"],
			});
			process.stdout.write("Browser recording stopped.\n");
		} catch (err) {
			process.stderr.write(`Error: ${(err as Error).message}\n`);
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

export const browserSessionsCommand = defineCommand({
	meta: {
		name: "sessions",
		description: "List recorded browser sessions",
	},
	args: {
		"has-markers": { type: "boolean", description: "Only sessions with markers" },
		"has-errors": { type: "boolean", description: "Only sessions with errors" },
		after: { type: "string", description: "Only sessions after this date (ISO timestamp)" },
		before: { type: "string", description: "Only sessions before this date (ISO timestamp)" },
		limit: { type: "string", description: "Max results (default: 10)" },
		json: { type: "boolean", description: "JSON output" },
	},
	async run({ args }) {
		const client = await getClient();
		try {
			const sessions = await client.call<SessionSummary[]>("browser.sessions", {
				hasMarkers: args["has-markers"],
				hasErrors: args["has-errors"],
				after: args.after ? new Date(args.after).getTime() : undefined,
				before: args.before ? new Date(args.before).getTime() : undefined,
				limit: args.limit ? Number.parseInt(args.limit, 10) : 10,
			});
			if (args.json) {
				process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
			} else {
				if (sessions.length === 0) {
					process.stdout.write("No recorded sessions found.\n");
					return;
				}
				process.stdout.write(`Sessions (${sessions.length}):\n`);
				for (const s of sessions) {
					const durationMs = s.duration;
					const seconds = Math.floor(durationMs / 1000);
					const duration = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
					const markers = s.markerCount > 0 ? `, ${s.markerCount} markers` : "";
					const errors = s.errorCount > 0 ? `, ${s.errorCount} errors` : "";
					const startedAt = new Date(s.startedAt).toISOString().slice(11, 23);
					process.stdout.write(`  ${s.id}  ${startedAt}  ${duration}  ${s.url}  (${s.eventCount} events${markers}${errors})\n`);
				}
			}
		} catch (err) {
			process.stderr.write(`Error: ${(err as Error).message}\n`);
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

export const browserOverviewCommand = defineCommand({
	meta: {
		name: "overview",
		description: "Get a structured overview of a recorded browser session",
	},
	args: {
		id: { type: "positional", description: "Session ID", required: true },
		"around-marker": { type: "string", description: "Center on marker ID" },
		budget: { type: "string", description: "Token budget (default: 3000)" },
		json: { type: "boolean", description: "JSON output" },
	},
	async run({ args }) {
		const client = await getClient();
		try {
			const text = await client.call<string>("browser.overview", {
				sessionId: args.id,
				aroundMarker: args["around-marker"],
				tokenBudget: args.budget ? Number.parseInt(args.budget, 10) : 3000,
			});
			process.stdout.write(`${text}\n`);
		} catch (err) {
			process.stderr.write(`Error: ${(err as Error).message}\n`);
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

export const browserSearchCommand = defineCommand({
	meta: {
		name: "search",
		description: "Search recorded browser session events",
	},
	args: {
		id: { type: "positional", description: "Session ID", required: true },
		query: { type: "string", description: "Natural language search query" },
		"status-codes": { type: "string", description: "Filter by HTTP status codes (comma-separated, e.g. 422,500)" },
		"event-types": { type: "string", description: "Filter by event types (comma-separated)" },
		"max-results": { type: "string", description: "Max results (default: 10)" },
		budget: { type: "string", description: "Token budget (default: 2000)" },
	},
	async run({ args }) {
		const client = await getClient();
		try {
			const text = await client.call<string>("browser.search", {
				sessionId: args.id,
				query: args.query,
				statusCodes: args["status-codes"]
					? args["status-codes"]
							.split(",")
							.map((s) => Number.parseInt(s.trim(), 10))
							.filter(Number.isFinite)
					: undefined,
				eventTypes: args["event-types"] ? args["event-types"].split(",").map((s) => s.trim()) : undefined,
				maxResults: args["max-results"] ? Number.parseInt(args["max-results"], 10) : 10,
				tokenBudget: args.budget ? Number.parseInt(args.budget, 10) : 2000,
			});
			process.stdout.write(`${text}\n`);
		} catch (err) {
			process.stderr.write(`Error: ${(err as Error).message}\n`);
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

export const browserInspectCommand = defineCommand({
	meta: {
		name: "inspect",
		description: "Deep-dive into a specific event or moment in a recorded browser session",
	},
	args: {
		id: { type: "positional", description: "Session ID", required: true },
		event: { type: "string", description: "Event ID to inspect" },
		marker: { type: "string", description: "Marker ID to jump to" },
		timestamp: { type: "string", description: "ISO timestamp to inspect nearest moment" },
		include: { type: "string", description: "Comma-separated: surrounding_events,network_body,screenshot" },
		"context-window": { type: "string", description: "Seconds of surrounding events (default: 5)" },
		budget: { type: "string", description: "Token budget (default: 3000)" },
	},
	async run({ args }) {
		const client = await getClient();
		try {
			const text = await client.call<string>("browser.inspect", {
				sessionId: args.id,
				eventId: args.event,
				markerId: args.marker,
				timestamp: args.timestamp ? new Date(args.timestamp).getTime() : undefined,
				include: args.include ? args.include.split(",").map((s) => s.trim()) : undefined,
				contextWindow: args["context-window"] ? Number.parseInt(args["context-window"], 10) : 5,
				tokenBudget: args.budget ? Number.parseInt(args.budget, 10) : 3000,
			});
			process.stdout.write(`${text}\n`);
		} catch (err) {
			process.stderr.write(`Error: ${(err as Error).message}\n`);
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

export const browserCommand = defineCommand({
	meta: {
		name: "browser",
		description: "Browser recording (CDP recorder — passive observer for network, console, and user input events)",
	},
	subCommands: {
		start: browserStartCommand,
		mark: browserMarkCommand,
		status: browserStatusCommand,
		stop: browserStopCommand,
		sessions: browserSessionsCommand,
		overview: browserOverviewCommand,
		search: browserSearchCommand,
		inspect: browserInspectCommand,
	},
});
